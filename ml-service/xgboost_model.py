"""
Modelo B — Sugerencia de cantidad de reorden (XGBoost, GLOBAL)

Rediseño vs. la versión anterior (un modelo por cliente):

1. SIN FUGA DE VARIABLE: antes se predecía "qty_promedio" usando "qty_promedio"
   como feature de entrada — el modelo solo aprendía a copiar el dato.
   Ahora usamos ventanas deslizantes tipo serie de tiempo: con los primeros k
   pedidos de un (cliente, sku) calculamos las features, y el target es la
   cantidad REAL del pedido k+1 — un valor que el modelo nunca ve.

2. MODELO GLOBAL: en vez de entrenar un XGBoost nuevo por cliente con un puñado
   de filas (una por SKU), entrenamos UN SOLO modelo con ejemplos de TODOS los
   clientes. Esto da cientos/miles de filas → suficiente para validar de verdad
   y para que el modelo aprenda patrones compartidos (estacionalidad, relación
   frecuencia/cantidad, etc.) sin perder personalización: cada fila ya incluye
   features propias del cliente (su promedio, su tendencia, su frecuencia...).

3. VALIDACIÓN TEMPORAL: el split train/test se hace por fecha (no aleatorio),
   simulando producción real — el modelo nunca ve datos "del futuro".

4. COMPARACIÓN CONTRA BASELINES: medimos el MAE contra predicciones ingenuas
   ("va a pedir lo mismo que la última vez", "va a pedir su promedio histórico")
   para confirmar honestamente si XGBoost aporta algo o si es complejidad de más.
"""

import numpy as np
from datetime import datetime, timezone
from typing import Optional
from dateutil import parser as dateparser
from collections import defaultdict
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

FEATURE_NAMES = [
    "qty_promedio", "qty_std", "qty_last", "tendencia",
    "dias_desde_ultimo", "mes_objetivo", "frecuencia", "gap_promedio_dias",
]

MIN_ORDERS_PER_SKU = 3   # mínimo de pedidos históricos de (cliente, sku) para generar ejemplos
MIN_TRAINING_ROWS = 30   # mínimo de ejemplos globales para entrenar con confianza


def parse_date(raw) -> Optional[datetime]:
    """Parsea una fecha y la normaliza a UTC-aware (evita el bug naive vs. aware al restar)."""
    if isinstance(raw, datetime):
        d = raw
    else:
        try:
            d = dateparser.parse(str(raw))
        except Exception:
            return None
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def _idx(name: str) -> int:
    return FEATURE_NAMES.index(name)


def _row_features(past: list, target_date: datetime) -> list:
    """
    Calcula features usando SOLO el historial pasado — nunca el valor que se
    quiere predecir. `past` es una lista ordenada de (fecha, cantidad, cedis_id).
    """
    quantities = [h[1] for h in past]
    dates = [h[0] for h in past]

    qty_promedio = float(np.mean(quantities))
    qty_std = float(np.std(quantities)) if len(quantities) > 1 else 0.0
    qty_last = float(quantities[-1])

    recent = quantities[-4:] if len(quantities) >= 4 else quantities
    older = quantities[:-4] if len(quantities) > 4 else quantities
    tendencia = float(np.mean(recent) - np.mean(older))

    dias_desde_ultimo = (target_date - dates[-1]).days
    mes_objetivo = target_date.month
    frecuencia = len(quantities)
    gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
    gap_promedio = float(np.mean(gaps)) if gaps else 0.0

    return [
        qty_promedio, qty_std, qty_last, tendencia,
        dias_desde_ultimo, mes_objetivo, frecuencia, gap_promedio,
    ]


# ─── Construcción del dataset global (ventanas deslizantes) ─────────────────

def build_global_examples(db) -> list:
    """
    Construye ejemplos "secuencia → siguiente" combinando datos de TODOS los
    clientes. Cada ejemplo: con el historial de los primeros k pedidos de un
    (cliente, sku), el target es la cantidad real del pedido k+1.
    """
    orders = list(db.orders.find(
        {"status_final": "entregado"},
        {"id_pedido": 1, "customer_id": 1, "cedis_id": 1, "fecha_pedido": 1},
    ))

    meta = {}
    for o in orders:
        d = parse_date(o.get("fecha_pedido"))
        if d and o.get("customer_id"):
            meta[o["id_pedido"]] = {
                "fecha": d,
                "customer_id": o["customer_id"],
                "cedis_id": o.get("cedis_id"),
            }
    if not meta:
        return []

    details = list(db.orderdetails.find(
        {"id_pedido": {"$in": list(meta.keys())}},
        {"id_pedido": 1, "sku_solicitado": 1, "quantity": 1},
    ))

    history = defaultdict(list)
    for d in details:
        pid = d.get("id_pedido")
        sku = d.get("sku_solicitado")
        qty = d.get("quantity", 0)
        info = meta.get(pid)
        if sku and info and qty and qty > 0:
            history[(info["customer_id"], sku)].append((info["fecha"], qty, info["cedis_id"]))

    rows = []
    for (customer_id, sku), hist in history.items():
        hist_sorted = sorted(hist, key=lambda x: x[0])
        if len(hist_sorted) < MIN_ORDERS_PER_SKU:
            continue

        # Ventana deslizante: usa los primeros k pedidos para "predecir" el
        # (k+1)-ésimo, que ya ocurrió de verdad — esto es lo que evita la fuga.
        for k in range(2, len(hist_sorted)):
            past = hist_sorted[:k]
            target_fecha, target_qty, _ = hist_sorted[k]

            rows.append({
                "customer_id": customer_id,
                "sku": sku,
                "cedis_id": past[-1][2],
                "features": _row_features(past, target_fecha),
                "target": float(target_qty),
                "target_fecha": target_fecha,
            })

    return rows


def _make_model() -> xgb.XGBRegressor:
    return xgb.XGBRegressor(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        verbosity=0,
    )


# ─── Entrenamiento global con validación temporal + baselines ───────────────

def train_global_model(db, test_size: float = 0.2) -> Optional[dict]:
    """
    Entrena el modelo global y lo valida con un split TEMPORAL: los ejemplos
    más recientes se reservan para prueba (el modelo nunca los ve), simulando
    cómo se comportaría en producción real.

    Retorna {"model", "metrics", "rows"} o None si no hay datos suficientes.
    """
    rows = build_global_examples(db)
    if len(rows) < MIN_TRAINING_ROWS:
        return None

    rows_sorted = sorted(rows, key=lambda r: r["target_fecha"])
    split = int(len(rows_sorted) * (1 - test_size))
    train_rows, test_rows = rows_sorted[:split], rows_sorted[split:]
    if not test_rows or not train_rows:
        return None

    X_train = np.array([r["features"] for r in train_rows], dtype=float)
    y_train = np.array([r["target"] for r in train_rows], dtype=float)
    X_test = np.array([r["features"] for r in test_rows], dtype=float)
    y_test = np.array([r["target"] for r in test_rows], dtype=float)

    model = _make_model()
    model.fit(X_train, y_train)
    preds = np.maximum(1, model.predict(X_test))

    mae = float(mean_absolute_error(y_test, preds))
    rmse = float(np.sqrt(mean_squared_error(y_test, preds)))

    # Baselines ingenuas — si XGBoost no les gana, no vale la complejidad
    baseline_last = np.array([r["features"][_idx("qty_last")] for r in test_rows])
    baseline_avg = np.array([r["features"][_idx("qty_promedio")] for r in test_rows])
    mae_last = float(mean_absolute_error(y_test, baseline_last))
    mae_avg = float(mean_absolute_error(y_test, baseline_avg))
    mejor_baseline = min(mae_last, mae_avg)

    metrics = {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "mae_baseline_ultimo_pedido": round(mae_last, 2),
        "mae_baseline_promedio_historico": round(mae_avg, 2),
        "mejora_vs_mejor_baseline_pct": round((1 - mae / mejor_baseline) * 100, 1) if mejor_baseline else None,
        "supera_baseline": bool(mae < mejor_baseline),
        "muestras_train": len(train_rows),
        "muestras_test": len(test_rows),
    }

    # Reentrena con TODO el histórico para producción (más datos = mejor modelo final).
    # La validación de arriba ya nos dice qué tan bien generaliza este enfoque.
    final_model = _make_model()
    X_all = np.array([r["features"] for r in rows_sorted], dtype=float)
    y_all = np.array([r["target"] for r in rows_sorted], dtype=float)
    final_model.fit(X_all, y_all)

    return {"model": final_model, "metrics": metrics, "rows": rows_sorted}


# ─── Generación de sugerencias actuales para un cliente ─────────────────────

def suggest_for_customer(model: xgb.XGBRegressor, db, customer_id: str) -> Optional[dict]:
    """Usa el modelo global ya entrenado para sugerir cantidades a un cliente específico."""
    orders = list(db.orders.find(
        {"customer_id": customer_id, "status_final": "entregado"},
        {"id_pedido": 1, "fecha_pedido": 1, "cedis_id": 1},
    ))
    meta = {}
    cedis_id = None
    for o in orders:
        d = parse_date(o.get("fecha_pedido"))
        if d:
            meta[o["id_pedido"]] = d
            cedis_id = o.get("cedis_id") or cedis_id
    if len(meta) < 2:
        return None

    details = list(db.orderdetails.find(
        {"id_pedido": {"$in": list(meta.keys())}},
        {"id_pedido": 1, "sku_solicitado": 1, "quantity": 1},
    ))
    history = defaultdict(list)
    for d in details:
        pid, sku, qty = d.get("id_pedido"), d.get("sku_solicitado"), d.get("quantity", 0)
        if sku and pid in meta and qty and qty > 0:
            history[sku].append((meta[pid], qty))

    stock_cache = {}
    if cedis_id:
        skus = list(history.keys())
        for item in db.inventariocedis.find(
            {"cedis_id": cedis_id, "sku": {"$in": skus}},
            {"sku": 1, "stock_disponible": 1},
        ):
            stock_cache[item["sku"]] = item.get("stock_disponible", 0)

    now = datetime.now(timezone.utc)
    suggestions = []
    for sku, hist in history.items():
        hist_sorted = sorted(hist, key=lambda x: x[0])
        if len(hist_sorted) < 2:
            continue

        features = _row_features(hist_sorted, now)
        qty_pred = max(1, round(float(model.predict(np.array([features]))[0])))
        stock = stock_cache.get(sku, -1)

        if stock == 0:
            continue
        if stock > 0:
            qty_pred = min(qty_pred, stock)

        suggestions.append({
            "sku": sku,
            "cantidad_sugerida": qty_pred,
            "cantidad_promedio_historica": round(features[_idx("qty_promedio")], 1),
            "stock_disponible": stock if stock >= 0 else None,
        })

    if not suggestions:
        return None

    return {
        "customer_id": customer_id,
        "cedis_id": cedis_id,
        "skus_sugeridos": suggestions,
        "total_skus": len(suggestions),
    }

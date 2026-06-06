import numpy as np
from datetime import datetime
from typing import Optional
from dateutil import parser as dateparser
from collections import defaultdict
import xgboost as xgb


def parse_date(raw) -> Optional[datetime]:
    if isinstance(raw, datetime):
        return raw
    try:
        return dateparser.parse(str(raw))
    except Exception:
        return None


def build_customer_sku_features(customer_id: str, cedis_id: Optional[str], db) -> list:
    """
    Por cada SKU que el cliente ha pedido históricamente, construye un vector de features.
    Retorna lista de dicts con features + sku.
    """
    # Traer todos los pedidos del cliente con sus detalles
    orders = list(db.orders.find(
        {"customer_id": customer_id, "status_final": "entregado"},
        {"id_pedido": 1, "fecha_pedido": 1}
    ))

    if len(orders) < 3:
        return []

    order_map = {}
    for o in orders:
        d = parse_date(o.get("fecha_pedido"))
        if d:
            order_map[o["id_pedido"]] = d

    if not order_map:
        return []

    # Traer detalles de esos pedidos
    id_pedidos = list(order_map.keys())
    details = list(db.orderdetails.find(
        {"id_pedido": {"$in": id_pedidos}},
        {"id_pedido": 1, "sku_solicitado": 1, "quantity": 1}
    ))

    # Agrupar por SKU: lista de (fecha, cantidad)
    sku_history = defaultdict(list)
    for d in details:
        pid = d.get("id_pedido")
        sku = d.get("sku_solicitado")
        qty = d.get("quantity", 0)
        fecha = order_map.get(pid)
        if sku and fecha and qty > 0:
            sku_history[sku].append((fecha, qty))

    if not sku_history:
        return []

    now = datetime.now()
    all_dates = sorted(order_map.values())
    last_order_date = all_dates[-1]
    dias_desde_ultimo = (now - last_order_date).days
    mes_actual = now.month

    # Stock disponible en el CEDIS del cliente
    stock_cache = {}
    if cedis_id:
        skus_cliente = list(sku_history.keys())
        inventario = db.inventariocedis.find(
            {"cedis_id": cedis_id, "sku": {"$in": skus_cliente}},
            {"sku": 1, "stock_disponible": 1}
        )
        for item in inventario:
            stock_cache[item["sku"]] = item.get("stock_disponible", 0)

    rows = []
    for sku, history in sku_history.items():
        history_sorted = sorted(history, key=lambda x: x[0])
        quantities = [h[1] for h in history_sorted]

        qty_promedio = float(np.mean(quantities))
        qty_std = float(np.std(quantities)) if len(quantities) > 1 else 0.0
        qty_last = float(quantities[-1])
        # Tendencia últimas 4 semanas vs anteriores
        recent = quantities[-4:] if len(quantities) >= 4 else quantities
        older = quantities[:-4] if len(quantities) > 4 else quantities
        tendencia = float(np.mean(recent) - np.mean(older))

        stock = stock_cache.get(sku, -1)  # -1 = sin dato de inventario
        frecuencia = len(quantities)       # cuántas veces lo ha pedido

        rows.append({
            "sku": sku,
            "features": [
                qty_promedio,
                qty_std,
                qty_last,
                tendencia,
                dias_desde_ultimo,
                mes_actual,
                frecuencia,
                stock,
            ],
            "target": qty_promedio,  # lo que queremos predecir
            "stock_disponible": stock,
        })

    return rows


def train_and_suggest(customer_id: str, cedis_id: Optional[str], db) -> Optional[dict]:
    rows = build_customer_sku_features(customer_id, cedis_id, db)

    if not rows:
        return None

    # XGBoost necesita varios samples para entrenar bien.
    # Con pocos SKUs usamos el modelo para rankear + ajustar, no solo predecir.
    X = np.array([r["features"] for r in rows], dtype=float)
    y = np.array([r["target"] for r in rows], dtype=float)

    model = xgb.XGBRegressor(
        n_estimators=50,
        max_depth=3,
        learning_rate=0.1,
        subsample=0.8,
        random_state=42,
        verbosity=0,
    )
    model.fit(X, y)
    predictions = model.predict(X)

    suggestions = []
    for i, row in enumerate(rows):
        qty_pred = max(1, round(float(predictions[i])))
        stock = row["stock_disponible"]

        # Filtrar SKUs sin stock si tenemos dato de inventario
        if stock == 0:
            continue

        # Si hay stock pero es menor a lo sugerido, ajustar
        if stock > 0:
            qty_pred = min(qty_pred, stock)

        suggestions.append({
            "sku": row["sku"],
            "cantidad_sugerida": qty_pred,
            "cantidad_promedio_historica": round(row["target"], 1),
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

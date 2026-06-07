from fastapi import FastAPI, BackgroundTasks, HTTPException
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional
from prophet_model import train_and_predict
from xgboost_model import train_global_model, suggest_for_customer
from db import db
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Cache de DIAGNÓSTICO del modelo global de cantidad (XGBoost) ───────────
# IMPORTANTE: este modelo YA NO se usa para generar sugerencias en producción.
# La validación honesta (ver xgboost_model.py) mostró que pierde contra un
# baseline simple ("va a pedir lo mismo que la última vez"), así que producción
# usa suggest_quantity_heuristic (suavizado exponencial) — no requiere modelo.
#
# Este caché solo sirve para /train-global y /quantity-model/status: una forma
# de re-evaluar de vez en cuando si, con más datos reales acumulados, XGBoost
# empieza a aportar algo. Si algún día "supera_baseline" sale true de forma
# consistente, ahí sí valdría la pena cambiar la producción a usarlo.
_quantity_model_cache = {"model": None, "metrics": None, "trained_at": None}


def _save_quantity_metrics(metrics: dict):
    """Guarda las métricas de validación en MetricaML para monitoreo histórico."""
    try:
        db.metricamls.insert_one({
            "modelo": "xgboost_quantity_global",
            "tipo": "regresion",
            "version": "v2_global_sliding_window",
            "mae": metrics["mae"],
            "rmse": metrics["rmse"],
            "muestras": metrics["muestras_train"] + metrics["muestras_test"],
            "fecha": datetime.now(timezone.utc),
            # Campos extra de contexto (no están en el schema de Mongoose pero
            # se guardan igual — útiles para depurar si el modelo vale la pena)
            "mae_baseline_ultimo_pedido": metrics["mae_baseline_ultimo_pedido"],
            "mae_baseline_promedio_historico": metrics["mae_baseline_promedio_historico"],
            "mejora_vs_mejor_baseline_pct": metrics["mejora_vs_mejor_baseline_pct"],
            "supera_baseline": metrics["supera_baseline"],
        })
    except Exception:
        logger.exception("[B-global] No se pudieron guardar las métricas en MetricaML")


def _train_and_cache_quantity_model() -> Optional[dict]:
    result = train_global_model(db)
    if not result:
        return None
    _quantity_model_cache["model"] = result["model"]
    _quantity_model_cache["metrics"] = result["metrics"]
    _quantity_model_cache["trained_at"] = datetime.now(timezone.utc)
    _save_quantity_metrics(result["metrics"])
    logger.info(f"[B-global] Modelo entrenado — MAE {result['metrics']['mae']} "
                f"(baseline {result['metrics']['mae_baseline_promedio_historico']}, "
                f"supera_baseline={result['metrics']['supera_baseline']})")
    return result


def _get_cached_quantity_model():
    """Regresa el modelo cacheado, entrenándolo primero si aún no existe."""
    if _quantity_model_cache["model"] is None:
        _train_and_cache_quantity_model()
    return _quantity_model_cache["model"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("ML service started")
    yield


app = FastAPI(title="ML Service — Modelo A + B", lifespan=lifespan)


# ─── helpers ────────────────────────────────────────────────────────────────

def get_cedis(customer_id: str) -> str | None:
    pipeline = [
        {"$match": {"customer_id": customer_id}},
        {"$group": {"_id": "$cedis_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 1},
    ]
    result = list(db.orders.aggregate(pipeline))
    return result[0]["_id"] if result else None


# ─── Modelo A helpers ────────────────────────────────────────────────────────

def upsert_timing(result: dict):
    db.orderpatterns.update_one(
        {"customer_id": result["customer_id"], "sku": "__timing__"},
        {"$set": {
            "cedis_id": result.get("cedis_id"),
            "gap_promedio_dias": result["gap_promedio_dias"],
            "proximo_reorden": datetime.fromisoformat(result["next_order"]),
            "confianza": result["confianza"],
            "model_type": "timing",
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )


def run_train_timing(customer_id: str):
    cedis_id = get_cedis(customer_id)
    result = train_and_predict(customer_id, cedis_id, db)
    if result:
        upsert_timing(result)
        logger.info(f"[A] {customer_id} → next order {result['next_order']}")
    else:
        logger.warning(f"[A] {customer_id} skipped: not enough data")
    return result


# ─── Modelo B helpers ────────────────────────────────────────────────────────

def upsert_quantity(result: dict):
    customer_id = result["customer_id"]
    cedis_id = result.get("cedis_id")
    now = datetime.now(timezone.utc)
    valid_skus = [item["sku"] for item in result["skus_sugeridos"]]

    # Borrar sugerencias viejas que ya no son válidas (ej. SKU se quedó sin stock)
    db.orderpatterns.delete_many({
        "customer_id": customer_id,
        "model_type": "quantity",
        "sku": {"$nin": valid_skus},
    })

    for item in result["skus_sugeridos"]:
        db.orderpatterns.update_one(
            {"customer_id": customer_id, "sku": item["sku"]},
            {"$set": {
                "cedis_id": cedis_id,
                "cantidad_promedio": item["cantidad_promedio_historica"],
                "cantidad_sugerida": item["cantidad_sugerida"],
                "stock_disponible": item.get("stock_disponible"),
                "model_type": "quantity",
                "updated_at": now,
            }},
            upsert=True,
        )


def run_suggest_quantity(customer_id: str):
    """
    Genera sugerencias de cantidad para un cliente usando la heurística de
    suavizado exponencial — la opción que ganó la validación honesta contra
    XGBoost (ver docstring de xgboost_model.py). No requiere entrenar nada.
    """
    result = suggest_for_customer(db, customer_id)
    if result:
        upsert_quantity(result)
        logger.info(f"[B] {customer_id} → {result['total_skus']} SKUs sugeridos (heurística)")
    else:
        logger.warning(f"[B] {customer_id} skipped: not enough order history")
    return result


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "ml-service"}


# — Modelo A (timing) —

@app.post("/train/all")
def train_all(background_tasks: BackgroundTasks):
    customer_ids = db.orders.distinct("customer_id")
    background_tasks.add_task(_train_all_task, customer_ids)
    return {"ok": True, "customers_queued": len(customer_ids)}


@app.post("/train/{customer_id}")
def train_timing(customer_id: str):
    try:
        result = run_train_timing(customer_id)
    except Exception as e:
        logger.exception(f"[A] Error {customer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    if not result:
        raise HTTPException(status_code=422, detail="Not enough order history (min 5 orders)")
    return {"ok": True, "prediction": result}


@app.get("/predict/{customer_id}")
def predict_timing(customer_id: str):
    doc = db.orderpatterns.find_one(
        {"customer_id": customer_id, "sku": "__timing__"},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No prediction found. Run /train first.")
    return doc


# — Modelo B (quantity, modelo GLOBAL) —

@app.post("/train-global")
def train_global():
    """
    (Re)entrena el modelo global de cantidad sugerida con datos de TODOS los
    clientes, lo valida con un split temporal y guarda las métricas (MAE/RMSE
    + comparación contra baselines) en MetricaML. Reemplaza el modelo cacheado.
    """
    try:
        result = _train_and_cache_quantity_model()
    except Exception as e:
        logger.exception(f"[B-global] Error entrenando modelo global: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    if not result:
        raise HTTPException(
            status_code=422,
            detail="No hay suficientes datos para entrenar el modelo global (mínimo ~30 ejemplos secuencia→siguiente)",
        )
    return {"ok": True, "metrics": result["metrics"], "muestras_totales": len(result["rows"])}


@app.get("/quantity-model/status")
def quantity_model_status():
    """Estado actual del modelo cacheado: si está entrenado y sus últimas métricas."""
    return {
        "entrenado": _quantity_model_cache["model"] is not None,
        "trained_at": _quantity_model_cache["trained_at"].isoformat() if _quantity_model_cache["trained_at"] else None,
        "metrics": _quantity_model_cache["metrics"],
    }


@app.post("/suggest/all")
def suggest_all(background_tasks: BackgroundTasks):
    customer_ids = db.orders.distinct("customer_id")
    background_tasks.add_task(_suggest_all_task, customer_ids)
    return {"ok": True, "customers_queued": len(customer_ids)}


@app.post("/suggest/{customer_id}")
def suggest_quantity(customer_id: str):
    try:
        result = run_suggest_quantity(customer_id)
    except Exception as e:
        logger.exception(f"[B] Error {customer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    if not result:
        raise HTTPException(status_code=422, detail="Not enough order history")
    return {"ok": True, "suggestion": result, "metodo": "suavizado_exponencial"}


@app.get("/suggest/{customer_id}")
def get_suggestion(customer_id: str):
    docs = list(db.orderpatterns.find(
        {"customer_id": customer_id, "model_type": "quantity"},
        {"_id": 0, "sku": 1, "cantidad_sugerida": 1, "cantidad_promedio": 1, "stock_disponible": 1},
    ))
    if not docs:
        raise HTTPException(status_code=404, detail="No suggestions found. Run /suggest first.")
    return {"customer_id": customer_id, "skus_sugeridos": docs}


# — Combo: ambos modelos a la vez —

@app.post("/train-full/{customer_id}")
def train_full(customer_id: str):
    try:
        timing = run_train_timing(customer_id)
        quantity = run_suggest_quantity(customer_id)
    except Exception as e:
        logger.exception(f"[FULL] Error {customer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return {
        "ok": True,
        "timing": timing,
        "quantity": quantity,
    }


# ─── background tasks ────────────────────────────────────────────────────────

def _train_all_task(customer_ids: list):
    ok, skip = 0, 0
    for cid in customer_ids:
        r = run_train_timing(cid)
        ok += 1 if r else 0
        skip += 0 if r else 1
    logger.info(f"[A] train/all done — ok:{ok} skip:{skip}")


def _suggest_all_task(customer_ids: list):
    ok, skip = 0, 0
    for cid in customer_ids:
        r = run_suggest_quantity(cid)
        ok += 1 if r else 0
        skip += 0 if r else 1
    logger.info(f"[B] suggest/all done — ok:{ok} skip:{skip}")

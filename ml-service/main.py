from fastapi import FastAPI, BackgroundTasks, HTTPException
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from prophet_model import train_and_predict
from xgboost_model import train_and_suggest
from db import db
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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


def run_train_quantity(customer_id: str):
    cedis_id = get_cedis(customer_id)
    result = train_and_suggest(customer_id, cedis_id, db)
    if result:
        upsert_quantity(result)
        logger.info(f"[B] {customer_id} → {result['total_skus']} SKUs sugeridos")
    else:
        logger.warning(f"[B] {customer_id} skipped: not enough data")
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


# — Modelo B (quantity) —

@app.post("/suggest/all")
def suggest_all(background_tasks: BackgroundTasks):
    customer_ids = db.orders.distinct("customer_id")
    background_tasks.add_task(_suggest_all_task, customer_ids)
    return {"ok": True, "customers_queued": len(customer_ids)}


@app.post("/suggest/{customer_id}")
def suggest_quantity(customer_id: str):
    try:
        result = run_train_quantity(customer_id)
    except Exception as e:
        logger.exception(f"[B] Error {customer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    if not result:
        raise HTTPException(status_code=422, detail="Not enough order history")
    return {"ok": True, "suggestion": result}


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
        quantity = run_train_quantity(customer_id)
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
        r = run_train_quantity(cid)
        ok += 1 if r else 0
        skip += 0 if r else 1
    logger.info(f"[B] suggest/all done — ok:{ok} skip:{skip}")

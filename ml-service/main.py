from fastapi import FastAPI, BackgroundTasks, HTTPException
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from prophet_model import train_and_predict
from db import db
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("ML service started")
    yield


app = FastAPI(title="ML Service — Modelo A (Prophet)", lifespan=lifespan)


def upsert_pattern(result: dict):
    db.orderpatterns.update_one(
        {"customer_id": result["customer_id"], "sku": "__timing__"},
        {
            "$set": {
                "cedis_id": result.get("cedis_id"),
                "gap_promedio_dias": result["gap_promedio_dias"],
                "proximo_reorden": datetime.fromisoformat(result["next_order"]),
                "confianza": result["confianza"],
                "model_type": "timing",
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )


def run_train(customer_id: str):
    # Get the most frequent cedis for this customer
    pipeline = [
        {"$match": {"customer_id": customer_id}},
        {"$group": {"_id": "$cedis_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 1},
    ]
    cedis_result = list(db.orders.aggregate(pipeline))
    cedis_id = cedis_result[0]["_id"] if cedis_result else None

    result = train_and_predict(customer_id, cedis_id, db)
    if result:
        upsert_pattern(result)
        logger.info(f"Trained customer {customer_id} → next order {result['next_order']}")
    else:
        logger.warning(f"Skipped customer {customer_id}: not enough data")
    return result


@app.get("/health")
def health():
    return {"status": "ok", "service": "ml-prophet"}


@app.post("/train/all")
def train_all(background_tasks: BackgroundTasks):
    customer_ids = db.orders.distinct("customer_id")
    background_tasks.add_task(_train_all_task, customer_ids)
    return {"ok": True, "customers_queued": len(customer_ids)}


@app.post("/train/{customer_id}")
def train_one(customer_id: str):
    result = run_train(customer_id)
    if not result:
        raise HTTPException(status_code=422, detail="Not enough order history (min 5 orders)")
    return {"ok": True, "prediction": result}


def _train_all_task(customer_ids: list[str]):
    success, skipped = 0, 0
    for cid in customer_ids:
        result = run_train(cid)
        if result:
            success += 1
        else:
            skipped += 1
    logger.info(f"train/all done — success: {success}, skipped: {skipped}")


@app.get("/predict/{customer_id}")
def predict(customer_id: str):
    doc = db.orderpatterns.find_one(
        {"customer_id": customer_id, "sku": "__timing__"},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No prediction found. Run /train first.")
    return doc

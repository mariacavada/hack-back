import numpy as np
from datetime import datetime, timedelta
from typing import Optional
from dateutil import parser as dateparser


def parse_date(raw) -> Optional[datetime]:
    if isinstance(raw, datetime):
        return raw
    try:
        return dateparser.parse(str(raw))
    except Exception:
        return None


def get_order_dates(customer_id: str, db) -> list:
    cursor = db.orders.find(
        {"customer_id": customer_id, "status_final": "entregado"},
        {"fecha_pedido": 1}
    )
    dates = []
    for doc in cursor:
        d = parse_date(doc.get("fecha_pedido"))
        if d:
            dates.append(d)

    seen = set()
    unique = []
    for d in sorted(dates):
        key = d.date()
        if key not in seen:
            seen.add(key)
            unique.append(d)
    return unique


def train_and_predict(customer_id: str, cedis_id: Optional[str], db) -> Optional[dict]:
    dates = get_order_dates(customer_id, db)

    if len(dates) < 5:
        return None

    gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
    gaps = [g for g in gaps if g > 0]

    if len(gaps) < 4:
        return None

    gaps_arr = np.array(gaps, dtype=float)

    # Exponential weights: pedidos recientes pesan más
    weights = np.exp(np.linspace(0, 1, len(gaps_arr)))
    weights /= weights.sum()
    predicted_gap = float(np.dot(weights, gaps_arr))

    # Confianza: qué tan regular es el cliente (CV bajo = cliente predecible)
    cv = np.std(gaps_arr) / np.mean(gaps_arr)
    confidence = float(max(0.0, min(1.0, 1.0 - cv)))

    next_order = dates[-1] + timedelta(days=round(predicted_gap))
    avg_gap = float(np.mean(gaps_arr))

    return {
        "customer_id": customer_id,
        "cedis_id": cedis_id,
        "next_order": next_order.isoformat(),
        "gap_promedio_dias": round(avg_gap, 1),
        "confianza": round(confidence, 3),
        "last_order": dates[-1].isoformat(),
    }

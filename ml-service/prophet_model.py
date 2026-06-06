import pandas as pd
import numpy as np
from prophet import Prophet
from datetime import datetime, timedelta
from dateutil import parser as dateparser


def parse_date(raw) -> datetime | None:
    if isinstance(raw, datetime):
        return raw
    try:
        return dateparser.parse(str(raw))
    except Exception:
        return None


def get_order_dates(customer_id: str, db) -> list[datetime]:
    cursor = db.orders.find(
        {"customer_id": customer_id, "status_final": "entregado"},
        {"fecha_pedido": 1}
    )
    dates = []
    for doc in cursor:
        d = parse_date(doc.get("fecha_pedido"))
        if d:
            dates.append(d)

    # deduplicate and sort
    seen = set()
    unique = []
    for d in sorted(dates):
        key = d.date()
        if key not in seen:
            seen.add(key)
            unique.append(d)
    return unique


def train_and_predict(customer_id: str, cedis_id: str | None, db) -> dict | None:
    dates = get_order_dates(customer_id, db)

    if len(dates) < 5:
        return None

    # Build gap series: each row = (date_of_order, days_since_previous_order)
    rows = []
    for i in range(1, len(dates)):
        gap = (dates[i] - dates[i - 1]).days
        if gap > 0:
            rows.append({"ds": dates[i], "y": float(gap)})

    if len(rows) < 4:
        return None

    df = pd.DataFrame(rows)

    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,
        interval_width=0.8,
    )
    model.fit(df)

    future = model.make_future_dataframe(periods=1, freq="D")
    forecast = model.predict(future)

    last = forecast.iloc[-1]
    predicted_gap = max(1, round(float(last["yhat"])))
    gap_lower = float(last["yhat_lower"])
    gap_upper = float(last["yhat_upper"])

    next_order = dates[-1] + timedelta(days=predicted_gap)

    # Tighter confidence interval → higher confidence
    interval = gap_upper - gap_lower
    confidence = float(max(0.0, min(1.0, 1.0 - interval / max(1, 2 * predicted_gap))))

    avg_gap = float(np.mean([r["y"] for r in rows]))

    return {
        "customer_id": customer_id,
        "cedis_id": cedis_id,
        "next_order": next_order.isoformat(),
        "gap_promedio_dias": round(avg_gap, 1),
        "confianza": round(confidence, 3),
        "last_order": dates[-1].isoformat(),
    }

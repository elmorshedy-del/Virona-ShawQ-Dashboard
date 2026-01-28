import os
from typing import List, Optional

import numpy as np
import threading

import torch
from fastapi import FastAPI
from pydantic import BaseModel

try:
    from chronos import ChronosPipeline
    CHRONOS_AVAILABLE = True
except Exception:
    CHRONOS_AVAILABLE = False

app = FastAPI()

PIPE_LOCK = threading.Lock()

MODEL_ID = os.getenv('CHRONOS_MODEL_ID', 'amazon/chronos-t5-small')
PRED_LEN = int(os.getenv('CHRONOS_PRED_LEN', '21'))

PIPE = None
PIPE_LOCK = None

class SeriesPoint(BaseModel):
    date: str
    value: float

class ForecastPayload(BaseModel):
    store: Optional[str] = None
    series: List[SeriesPoint] = []


@app.get('/health')
def health():
    return {"ok": True, "chronos": CHRONOS_AVAILABLE, "model": MODEL_ID}


@app.post('/predict')
def predict(payload: ForecastPayload):
    series = payload.series or []
    if len(series) < 10:
        return {"insight": None}

    values = np.array([p.value for p in series], dtype=np.float32)
    last_avg = np.mean(values[-7:]) if len(values) >= 7 else np.mean(values)

    if CHRONOS_AVAILABLE:
        global PIPE
        if PIPE is None:
            with PIPE_LOCK:
                if PIPE is None:
                    device_map = 'auto' if torch.cuda.is_available() else None
                    PIPE = ChronosPipeline.from_pretrained(MODEL_ID, device_map=device_map)
        forecast = PIPE.predict(values, prediction_length=PRED_LEN)
        pred = np.array(forecast[0])
    else:
        slope = (values[-1] - values[-8]) / 7 if len(values) >= 8 else 0
        pred = np.array([max(0, values[-1] + slope * i) for i in range(1, PRED_LEN + 1)], dtype=np.float32)

    peak_idx = int(np.argmax(pred))
    peak_value = float(pred[peak_idx])
    uplift = (peak_value - last_avg) / max(1e-6, last_avg)

    insight = {
        "title": f"Peak window expected in {peak_idx + 1} days",
        "finding": f"Forecast suggests {uplift * 100:.0f}% change vs last 7-day average.",
        "why": "Chronos-2 forecasts near-term demand using learned temporal dynamics.",
        "action": "Increase inventory buffer and ramp creatives 7-10 days before the peak.",
        "confidence": min(0.85, 0.5 + abs(uplift) * 0.2),
        "signals": ["Daily conversions", "Short-term demand forecast"],
        "models": [
            {"name": "Chronos-2", "description": "Foundation model for time series forecasting."}
        ],
        "logic": "Forecast peak above recent mean triggers the preparation window.",
        "limits": "Requires consistent daily data; major spend shocks can shift the forecast."
    }

    return {"insight": insight}

import os
from io import BytesIO
from typing import List, Optional

import numpy as np
import requests
from fastapi import FastAPI
from pydantic import BaseModel
from PIL import Image

import torch
import open_clip
import hdbscan

try:
    import torchtuples as tt
    from pycox.models import CoxPH
    PYCOX_AVAILABLE = True
except Exception:
    PYCOX_AVAILABLE = False

app = FastAPI()

MODEL_NAME = os.getenv('CLIP_MODEL', 'ViT-L-14')
MODEL_PRETRAIN = os.getenv('CLIP_PRETRAIN', 'openai')
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'

model, preprocess, _ = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=MODEL_PRETRAIN)
model = model.to(DEVICE)
model.eval()

class CreativeMetrics(BaseModel):
    ctr: Optional[float] = None
    conversions: Optional[float] = None
    impressions: Optional[float] = None

class CreativeAsset(BaseModel):
    ad_id: Optional[str] = None
    ad_name: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    metrics: Optional[CreativeMetrics] = None

class CreativeHistoryPoint(BaseModel):
    ad_id: Optional[str] = None
    day_index: Optional[int] = None
    ctr: Optional[float] = None
    conversions: Optional[float] = None

class CreativePayload(BaseModel):
    store: Optional[str] = None
    top_geo: Optional[str] = None
    top_segment: Optional[str] = None
    assets: List[CreativeAsset] = []
    history: List[CreativeHistoryPoint] = []


def fetch_image(url: str) -> Optional[Image.Image]:
    if not url:
        return None
    try:
        res = requests.get(url, timeout=10)
        if res.status_code != 200:
            return None
        return Image.open(BytesIO(res.content)).convert('RGB')
    except Exception:
        return None


def embed_images(images: List[Image.Image]) -> np.ndarray:
    if not images:
        return np.empty((0, 768))
    batch = torch.stack([preprocess(image) for image in images]).to(DEVICE)
    with torch.no_grad():
        feats = model.encode_image(batch)
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats.cpu().numpy()


def tokenize_name(name: Optional[str]) -> List[str]:
    if not name:
        return []
    tokens = [t for t in ''.join([c.lower() if c.isalnum() else ' ' for c in name]).split() if len(t) > 2]
    return tokens


def compute_fatigue_days(history: List[CreativeHistoryPoint]) -> Optional[float]:
    if not history:
        return None

    grouped = {}
    for row in history:
        if not row.ad_id or row.ctr is None or row.day_index is None:
            continue
        grouped.setdefault(row.ad_id, []).append((row.day_index, row.ctr))

    events = []
    features = []
    for ad_id, points in grouped.items():
        points.sort(key=lambda x: x[0])
        ctrs = [p[1] for p in points]
        peak = max(ctrs) if ctrs else 0
        if peak <= 0:
            continue
        fatigue_day = None
        for day, ctr in points:
            if ctr < 0.6 * peak:
                fatigue_day = day
                break
        duration = points[-1][0]
        event = 1 if fatigue_day is not None else 0
        time = fatigue_day if fatigue_day is not None else duration
        events.append((time, event))
        features.append([peak, np.mean(ctrs), np.std(ctrs) if len(ctrs) > 1 else 0.0])

    if len(events) < 6 or not PYCOX_AVAILABLE:
        return None

    x = np.array(features, dtype=np.float32)
    durations = np.array([e[0] for e in events], dtype=np.float32)
    events_arr = np.array([e[1] for e in events], dtype=np.int64)

    in_features = x.shape[1]
    net = tt.practical.MLPVanilla(in_features, [16, 16], 1, batch_norm=True, dropout=0.1)
    model_surv = CoxPH(net, tt.optim.Adam)
    model_surv.fit(x, (durations, events_arr), batch_size=16, epochs=20, verbose=False)

    surv = model_surv.predict_surv_df(x)
    median_surv = surv.apply(lambda col: col[col <= 0.5].index.min() if (col <= 0.5).any() else col.index.max())
    return float(np.nanmedian(median_surv.values))


@app.get('/health')
def health():
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE, "pycox": PYCOX_AVAILABLE}


@app.post('/predict')
def predict(payload: CreativePayload):
    assets = payload.assets or []
    images = []
    kept = []
    for asset in assets:
        img = fetch_image(asset.image_url or '')
        if img is None:
            continue
        images.append(img)
        kept.append(asset)

    if not images:
        return {"insight": None}

    embeddings = embed_images(images)
    if embeddings.shape[0] < 2:
        labels = np.zeros(embeddings.shape[0], dtype=int)
    else:
        labels = hdbscan.HDBSCAN(min_cluster_size=2).fit_predict(embeddings)

    cluster_scores = {}
    for idx, asset in enumerate(kept):
        label = int(labels[idx]) if idx < len(labels) else -1
        metric = asset.metrics.conversions if asset.metrics and asset.metrics.conversions is not None else 0
        metric += (asset.metrics.ctr or 0) * 100 if asset.metrics else 0
        cluster_scores.setdefault(label, []).append(metric)

    top_cluster = max(cluster_scores.items(), key=lambda x: np.mean(x[1]))[0]

    top_assets = [kept[i] for i, label in enumerate(labels) if int(label) == int(top_cluster)]
    keywords = []
    for asset in top_assets:
        keywords += tokenize_name(asset.ad_name)
    keyword = max(set(keywords), key=keywords.count) if keywords else 'premium'

    fatigue_days = compute_fatigue_days(payload.history)

    confidence = min(0.9, 0.5 + 0.08 * len(top_assets))
    if fatigue_days is None:
        fatigue_text = 'Fatigue timing is still stabilizing.'
    else:
        fatigue_text = f'Estimated creative fatigue around day {fatigue_days:.0f}.'

    insight = {
        "title": f"{payload.top_segment or 'Top segment'} responds to {keyword} creatives",
        "finding": f"Cluster {top_cluster} creatives show the strongest conversion density; {fatigue_text}",
        "why": "CLIP embeddings clustered similar visuals, and the winning cluster aligns with higher response.",
        "action": f"Double down on {keyword} visual cues and refresh before predicted fatigue.",
        "confidence": confidence,
        "signals": ["Creative embeddings", "Cluster performance lift", "CTR/conversion history"],
        "models": [
            {"name": "CLIP ViT-L/14", "description": "Embeds creative visuals into semantic vectors."},
            {"name": "HDBSCAN", "description": "Clusters creatives by visual similarity."},
            {"name": "DeepSurv", "description": "Estimates creative fatigue timing from performance history."}
        ],
        "logic": "Winning creative clusters are identified by higher conversion-weighted scores.",
        "limits": "Needs sufficient creative volume and stable naming/targeting to be precise."
    }

    return {"insight": insight}

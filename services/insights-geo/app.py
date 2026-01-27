import os
from typing import List, Optional

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

import torch
from sklearn.preprocessing import StandardScaler
from sklearn.metrics.pairwise import cosine_similarity

try:
    from tabpfn import TabPFNRegressor
    TABPFN_AVAILABLE = True
except Exception:
    TABPFN_AVAILABLE = False

PRED_CACHE = {}
EMBED_CACHE = {}
ENABLE_TABPFN = os.getenv('ENABLE_TABPFN', '1') == '1'
ENABLE_SIAMESE_TRAIN = os.getenv('ENABLE_SIAMESE_TRAIN', '1') == '1'

app = FastAPI()

class GeoFeature(BaseModel):
    geo: str
    spend: Optional[float] = 0
    conversions: Optional[float] = 0
    ctr: Optional[float] = 0
    cvr: Optional[float] = 0
    aov: Optional[float] = 0
    growth: Optional[float] = 0
    demand: Optional[float] = 0
    competition: Optional[float] = 0
    readiness: Optional[float] = 0

class GeoPayload(BaseModel):
    store: Optional[str] = None
    top_geo: Optional[str] = None
    geos: List[GeoFeature] = []

class SiameseNet(torch.nn.Module):
    def __init__(self, input_dim: int):
        super().__init__()
        self.net = torch.nn.Sequential(
            torch.nn.Linear(input_dim, 16),
            torch.nn.ReLU(),
            torch.nn.Linear(16, 8)
        )

    def forward(self, x):
        return self.net(x)


def train_siamese(features, labels, epochs=60):
    if len(features) < 4:
        return None
    x = torch.tensor(features, dtype=torch.float32)
    y = torch.tensor(labels, dtype=torch.long)
    model = SiameseNet(x.shape[1])
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)

    for _ in range(epochs):
        optimizer.zero_grad()
        embeds = model(x)
        loss = 0
        pairs = 0
        for i in range(len(x)):
            for j in range(i + 1, len(x)):
                same = 1 if y[i] == y[j] else 0
                dist = torch.nn.functional.pairwise_distance(embeds[i].unsqueeze(0), embeds[j].unsqueeze(0))
                loss += same * dist.pow(2) + (1 - same) * torch.clamp(1 - dist, min=0).pow(2)
                pairs += 1
        loss = loss / max(1, pairs)
        loss.backward()
        optimizer.step()

    return model


@app.get('/health')
def health():
    return {"ok": True, "tabpfn": TABPFN_AVAILABLE}


@app.post('/predict')
def predict(payload: GeoPayload):
    geos = payload.geos or []
    if len(geos) < 2:
        return {"insight": None}

    features = np.array([
        [g.spend or 0, g.conversions or 0, g.ctr or 0, g.cvr or 0, g.aov or 0, g.growth or 0,
         g.demand or 0, g.competition or 0, g.readiness or 0]
        for g in geos
    ], dtype=np.float32)

    scaler = StandardScaler()
    features_scaled = scaler.fit_transform(features)

    target = np.array([g.conversions or g.demand or 0 for g in geos], dtype=np.float32)

    preds = target.copy()
    if TABPFN_AVAILABLE and ENABLE_TABPFN and len(geos) >= 4:
        cache_key = hash(features_scaled.tobytes() + target.tobytes())
        cached = PRED_CACHE.get(cache_key)
        if cached is None:
            model = TabPFNRegressor(device='cpu', n_estimators=16)
            model.fit(features_scaled, target)
            preds = model.predict(features_scaled)
            PRED_CACHE[cache_key] = preds
        else:
            preds = cached

    # labels for siamese (top vs bottom)
    threshold = np.median(preds)
    labels = (preds >= threshold).astype(int)

    embeddings = features_scaled
    if ENABLE_SIAMESE_TRAIN:
        embed_key = hash(features_scaled.tobytes() + labels.tobytes())
        cached_embed = EMBED_CACHE.get(embed_key)
        if cached_embed is None:
            siamese_model = train_siamese(features_scaled, labels)
            if siamese_model is not None:
                with torch.no_grad():
                    embeddings = siamese_model(torch.tensor(features_scaled, dtype=torch.float32)).numpy()
            EMBED_CACHE[embed_key] = embeddings
        else:
            embeddings = cached_embed

    # choose candidate not top_geo
    ranked = sorted(zip(geos, preds, embeddings), key=lambda x: x[1], reverse=True)
    candidate = ranked[0]
    if payload.top_geo and ranked[0][0].geo == payload.top_geo and len(ranked) > 1:
        candidate = ranked[1]

    top_geo = next((g for g in geos if g.geo == payload.top_geo), ranked[0][0])
    sim = cosine_similarity(candidate[2].reshape(1, -1), embeddings[geos.index(top_geo)].reshape(1, -1))[0][0]
    confidence = min(0.85, 0.55 + float(np.std(preds)) / (np.mean(preds) + 1e-6))

    insight = {
        "title": f"{candidate[0].geo} shows the strongest geo opportunity",
        "finding": f"Predicted conversion potential ranks {candidate[0].geo} above peers; similarity to {top_geo.geo} is {sim*100:.0f}%.",
        "why": "Tabular foundation model scores each geo on performance signals; siamese embedding matches to winning markets.",
        "action": f"Run a 14-day test in {candidate[0].geo} with localized creatives.",
        "confidence": confidence,
        "signals": ["Geo spend & conversion profile", "CTR/CVR lift", "Demand/competition balance"],
        "models": [
            {"name": "TabPFN", "description": "Tabular foundation model for low-data geo prediction."},
            {"name": "Siamese Similarity", "description": "Learns geo embeddings to match with winning markets."}
        ],
        "logic": "Candidate geo ranks top in predicted conversions while remaining similar to best-performing markets.",
        "limits": "Limited geo history reduces generalization; external market data not included yet."
    }

    return {"insight": insight}

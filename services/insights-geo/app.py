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
CACHE_MAX = int(os.getenv('MODEL_CACHE_MAX', '64'))
ENABLE_TABPFN = os.getenv('ENABLE_TABPFN', '0') == '1'
ENABLE_SIAMESE_TRAIN = os.getenv('ENABLE_SIAMESE_TRAIN', '0') == '1'
MIN_GEOS_FOR_TABPFN = int(os.getenv('MIN_GEOS_FOR_TABPFN', '6'))
MIN_GEOS_FOR_SIAMESE = int(os.getenv('MIN_GEOS_FOR_SIAMESE', '10'))


def _lru_put(cache: dict, key: int, value):
    cache[key] = value
    if len(cache) > CACHE_MAX:
        cache.pop(next(iter(cache)))


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
    method: Optional[str] = None

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


def _opportunity_score(features: np.ndarray) -> np.ndarray:
    def norm(col):
        min_val = float(col.min())
        max_val = float(col.max())
        if max_val == min_val:
            return np.full_like(col, 0.5, dtype=np.float32)
        return (col - min_val) / (max_val - min_val)

    demand = norm(features[:, 6])
    competition = norm(features[:, 7])
    readiness = norm(features[:, 8])
    growth = norm(features[:, 5])
    conversions = norm(features[:, 1])
    score = demand * 0.35 + readiness * 0.2 + growth * 0.2 + conversions * 0.15 - competition * 0.2
    return score.astype(np.float32)


@app.get('/health')
def health():
    return {
        "ok": True,
        "tabpfn": TABPFN_AVAILABLE,
        "tabpfn_enabled": ENABLE_TABPFN,
        "siamese_enabled": ENABLE_SIAMESE_TRAIN,
        "min_geos_for_tabpfn": MIN_GEOS_FOR_TABPFN,
        "min_geos_for_siamese": MIN_GEOS_FOR_SIAMESE,
    }


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
    baseline_score = _opportunity_score(features)

    requested = (payload.method or 'auto').lower()
    warnings = []

    use_tabpfn = False
    use_siamese = False

    if requested in ('tabpfn', 'tabpfn+siamese'):
        if not TABPFN_AVAILABLE:
            warnings.append('TabPFN not installed in this service.')
        elif not ENABLE_TABPFN:
            warnings.append('TabPFN disabled (ENABLE_TABPFN=0).')
        elif len(geos) < MIN_GEOS_FOR_TABPFN:
            warnings.append(f'TabPFN needs at least {MIN_GEOS_FOR_TABPFN} geos with data.')
        else:
            use_tabpfn = True
    if requested in ('siamese', 'tabpfn+siamese'):
        if not ENABLE_SIAMESE_TRAIN:
            warnings.append('Siamese embeddings disabled (ENABLE_SIAMESE_TRAIN=0).')
        elif len(geos) < MIN_GEOS_FOR_SIAMESE:
            warnings.append(f'Siamese embeddings need at least {MIN_GEOS_FOR_SIAMESE} geos.')
        else:
            use_siamese = True

    if requested == 'scorer':
        use_tabpfn = False
        use_siamese = False
    elif requested == 'tabpfn':
        use_siamese = False
    elif requested == 'siamese':
        use_tabpfn = False

    if requested == 'auto':
        use_tabpfn = TABPFN_AVAILABLE and ENABLE_TABPFN and len(geos) >= MIN_GEOS_FOR_TABPFN
        use_siamese = ENABLE_SIAMESE_TRAIN and len(geos) >= MIN_GEOS_FOR_SIAMESE

    preds = baseline_score.copy()
    if use_tabpfn:
        cache_key = hash(features_scaled.tobytes() + target.tobytes())
        cached = PRED_CACHE.get(cache_key)
        if cached is None:
            model = TabPFNRegressor(device='cpu', n_estimators=16)
            model.fit(features_scaled, target)
            preds = model.predict(features_scaled)
            _lru_put(PRED_CACHE, cache_key, preds)
        else:
            preds = cached

    threshold = np.median(preds)
    labels = (preds >= threshold).astype(int)

    embeddings = features_scaled
    if use_siamese:
        embed_key = hash(features_scaled.tobytes() + labels.tobytes())
        cached_embed = EMBED_CACHE.get(embed_key)
        if cached_embed is None:
            siamese_model = train_siamese(features_scaled, labels)
            if siamese_model is not None:
                with torch.no_grad():
                    embeddings = siamese_model(torch.tensor(features_scaled, dtype=torch.float32)).numpy()
            _lru_put(EMBED_CACHE, embed_key, embeddings)
        else:
            embeddings = cached_embed

    ranked = sorted(zip(geos, preds, embeddings), key=lambda x: x[1], reverse=True)
    candidate = ranked[0]
    if payload.top_geo and ranked[0][0].geo == payload.top_geo and len(ranked) > 1:
        candidate = ranked[1]

    top_geo = next((g for g in geos if g.geo == payload.top_geo), ranked[0][0])
    sim = cosine_similarity(candidate[2].reshape(1, -1), embeddings[geos.index(top_geo)].reshape(1, -1))[0][0]
    confidence = min(0.85, 0.55 + float(np.std(preds)) / (np.mean(preds) + 1e-6))

    method_used = 'scorer'
    if use_tabpfn and use_siamese:
        method_used = 'tabpfn+siamese'
    elif use_tabpfn:
        method_used = 'tabpfn'
    elif use_siamese:
        method_used = 'scorer+siamese'

    used_models = []
    used_models.append({
        "name": "TabPFN" if use_tabpfn else "Geo Opportunity Scorer",
        "description": "Tabular foundation model for low-data geo prediction." if use_tabpfn else "Weighted scoring on demand, readiness, growth, conversions, and competition.",
    })

    used_models.append({
        "name": "Siamese Similarity" if use_siamese else "Cosine Similarity",
        "description": "Learns geo embeddings to match winning markets." if use_siamese else "Matches geos by cosine similarity over normalized features.",
    })

    models_available = [
        {
            "name": "TabPFN (optional)",
            "description": f"Enable when you have >= {MIN_GEOS_FOR_TABPFN} geos and can afford heavier inference.",
            "enabled": bool(TABPFN_AVAILABLE and ENABLE_TABPFN),
        },
        {
            "name": "Siamese Similarity (optional)",
            "description": f"Enable when you have >= {MIN_GEOS_FOR_SIAMESE} geos and want learned embeddings.",
            "enabled": bool(ENABLE_SIAMESE_TRAIN),
        },
    ]

    insight = {
        "title": f"{candidate[0].geo} shows the strongest geo opportunity",
        "finding": f"Predicted conversion potential ranks {candidate[0].geo} above peers; similarity to {top_geo.geo} is {sim*100:.0f}%.",
        "why": "Geo scoring compares demand, readiness, and competition; similarity matches to winning markets.",
        "action": f"Run a 14-day test in {candidate[0].geo} with localized creatives.",
        "confidence": confidence,
        "signals": ["Geo spend & conversion profile", "CTR/CVR lift", "Demand/competition balance"],
        "models": used_models,
        "models_available": models_available,
        "method_requested": requested,
        "method_used": method_used,
        "warnings": warnings,
        "logic": "Candidate geo ranks top in predicted conversions while remaining similar to best-performing markets.",
        "limits": "If TabPFN/Siamese are disabled, this uses a lightweight scorer + cosine similarity. Add external market data for stronger geo discovery.",
    }

    return {"insight": insight}

import os
from typing import Dict, List, Optional, Tuple

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

# Default engine (ON): directional co-purchase + simple transitions (fast, explainable).
# Optional (OFF): GraphSAGE/SASRec via offline artifacts for large shops.

ENABLE_GRAPHSAGE = os.getenv("ENABLE_GRAPHSAGE", "0") == "1"
ENABLE_SASREC = os.getenv("ENABLE_SASREC", "0") == "1"

MIN_ITEMS_FOR_GRAPHSAGE = int(os.getenv("MIN_ITEMS_FOR_GRAPHSAGE", "200"))
MIN_SESSIONS_FOR_SASREC = int(os.getenv("MIN_SESSIONS_FOR_SASREC", "5000"))

MODEL_DIR = os.getenv("MODEL_DIR", "/app/models")
GRAPHSAGE_EMB_PATH = os.path.join(MODEL_DIR, "graphsage_item_embeddings.npy")
SASREC_TRANS_PATH = os.path.join(MODEL_DIR, "sasrec_transition_scores.npy")

CACHE: Dict[int, dict] = {}
CACHE_MAX = int(os.getenv("MODEL_CACHE_MAX", "64"))


class Order(BaseModel):
    order_id: Optional[str] = None
    items: List[str] = []


class Edge(BaseModel):
    source: str
    target: str
    weight: Optional[float] = 1.0


class Transition(BaseModel):
    source: str
    target: str
    weight: Optional[float] = 1.0


class AdjacentPayload(BaseModel):
    store: Optional[str] = None
    orders: List[Order] = []
    edges: List[Edge] = []
    transitions: List[Transition] = []  # optional session-based transitions
    anchor: Optional[str] = None
    session_count: Optional[int] = 0  # optional, for gating SASRec


def _lru_put(key: int, value: dict) -> None:
    CACHE[key] = value
    if len(CACHE) > CACHE_MAX:
        CACHE.pop(next(iter(CACHE)))


def _build_pair_counts_from_orders(orders: List[Order]) -> Dict[Tuple[str, str], int]:
    counts: Dict[Tuple[str, str], int] = {}
    for order in orders:
        items = list(dict.fromkeys(order.items or []))
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i], items[j]
                if not a or not b or a == b:
                    continue
                key = (a, b) if a < b else (b, a)
                counts[key] = counts.get(key, 0) + 1
    return counts


def _compute_item_counts(orders: List[Order]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for order in orders:
        for item in set(order.items or []):
            if not item:
                continue
            counts[item] = counts.get(item, 0) + 1
    return counts


def _directional_assoc(
    item_counts: Dict[str, int],
    pair_counts: Dict[Tuple[str, str], int],
    total_orders: int,
    anchor: Optional[str] = None,
) -> List[dict]:
    out = []
    for (a, b), both in pair_counts.items():
        count_a = item_counts.get(a, 0)
        count_b = item_counts.get(b, 0)
        if count_a <= 0 or count_b <= 0:
            continue

        p_b_given_a = both / max(1, count_a)
        p_b = count_b / max(1, total_orders)
        lift_a_to_b = p_b_given_a / max(1e-9, p_b)
        out.append({"from": a, "to": b, "support": both, "p": p_b_given_a, "lift": lift_a_to_b})

        p_a_given_b = both / max(1, count_b)
        p_a = count_a / max(1, total_orders)
        lift_b_to_a = p_a_given_b / max(1e-9, p_a)
        out.append({"from": b, "to": a, "support": both, "p": p_a_given_b, "lift": lift_b_to_a})

    if anchor:
        out = [row for row in out if row["from"] == anchor]
    return sorted(out, key=lambda r: (r["lift"], r["support"]), reverse=True)


def _transition_probs(transitions: List[Transition], anchor: Optional[str] = None) -> Dict[Tuple[str, str], float]:
    totals: Dict[str, float] = {}
    counts: Dict[Tuple[str, str], float] = {}
    for t in transitions:
        src = t.source
        tgt = t.target
        w = float(t.weight or 1.0)
        if not src or not tgt or src == tgt:
            continue
        totals[src] = totals.get(src, 0.0) + w
        counts[(src, tgt)] = counts.get((src, tgt), 0.0) + w

    probs: Dict[Tuple[str, str], float] = {}
    for (src, tgt), w in counts.items():
        if anchor and src != anchor:
            continue
        probs[(src, tgt)] = w / max(1e-9, totals.get(src, 0.0))
    return probs


def _try_load_npy(path: str) -> Optional[np.ndarray]:
    try:
        if os.path.exists(path):
            return np.load(path)
    except Exception:
        return None
    return None


@app.get("/health")
def health():
    return {
        "ok": True,
        "enable_graphsage": ENABLE_GRAPHSAGE,
        "enable_sasrec": ENABLE_SASREC,
        "graphsage_embedded": os.path.exists(GRAPHSAGE_EMB_PATH),
        "sasrec_scores": os.path.exists(SASREC_TRANS_PATH),
        "thresholds": {
            "min_items_for_graphsage": MIN_ITEMS_FOR_GRAPHSAGE,
            "min_sessions_for_sasrec": MIN_SESSIONS_FOR_SASREC,
        },
    }


@app.post("/predict")
def predict(payload: AdjacentPayload):
    orders = payload.orders or []
    edges_in = payload.edges or []
    transitions_in = payload.transitions or []
    anchor = payload.anchor
    session_count = int(payload.session_count or 0)

    cache_key = hash(str(orders) + str(edges_in) + str(transitions_in) + str(anchor) + str(session_count))
    cached = CACHE.get(cache_key)
    if cached is not None:
        return {"insight": cached}

    items = set()
    for order in orders:
        items.update(order.items or [])
    for edge in edges_in:
        items.add(edge.source)
        items.add(edge.target)
    for t in transitions_in:
        items.add(t.source)
        items.add(t.target)

    items = sorted([x for x in items if x])
    if len(items) < 2:
        return {"insight": None}

    total_orders = len(orders)

    pair_counts: Dict[Tuple[str, str], int] = {}
    if edges_in:
        for e in edges_in:
            a, b = e.source, e.target
            if not a or not b or a == b:
                continue
            key = (a, b) if a < b else (b, a)
            pair_counts[key] = pair_counts.get(key, 0) + int(e.weight or 1)
    else:
        pair_counts = _build_pair_counts_from_orders(orders)

    item_counts = _compute_item_counts(orders)
    assoc = _directional_assoc(item_counts, pair_counts, total_orders=max(1, total_orders), anchor=anchor)
    trans_probs = _transition_probs(transitions_in, anchor=anchor)

    best = next((row for row in assoc if row["support"] >= 10), assoc[0] if assoc else None)
    if best is None:
        return {"insight": None}

    rec_item = best["to"]

    top_trans = None
    if trans_probs:
        candidates = [((src, tgt), prob) for (src, tgt), prob in trans_probs.items() if (not anchor or src == anchor)]
        if candidates:
            (src, tgt), prob = sorted(candidates, key=lambda kv: kv[1], reverse=True)[0]
            top_trans = {"from": src, "to": tgt, "p_next": float(prob)}

    models_used = [{"name": "Directional Co-purchase Lift", "description": "Computes P(Y|X) + lift to avoid popularity bias."}]
    signals = ["Order line items (co-purchase)"]
    if transitions_in:
        models_used.append({"name": "Markov Transition Model", "description": "Counts next-step transitions P(next|current) from sessions."})
        signals.append("Pixel/session transitions")

    models_available = [
        {
            "name": "GraphSAGE (optional)",
            "description": f"Enable when catalog >= {MIN_ITEMS_FOR_GRAPHSAGE} items and you have offline-trained embeddings.",
            "enabled": ENABLE_GRAPHSAGE,
            "artifact": os.path.basename(GRAPHSAGE_EMB_PATH),
        },
        {
            "name": "SASRec (optional)",
            "description": f"Enable when sessions >= {MIN_SESSIONS_FOR_SASREC} and you have offline-trained scores.",
            "enabled": ENABLE_SASREC,
            "artifact": os.path.basename(SASREC_TRANS_PATH),
        },
    ]

    if ENABLE_GRAPHSAGE and len(items) >= MIN_ITEMS_FOR_GRAPHSAGE:
        emb = _try_load_npy(GRAPHSAGE_EMB_PATH)
        if emb is not None and emb.shape[0] >= len(items):
            vecs = emb[: len(items)]
            vecs = vecs / (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9)
            idx = items.index(anchor) if anchor in items else 0
            sims = vecs @ vecs[idx]
            best_idx = int(np.argsort(-sims)[1])
            rec_item = items[best_idx]
            models_used = [{"name": "GraphSAGE (offline-trained)", "description": "Uses precomputed item embeddings from the co-purchase graph."}]
            signals = ["Offline-trained graph embeddings"]

    if ENABLE_SASREC and session_count >= MIN_SESSIONS_FOR_SASREC:
        scores = _try_load_npy(SASREC_TRANS_PATH)
        if scores is not None and scores.shape[0] >= len(items) and scores.shape[1] >= len(items):
            idx = items.index(anchor) if anchor in items else 0
            best_idx = int(np.argmax(scores[idx]))
            rec_item = items[best_idx]
            models_used = [{"name": "SASRec (offline-trained)", "description": "Uses precomputed next-item scores from session sequences."}]
            signals = ["Offline-trained sequence model scores"]

    support = int(best["support"])
    confidence = float(min(0.9, 0.45 + 0.08 * np.log10(max(2, support))))
    if total_orders < 50:
        confidence *= 0.75

    finding_bits = [
        f"lift={best['lift']:.2f}",
        f"P({best['to']}|{best['from']})={best['p']*100:.0f}%",
        f"support={support} orders",
    ]
    if top_trans:
        finding_bits.append(f"top next-step: {top_trans['from']}→{top_trans['to']} ({top_trans['p_next']*100:.0f}%)")

    insight = {
        "title": f"{rec_item} is the strongest adjacent product",
        "finding": " / ".join(finding_bits),
        "why": "Directional lift avoids recommending only popular SKUs and focuses on true adjacency.",
        "action": f"Test {rec_item} as a bundle add-on and measure attach rate + AOV.",
        "confidence": confidence,
        "signals": signals,
        "models": models_used,
        "models_available": models_available,
        "logic": "Rank directional pairs by lift then support; optionally boost with session transitions.",
        "limits": "Small catalogs rarely benefit from deep graph/sequence models; use co-purchase + transitions first.",
    }

    _lru_put(cache_key, insight)
    return {"insight": insight}

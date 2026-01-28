import os
import time
import traceback

import numpy as np
import ruptures as rpt
from flask import Flask, jsonify, request
from flask_cors import CORS
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder, SentenceTransformer
from sklearn.ensemble import IsolationForest
from statsmodels.tsa.holtwinters import ExponentialSmoothing


PORT = int(os.getenv('PORT', '5070'))
DEVICE = os.getenv('PRODUCT_RADAR_DEVICE', 'cpu')

EMBED_MODEL_NAME = os.getenv('PRODUCT_RADAR_EMBED_MODEL', 'BAAI/bge-small-en-v1.5')
RERANK_MODEL_NAME = os.getenv('PRODUCT_RADAR_RERANK_MODEL', 'cross-encoder/ms-marco-MiniLM-L-6-v2')

DISABLE_RERANK = os.getenv('PRODUCT_RADAR_DISABLE_RERANK', '').strip() == '1'
DISABLE_CLUSTER = os.getenv('PRODUCT_RADAR_DISABLE_CLUSTER', '').strip() == '1'

DEFAULT_TOP_N = int(os.getenv('PRODUCT_RADAR_TOP_N', '80'))
DEFAULT_RERANK_N = int(os.getenv('PRODUCT_RADAR_RERANK_N', '40'))


def tokenize(text: str):
  return [t for t in str(text or '').lower().replace('/', ' ').replace('-', ' ').split() if t]


def minmax(values):
  arr = np.asarray(values, dtype=float)
  if arr.size == 0:
    return arr
  vmin = float(np.nanmin(arr))
  vmax = float(np.nanmax(arr))
  if not np.isfinite(vmin) or not np.isfinite(vmax) or abs(vmax - vmin) < 1e-9:
    return np.zeros_like(arr, dtype=float)
  return (arr - vmin) / (vmax - vmin)


def safe_float(v, default=None):
  try:
    f = float(v)
    if np.isfinite(f):
      return f
  except Exception:
    return default
  return default


def short_model_name(name: str):
  name = str(name or '')
  return name.split('/')[-1] if '/' in name else name


app = Flask(__name__)
CORS(app)

_embedder = None
_reranker = None


def load_models():
  global _embedder, _reranker

  if _embedder is None:
    t0 = time.time()
    _embedder = SentenceTransformer(EMBED_MODEL_NAME, device=DEVICE)
    print(f'[ProductRadarAI] Loaded embed model {EMBED_MODEL_NAME} in {time.time() - t0:.2f}s')

  if _reranker is None and not DISABLE_RERANK:
    t0 = time.time()
    _reranker = CrossEncoder(RERANK_MODEL_NAME, device=DEVICE)
    print(f'[ProductRadarAI] Loaded rerank model {RERANK_MODEL_NAME} in {time.time() - t0:.2f}s')


def get_embedder():
  load_models()
  return _embedder


def get_reranker():
  load_models()
  return _reranker


def cosine_similarities(query: str, docs: list[str]):
  embedder = get_embedder()
  embeddings = embedder.encode([query] + docs, normalize_embeddings=True)
  q = embeddings[0]
  d = embeddings[1:]
  sims = np.dot(d, q)
  return sims.astype(float)


def bm25_scores(query: str, docs: list[str]):
  tokenized = [tokenize(d) for d in docs]
  bm25 = BM25Okapi(tokenized)
  return np.asarray(bm25.get_scores(tokenize(query)), dtype=float)


def maybe_cluster(embeddings: np.ndarray):
  if DISABLE_CLUSTER:
    return np.full((embeddings.shape[0],), -1, dtype=int)

  try:
    import umap
    import hdbscan

    reducer = umap.UMAP(
      n_components=min(5, embeddings.shape[1]),
      random_state=42,
      metric='cosine',
      n_neighbors=min(15, max(5, int(np.sqrt(embeddings.shape[0])))),
    )
    reduced = reducer.fit_transform(embeddings)
    clusterer = hdbscan.HDBSCAN(min_cluster_size=2, min_samples=1)
    labels = clusterer.fit_predict(reduced)
    return labels.astype(int)
  except Exception:
    # Safe fallback: no clusters (treat everything as its own bucket)
    return np.full((embeddings.shape[0],), -1, dtype=int)


def select_diverse_ranked(items: list[dict], max_selected: int):
  # Pick best item per cluster first, then fill remaining by score.
  by_cluster = {}
  for it in items:
    cid = int(it.get('clusterId', -1))
    if cid not in by_cluster or it['score'] > by_cluster[cid]['score']:
      by_cluster[cid] = it

  cluster_picks = sorted(by_cluster.values(), key=lambda x: x['score'], reverse=True)
  selected = []
  used = set()

  for it in cluster_picks:
    if len(selected) >= max_selected:
      break
    selected.append(it)
    used.add(it['text'].lower())

  if len(selected) < max_selected:
    for it in items:
      if len(selected) >= max_selected:
        break
      key = it['text'].lower()
      if key in used:
        continue
      selected.append(it)
      used.add(key)

  return selected


@app.get('/health')
def health():
  try:
    load_models()
    return jsonify(
      {
        'success': True,
        'service': 'product-radar-ai',
        'configured': True,
        'device': DEVICE,
        'models': {
          'embed': {'name': EMBED_MODEL_NAME, 'short': short_model_name(EMBED_MODEL_NAME)},
          'rerank': None
          if DISABLE_RERANK
          else {'name': RERANK_MODEL_NAME, 'short': short_model_name(RERANK_MODEL_NAME)},
          'timeseries': {
            'changepoint': 'ruptures:pelt(rbf)',
            'forecast': 'statsmodels:holt-winters(ets)',
          },
        },
        'features': {
          'hybrid_retrieval': True,
          'reranking': not DISABLE_RERANK,
          'clustering': not DISABLE_CLUSTER,
        },
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
      }
    )
  except Exception as e:
    return jsonify({'success': False, 'error': str(e)}), 500


@app.post('/rank')
def rank():
  try:
    body = request.get_json(force=True, silent=True) or {}
    query = str(body.get('query') or '').strip()
    candidates = body.get('candidates') or []
    max_selected = int(body.get('maxSelected') or 12)
    top_n = int(body.get('topN') or DEFAULT_TOP_N)
    rerank_n = int(body.get('rerankN') or DEFAULT_RERANK_N)
    diversify = bool(body.get('diversify', True))

    if not query:
      return jsonify({'success': False, 'message': 'query is required'}), 400
    if not isinstance(candidates, list) or not candidates:
      return jsonify({'success': False, 'message': 'candidates must be a non-empty list'}), 400

    # Deduplicate with stable order
    seen = set()
    docs = []
    for raw in candidates:
      text = str(raw or '').strip()
      if not text:
        continue
      key = text.lower()
      if key in seen:
        continue
      seen.add(key)
      docs.append(text)

    if not docs:
      return jsonify({'success': False, 'message': 'no valid candidates'}), 400

    b = bm25_scores(query, docs)
    s = cosine_similarities(query, docs)
    b_norm = minmax(b)
    s_norm = minmax(s)

    # Hybrid score: lexical + semantic
    hybrid = 0.45 * b_norm + 0.55 * s_norm
    order = np.argsort(-hybrid)

    top_idx = order[: max(1, min(top_n, len(docs)))]
    top_docs = [docs[i] for i in top_idx]
    top_hybrid = [float(hybrid[i]) for i in top_idx]
    top_bm25 = [float(b[i]) for i in top_idx]
    top_sim = [float(s[i]) for i in top_idx]

    rerank_scores = None
    if not DISABLE_RERANK and rerank_n > 0:
      reranker = get_reranker()
      pairs = [[query, d] for d in top_docs[: min(rerank_n, len(top_docs))]]
      rs = reranker.predict(pairs)
      rerank_scores = rs.astype(float).tolist()

      rerank_slice = list(zip(top_docs[: len(rerank_scores)], rerank_scores))
      rerank_slice.sort(key=lambda x: x[1], reverse=True)
      reranked_docs = [x[0] for x in rerank_slice] + top_docs[len(rerank_scores) :]

      pos = {d: i for i, d in enumerate(top_docs)}
      new_order = [pos[d] for d in reranked_docs]
      top_docs = reranked_docs
      top_hybrid = [top_hybrid[i] for i in new_order]
      top_bm25 = [top_bm25[i] for i in new_order]
      top_sim = [top_sim[i] for i in new_order]

      rerank_scores = [rerank_scores[i] for i in new_order[: len(rerank_scores)]] + [None] * (
        len(top_docs) - len(rerank_scores)
      )

    embedder = get_embedder()
    top_embeddings = embedder.encode(top_docs, normalize_embeddings=True)
    labels = maybe_cluster(np.asarray(top_embeddings))

    items = []
    for idx, text in enumerate(top_docs):
      items.append(
        {
          'text': text,
          'score': float(top_hybrid[idx]),
          'bm25': float(top_bm25[idx]),
          'embedSim': float(top_sim[idx]),
          'rerank': None if rerank_scores is None else rerank_scores[idx],
          'clusterId': int(labels[idx]),
        }
      )

    selected_items = select_diverse_ranked(items, max_selected) if diversify else items[:max_selected]

    return jsonify(
      {
        'success': True,
        'query': query,
        'models': {
          'embed': EMBED_MODEL_NAME,
          'rerank': None if DISABLE_RERANK else RERANK_MODEL_NAME,
          'cluster': None if DISABLE_CLUSTER else 'umap+hdbscan',
          'hybrid': 'bm25+embedding',
        },
        'selected': selected_items,
        'candidates': items,
      }
    )
  except Exception as e:
    traceback.print_exc()
    return jsonify({'success': False, 'message': str(e)}), 500


def analyze_series(values: list[float], horizon: int = 7):
  vals = np.asarray([safe_float(v, 0.0) or 0.0 for v in values], dtype=float)
  n = int(vals.size)
  if n < 6:
    return {
      'ok': False,
      'reason': 'series_too_short',
      'n': n,
    }

  # Basic slope + acceleration on the tail
  w = max(6, min(18, n))
  x = np.arange(w, dtype=float)
  y = vals[-w:]
  slope = float(np.polyfit(x, y, 1)[0])
  quad = np.polyfit(x, y, 2)
  acceleration = float(2.0 * quad[0])  # second derivative for ax^2 + bx + c

  # Change-point (PELT)
  pen = 3.0 * np.log(max(2, n))
  try:
    algo = rpt.Pelt(model='rbf').fit(vals)
    bkps = algo.predict(pen=pen)
    cp = int(bkps[-2]) if isinstance(bkps, list) and len(bkps) >= 2 else None
  except Exception:
    cp = None

  change = None
  if cp is not None and 2 <= cp <= n - 2:
    before = float(np.mean(vals[:cp]))
    after = float(np.mean(vals[cp:]))
    direction = 'up' if after > before else 'down' if after < before else 'flat'
    magnitude_pct = float(((after - before) / max(1e-6, abs(before))) * 100.0)
    recent_window = max(6, n // 3)
    change = {
      'method': 'ruptures:pelt(rbf)',
      'index': cp,
      'recent': bool((n - cp) <= recent_window),
      'direction': direction,
      'magnitudePct': magnitude_pct,
    }

  # Forecast (ETS / Holt-Winters w/out seasonality)
  forecast = None
  try:
    model = ExponentialSmoothing(vals, trend='add', seasonal=None, initialization_method='estimated').fit(optimized=True)
    yhat = model.forecast(horizon)
    yhat = np.asarray(yhat, dtype=float)
    yhat = np.where(np.isfinite(yhat), yhat, vals[-1])
    pct = float(((float(yhat[-1]) - float(vals[-1])) / max(1e-6, abs(float(vals[-1])))) * 100.0)
    forecast = {
      'method': 'statsmodels:ets(holt)',
      'horizon': int(horizon),
      'pctChangeFromLast': pct,
      'yhat': [float(v) for v in yhat.tolist()],
    }
  except Exception:
    forecast = {
      'method': 'statsmodels:ets(holt)',
      'horizon': int(horizon),
      'pctChangeFromLast': 0.0,
      'yhat': [float(vals[-1])] * int(horizon),
      'note': 'fallback',
    }

  # Anomaly detection on values (IsolationForest)
  anomaly = None
  try:
    X = vals.reshape(-1, 1)
    iso = IsolationForest(n_estimators=120, random_state=42)
    iso.fit(X)
    scores = iso.decision_function(X)  # higher = more normal
    last = float(scores[-1])
    threshold = float(np.percentile(scores, 10))
    anomaly = {
      'method': 'sklearn:isolation_forest',
      'score': last,
      'isAnomaly': bool(last < threshold),
    }
  except Exception:
    anomaly = {
      'method': 'sklearn:isolation_forest',
      'score': None,
      'isAnomaly': False,
      'note': 'failed',
    }

  return {
    'ok': True,
    'n': n,
    'slope': slope,
    'acceleration': acceleration,
    'changePoint': change,
    'forecast': forecast,
    'anomaly': anomaly,
  }


@app.post('/timeseries/analyze')
def timeseries_analyze():
  try:
    body = request.get_json(force=True, silent=True) or {}
    series_list = body.get('series') or []
    horizon = int(body.get('horizon') or 7)

    if not isinstance(series_list, list) or not series_list:
      return jsonify({'success': False, 'message': 'series must be a non-empty list'}), 400

    out = []
    for entry in series_list:
      sid = str(entry.get('id') or '')
      values = entry.get('values') or []
      if not sid or not isinstance(values, list):
        continue
      out.append({'id': sid, **analyze_series(values, horizon=horizon)})

    return jsonify({'success': True, 'results': out})
  except Exception as e:
    traceback.print_exc()
    return jsonify({'success': False, 'message': str(e)}), 500


if __name__ == '__main__':
  load_models()
  app.run(host='0.0.0.0', port=PORT)

# Product Radar AI Service

This is an optional microservice that upgrades **Product Radar** with:

- Hybrid semantic retrieval: **BM25 + embeddings** (Sentence-Transformers)
- Optional reranking: **cross-encoder/ms-marco-MiniLM-L-6-v2**
- Topic diversity: **UMAP + HDBSCAN** (best-effort; falls back safely)
- Trend momentum features: **ruptures PELT** change-point detection + **ETS/Holt** forecasting (statsmodels)
- Simple anomaly flagging: **Isolation Forest**

## Run locally

```bash
cd product_radar_ai_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python product_radar_ai_server.py
```

Service listens on `http://localhost:5070`.

## Configure the main app

Set this env var for the Node server:

- `PRODUCT_RADAR_AI_URL=http://localhost:5070`

Optional:
- `PRODUCT_RADAR_EMBED_MODEL` (default: `BAAI/bge-small-en-v1.5`)
- `PRODUCT_RADAR_RERANK_MODEL` (default: `cross-encoder/ms-marco-MiniLM-L-6-v2`)
- `PRODUCT_RADAR_DISABLE_RERANK=1`
- `PRODUCT_RADAR_DISABLE_CLUSTER=1`
- `PRODUCT_RADAR_DEVICE=cpu` (or `cuda`)

## Endpoints

- `GET /health`
- `POST /rank` `{ query, candidates[], maxSelected, topN, rerankN, diversify }`
- `POST /timeseries/analyze` `{ series: [{ id, values[] }], horizon }`

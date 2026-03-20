# Tajweed ML Frontend

This frontend is intended for Railway deployment.

## Environment

Set these variables in Railway:

- `VITE_API_BASE=https://your-cloud-run-backend.run.app`
- `VITE_WS_BASE=wss://your-cloud-run-backend.run.app`
- `VITE_SEGMENTER_BASE=https://your-cloud-run-segmenter.run.app`

`VITE_WS_BASE` is optional if it matches `VITE_API_BASE` with `ws://` or `wss://`.
`VITE_SEGMENTER_BASE` is recommended so the UI can verify the dedicated segmenter service after deploy.

## Local development

```bash
npm install
npm run dev
```

The app assumes the backend is available at `http://localhost:8000` unless `VITE_API_BASE` is set.

## Railway deployment

Railway should deploy from this folder:

- Root directory: `apps/tajweed-ml/frontend`
- Build command: handled by `nixpacks.toml`
- Start command: handled by `railway.toml`

The frontend is static in practice, but it uses `vite preview` so Railway can serve the built app directly.

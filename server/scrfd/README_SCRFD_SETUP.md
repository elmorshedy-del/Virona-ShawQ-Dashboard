# SCRFD Face Detection Setup

## What Changed
- Replaced face-api.js (~50-60% accuracy on small faces) with SCRFD (~93% accuracy)
- All face-api.js code is **commented out**, not deleted — easy rollback
- Contour and geometry fallbacks still work if Python service is down

## Quick Start (5 minutes)

### Step 1: Install Python Dependencies
```bash
# Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Step 2: Start the Face Detection Server
```bash
# In one terminal
chmod +x start_face_server.sh
./start_face_server.sh

# Or directly:
python face_detection_server.py
```

First run downloads the SCRFD model (~30MB). You should see:
```
==================================================
SCRFD Face Detection Server
==================================================
Initializing SCRFD face detector...
✓ SCRFD detector ready

Starting server on http://localhost:5050
```

### Step 3: Run Your Node.js App (in another terminal)
```bash
# Your normal startup command
npm start
# or
node server.js
```

## Verify It's Working

Test the Python server directly:
```bash
curl http://localhost:5050/health
# Should return: {"status":"ok","detector_ready":true}
```

In your Node logs, you should see:
```
CALLING SCRFD FACE DETECTION FOR REGION: {...}
SCRFD FACES FOUND: 1
Avatar debug info: { methodUsed: 'scrfd', ... }
```

## Configuration

### Environment Variables (optional)
```bash
# If running Python server on different host/port
export SCRFD_SERVICE_URL=http://localhost:5050
```

### GPU Acceleration (optional, much faster)
```bash
pip install onnxruntime-gpu
```

Then edit `face_detection_server.py` line 36:
```python
providers=['CUDAExecutionProvider']  # Instead of CPUExecutionProvider
```

## Rollback to face-api.js

If needed, the original code is all commented with `// DISABLED:` markers.
Just uncomment the face-api sections and comment out the SCRFD sections.

## Troubleshooting

### "SCRFD service unavailable" in Node logs
- Python server isn't running
- Start it with `./start_face_server.sh`

### "Failed to initialize detector" in Python
- Missing dependencies: `pip install -r requirements.txt`
- Disk space for model download

### Slow first request
- Normal — first request loads model into memory
- Subsequent requests are fast (~50-100ms)

### Still not detecting small faces
- Check if region is being cropped correctly (look at debug images)
- Lower `MIN_FACE_CONFIDENCE` in testimonialExtractorService.js (currently 0.3)

## File Summary

| File | Purpose |
|------|---------|
| `testimonialExtractorService.js` | Modified — calls Python instead of face-api.js |
| `face_detection_server.py` | NEW — Python SCRFD microservice |
| `requirements.txt` | NEW — Python dependencies |
| `start_face_server.sh` | NEW — Startup script |


## Railway Deployment (Recommended)

Use **two Railway services** for best reliability:

1) **SCRFD Service** (this folder)
- Root directory: `server/scrfd`
- Start command: `python face_detection_server.py`
- Railway will set `PORT` automatically (the server now uses it).

2) **Node App Service** (main app)
- Set `SCRFD_SERVICE_URL` to the SCRFD service URL (e.g. `https://<your-scrfd-service>.up.railway.app`).
- Optional: set `SCRFD_AUTO_START=0` in production to avoid local auto-start attempts.

Health check:
- Visit `https://<your-scrfd-service>.up.railway.app/health` to confirm it is ready.

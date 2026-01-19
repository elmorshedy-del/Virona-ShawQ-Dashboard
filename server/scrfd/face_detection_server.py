"""
SCRFD Face Detection Microservice
---------------------------------
Replaces face-api.js with production-grade SCRFD model.
WIDER FACE Hard accuracy: ~93% vs face-api.js ~50-60%

Usage:
  pip install -r requirements.txt
  python face_detection_server.py

Then your Node.js app calls http://localhost:5050/detect
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
import base64
import logging
import sys

# Suppress InsightFace verbose output
logging.getLogger('insightface').setLevel(logging.WARNING)

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from Node

# Global detector - initialized once on startup
detector = None

def init_detector():
    """Initialize SCRFD detector (downloads model on first run ~30MB)"""
    global detector
    if detector is not None:
        return True
    
    try:
        from insightface.app import FaceAnalysis
        print('Initializing SCRFD face detector...')
        print('(First run will download model files ~30MB)')
        
        detector = FaceAnalysis(
            name='buffalo_sc',  # Smaller, faster model optimized for faces
            allowed_modules=['detection'],
            providers=['CPUExecutionProvider']  # Use 'CUDAExecutionProvider' for GPU
        )
        detector.prepare(ctx_id=-1, det_size=(640, 640))
        print('✓ SCRFD detector ready')
        return True
    except Exception as e:
        print(f'✗ Failed to initialize detector: {e}')
        return False


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'detector_ready': detector is not None
    })


@app.route('/detect', methods=['POST'])
def detect():
    """
    Detect faces in a region of an image.
    
    Request JSON:
    {
        "image": "<base64 encoded image>",
        "region": {"x": 0, "y": 0, "width": 100, "height": 100},
        "min_confidence": 0.5  // optional
    }
    
    Response JSON:
    [
        {"x": 10, "y": 20, "width": 50, "height": 50, "score": 0.98},
        ...
    ]
    
    Coordinates are in ORIGINAL image space (not crop space).
    """
    if detector is None:
        print('ERROR: Detector not initialized')
        return jsonify([])
    
    try:
        data = request.json
        if not data:
            print('ERROR: No JSON data received')
            return jsonify([])
        
        image_b64 = data.get('image')
        region = data.get('region')
        min_confidence = data.get('min_confidence', 0.3)  # Lower = catches smaller faces
        
        if not image_b64 or not region:
            print('ERROR: Missing image or region')
            return jsonify([])
        
        # Decode base64 image
        try:
            image_bytes = base64.b64decode(image_b64)
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            print(f'ERROR: Failed to decode image: {e}')
            return jsonify([])
        
        if img is None:
            print('ERROR: cv2.imdecode returned None')
            return jsonify([])
        
        # Extract region coordinates
        x = int(region.get('x', 0))
        y = int(region.get('y', 0))
        w = int(region.get('width', 0))
        h = int(region.get('height', 0))
        
        # Validate region
        img_h, img_w = img.shape[:2]
        x = max(0, min(x, img_w - 1))
        y = max(0, min(y, img_h - 1))
        w = max(1, min(w, img_w - x))
        h = max(1, min(h, img_h - y))
        
        # Crop region
        crop = img[y:y+h, x:x+w]
        
        if crop.size == 0:
            print('ERROR: Empty crop region')
            return jsonify([])
        
        # Upscale 2x for better small face detection (matching original behavior)
        scale = 2
        crop_h, crop_w = crop.shape[:2]
        crop_upscaled = cv2.resize(
            crop, 
            (crop_w * scale, crop_h * scale), 
            interpolation=cv2.INTER_LINEAR
        )
        
        # Run SCRFD detection
        faces = detector.get(crop_upscaled)
        
        # Filter by confidence and map coordinates back to original image space
        results = []
        for face in faces:
            if face.det_score < min_confidence:
                continue
                
            bbox = face.bbox  # [x1, y1, x2, y2] in upscaled crop space
            
            # Scale back down and add region offset to get original image coords
            fx = bbox[0] / scale + x
            fy = bbox[1] / scale + y
            fw = (bbox[2] - bbox[0]) / scale
            fh = (bbox[3] - bbox[1]) / scale
            
            results.append({
                'x': float(fx),
                'y': float(fy),
                'width': float(fw),
                'height': float(fh),
                'score': float(face.det_score)
            })
        
        print(f'Detected {len(results)} face(s) in region {region}')
        return jsonify(results)
    
    except Exception as e:
        print(f'ERROR in /detect: {e}')
        import traceback
        traceback.print_exc()
        return jsonify([])


if __name__ == '__main__':
    print('=' * 50)
    print('SCRFD Face Detection Server')
    print('=' * 50)
    
    if not init_detector():
        print('\nFailed to initialize detector. Please check:')
        print('1. pip install -r requirements.txt')
        print('2. Sufficient disk space for model download')
        sys.exit(1)
    
    print('\nStarting server on http://localhost:5050')
    print('Endpoints:')
    print('  POST /detect  - Detect faces in image region')
    print('  GET  /health  - Health check')
    print('=' * 50)
    
    app.run(host='0.0.0.0', port=5050, debug=False)

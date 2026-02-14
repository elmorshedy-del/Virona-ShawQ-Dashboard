from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
import base64
import os
import sys

app = Flask(__name__)
CORS(app)

detector = None

def init_detector():
    global detector
    if detector is not None:
        return True
    try:
        from insightface.app import FaceAnalysis
        print('Initializing SCRFD...')
        detector = FaceAnalysis(name='buffalo_sc', allowed_modules=['detection'], providers=['CPUExecutionProvider'])
        detector.prepare(ctx_id=-1, det_size=(1280, 1280))
        print('SCRFD ready')
        return True
    except Exception as e:
        print(f'Failed: {e}')
        return False

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'detector_ready': detector is not None})

@app.route('/detect', methods=['POST'])
def detect():
    if detector is None:
        return jsonify([])
    try:
        data = request.json
        image_b64 = data.get('image')
        if not image_b64:
            return jsonify([])
        
        image_bytes = base64.b64decode(image_b64)
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return jsonify([])
        
        h, w = img.shape[:2]
        print(f'Image: {w}x{h}')
        
        img2x = cv2.resize(img, (w*2, h*2))
        faces = detector.get(img2x)
        print(f'Found {len(faces)} faces')
        
        results = []
        for face in faces:
            if face.det_score < 0.1:
                continue
            bbox = face.bbox
            results.append({
                'x': float(bbox[0] / 2),
                'y': float(bbox[1] / 2),
                'width': float((bbox[2] - bbox[0]) / 2),
                'height': float((bbox[3] - bbox[1]) / 2),
                'score': float(face.det_score)
            })
            print(f'Face at {bbox}, score={face.det_score:.2f}')
        
        return jsonify(results)
    except Exception as e:
        print(f'Error: {e}')
        return jsonify([])

if __name__ == '__main__':
    if not init_detector():
        sys.exit(1)
    port = int(os.environ.get('PORT', '8080'))
    print(f'Server on port {port}')
    app.run(host='0.0.0.0', port=port)

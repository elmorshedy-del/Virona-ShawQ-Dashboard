"""
Grounding DINO Avatar Detection Service
---------------------------------------
Detects circular avatars/profile pictures in chat screenshots.
Unlike face detection, this finds ANY avatar - faces, initials, logos, cropped photos.

Usage:
  pip install -r requirements.txt
  python avatar_detection_server.py

Endpoint: POST /detect
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import base64
import os
import sys
import logging

# Suppress verbose logging from transformers
logging.getLogger("transformers").setLevel(logging.WARNING)
os.environ["TOKENIZERS_PARALLELISM"] = "false"

app = Flask(__name__)
CORS(app)

# Global model - initialized once on startup
model = None
processor = None
device = None

def init_model():
    """Initialize Grounding DINO model (downloads on first run ~800MB)"""
    global model, processor, device
    if model is not None:
        return True
    
    try:
        import torch
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        
        print('=' * 50)
        print('Initializing Grounding DINO (base)')
        print('=' * 50)
        print('First run will download model files (~800MB)')
        
        model_id = "IDEA-Research/grounding-dino-base"
        
        # Determine device
        if torch.cuda.is_available():
            device = torch.device("cuda")
            print(f"Using GPU: {torch.cuda.get_device_name(0)}")
        else:
            device = torch.device("cpu")
            print("Using CPU")
        
        print("Loading processor...")
        processor = AutoProcessor.from_pretrained(model_id)
        
        print("Loading model...")
        model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id)
        model = model.to(device)
        model.eval()
        
        print('=' * 50)
        print('✓ Grounding DINO ready')
        print('=' * 50)
        return True
        
    except Exception as e:
        print(f'✗ Failed to initialize model: {e}')
        import traceback
        traceback.print_exc()
        return False


def detect_avatars(image_bytes, confidence_threshold=0.25):
    """
    Detect avatars in image using Grounding DINO.
    
    Args:
        image_bytes: Raw image bytes
        confidence_threshold: Minimum confidence for detection
        
    Returns:
        List of {x, y, width, height, score} dicts in original image coordinates
    """
    import torch
    from PIL import Image
    import io
    
    # Load image
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    original_width, original_height = image.size
    
    print(f"Image size: {original_width}x{original_height}")
    
    # Text prompts for avatar detection
    # Grounding DINO uses "." as separator for multiple prompts
    text_prompt = "circular profile picture . avatar . small circular photo . profile avatar"
    
    # Process inputs
    inputs = processor(images=image, text=text_prompt, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    # Run inference
    with torch.no_grad():
        outputs = model(**inputs)
    
    # Post-process results
    results = processor.post_process_grounded_object_detection(
        outputs,
        inputs["input_ids"],
        box_threshold=confidence_threshold,
        text_threshold=confidence_threshold,
        target_sizes=[(original_height, original_width)]
    )[0]
    
    boxes = results["boxes"].cpu().numpy()  # [x1, y1, x2, y2] format
    scores = results["scores"].cpu().numpy()
    
    print(f"Raw detections: {len(boxes)}")
    
    # Convert to {x, y, width, height, score} format
    detections = []
    for box, score in zip(boxes, scores):
        x1, y1, x2, y2 = box
        detections.append({
            "x": float(x1),
            "y": float(y1),
            "width": float(x2 - x1),
            "height": float(y2 - y1),
            "score": float(score)
        })
        print(f"  Avatar: x={x1:.0f}, y={y1:.0f}, w={x2-x1:.0f}, h={y2-y1:.0f}, score={score:.2f}")
    
    return detections


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'model_ready': model is not None,
        'model_type': 'grounding-dino-base'
    })


@app.route('/detect', methods=['POST'])
def detect():
    """
    Detect avatars in an image.
    
    Request JSON:
    {
        "image": "<base64 encoded image>",
        "min_confidence": 0.25  // optional
    }
    
    Response JSON:
    [
        {"x": 10, "y": 20, "width": 50, "height": 50, "score": 0.87},
        ...
    ]
    """
    if model is None:
        print('ERROR: Model not initialized')
        return jsonify({"error": "Model not initialized"}), 503
    
    try:
        data = request.json
        if not data:
            print('ERROR: No JSON data received')
            return jsonify([])
        
        image_b64 = data.get('image')
        min_confidence = data.get('min_confidence', 0.25)
        
        if not image_b64:
            print('ERROR: No image provided')
            return jsonify([])
        
        # Decode base64 image
        try:
            image_bytes = base64.b64decode(image_b64)
        except Exception as e:
            print(f'ERROR: Failed to decode base64: {e}')
            return jsonify([])
        
        # Detect avatars
        detections = detect_avatars(image_bytes, min_confidence)
        
        print(f"Returning {len(detections)} avatar(s)")
        return jsonify(detections)
        
    except Exception as e:
        print(f'ERROR in /detect: {e}')
        import traceback
        traceback.print_exc()
        return jsonify([])


if __name__ == '__main__':
    print('=' * 50)
    print('Grounding DINO Avatar Detection Server')
    print('=' * 50)
    
    if not init_model():
        print('\nFailed to initialize model. Please check:')
        print('1. pip install -r requirements.txt')
        print('2. Sufficient disk space for model download (~800MB)')
        print('3. Sufficient RAM (~4GB)')
        sys.exit(1)
    
    port = int(os.environ.get('PORT', '5060'))
    print(f'\nStarting server on port {port}')
    print('Endpoints:')
    print('  POST /detect  - Detect avatars in image')
    print('  GET  /health  - Health check')
    print('=' * 50)
    
    app.run(host='0.0.0.0', port=port, debug=False)

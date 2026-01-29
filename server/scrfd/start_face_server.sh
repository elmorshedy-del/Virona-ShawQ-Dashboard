#!/bin/bash
# Start the SCRFD Face Detection Server
# Run this before starting your Node.js app

cd "$(dirname "$0")"

echo "Starting SCRFD Face Detection Server..."
echo "First run will download model files (~30MB)"
echo ""

python3 face_detection_server.py

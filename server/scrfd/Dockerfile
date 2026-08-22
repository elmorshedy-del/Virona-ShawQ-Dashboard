FROM python:3.11-slim

WORKDIR /app

# Install build tools AND OpenCV dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the app
COPY face_detection_server.py .

# Expose port
EXPOSE 5050

# Run it
CMD ["python", "face_detection_server.py"]

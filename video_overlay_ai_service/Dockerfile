# Video Overlay AI Service (DINO + SAM2 + OCR)

FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    git \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install PyTorch CPU wheels (predictable for servers; swap for GPU base image if needed)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
  CMD sh -c 'curl -f http://localhost:${PORT:-5000}/health || exit 1'

RUN chmod +x start.sh

CMD ["sh", "start.sh"]

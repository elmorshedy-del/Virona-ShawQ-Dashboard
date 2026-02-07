# Video Overlay AI Service (DINO + SAM2 + OCR)

FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    git \
    curl \
    wget \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download model weights EARLY (cached, won't re-download on code changes)
RUN mkdir -p weights && \
    echo "Downloading DINO weights (~700MB)..." && \
    wget -q --show-progress https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth -O weights/groundingdino_swint_ogc.pth && \
    echo "Downloading SAM2 weights (~2.4GB)..." && \
    wget -q --show-progress https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt -O weights/sam2_hiera_large.pt && \
    echo "Weights downloaded!"

# Install PyTorch CPU wheels (predictable for servers; swap for GPU base image if needed)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Railway CPU builds: skip CUDA extension build for SAM2.
ENV SAM2_BUILD_CUDA=0

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
  CMD sh -c 'curl -f http://localhost:${PORT:-5000}/health || exit 1'

RUN chmod +x start.sh

CMD ["sh", "start.sh"]

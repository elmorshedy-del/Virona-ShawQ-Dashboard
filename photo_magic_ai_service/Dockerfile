# Photo Magic AI Service (CPU): RMBG2 + SAM2 + LaMa

FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    git \
    curl \
    wget \
    libglib2.0-0 \
    libgl1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mkdir -p weights

# Install PyTorch CPU wheels (predictable for servers; swap for GPU base image if needed)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Railway CPU builds: skip CUDA extension build for SAM2.
ENV SAM2_BUILD_CUDA=0

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=30s --start-period=240s --retries=3 \
  CMD sh -c 'curl -f http://localhost:${PORT:-5000}/health || exit 1'

RUN chmod +x start.sh

CMD ["sh", "start.sh"]

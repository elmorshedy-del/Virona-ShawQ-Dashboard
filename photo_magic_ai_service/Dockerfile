# Photo Magic AI Service (CPU): RMBG + LaMa

FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    libglib2.0-0 \
    libgl1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install PyTorch CPU wheels
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Railway CPU builds: skip CUDA extension build for SAM2.
ENV SAM2_BUILD_CUDA=0

# Cache-bust: increment to force fresh pip install after requirements.txt changes
ARG REQUIREMENTS_BUST=v6_lock_numpy_scipy_20260308
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Constrain threads for Railway CPU containers
ENV OMP_NUM_THREADS=2
ENV MKL_NUM_THREADS=2
ENV TOKENIZERS_PARALLELISM=false

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=30s --start-period=240s --retries=3 \
  CMD sh -c 'curl -f http://localhost:${PORT:-5000}/health || exit 1'

RUN chmod +x start.sh

CMD ["sh", "start.sh"]

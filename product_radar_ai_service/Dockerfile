# Product Radar AI Service
# Semantic retrieval + time-series models for Product Radar

FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    git \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install PyTorch CPU wheels (smaller + predictable on servers)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5070

HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
  CMD curl -f http://localhost:5070/health || exit 1

CMD ["python", "product_radar_ai_server.py"]

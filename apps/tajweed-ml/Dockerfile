FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app/src:/app

RUN apt-get update && apt-get install -y \
    libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY pyproject.toml .
COPY src/ src/
COPY ml/ ml/
COPY server/ server/
COPY data/ data/
COPY audio/ audio/
COPY cli.py .

# The live API uses Muaalem at runtime. Segmenter and dataset bootstrap are
# heavier setup paths and are not required to boot the Cloud Run service.
RUN python -c "from ml.setup import setup_muaalem; setup_muaalem()"

EXPOSE 8000

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]

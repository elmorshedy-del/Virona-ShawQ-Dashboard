# Photo Magic HQ Service (SDXL Inpainting)
#
# Intended for GPU deployment. By default, the service marks itself not-ready on CPU
# unless PHOTO_MAGIC_HQ_ALLOW_CPU=true is set.

FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    libglib2.0-0 \
    libgl1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=30s --start-period=240s --retries=3 \
  CMD sh -c 'curl -f http://localhost:${PORT:-5001}/health || exit 1'

RUN chmod +x start.sh

CMD ["sh", "start.sh"]


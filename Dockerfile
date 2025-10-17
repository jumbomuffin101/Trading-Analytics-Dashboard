# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# System deps (optional but often needed for pandas/numpy etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && rm -rf /var/lib/apt/lists/*

# Copy & install backend deps
COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Healthcheck endpoint is nice to have (add /healthz in your FastAPI if not already)
# Start server – Render provides $PORT; default to 8000 for local runs
CMD ["sh","-c","uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

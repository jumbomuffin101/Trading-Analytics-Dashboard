FROM python:3.11-slim

# System deps (optional but handy for SSL/timezones)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy the whole repo (so /backend is present)
COPY . .

# Use $PORT provided by Render
CMD ["sh","-c","python -m uvicorn backend.main:app --host 0.0.0.0 --port $PORT"]

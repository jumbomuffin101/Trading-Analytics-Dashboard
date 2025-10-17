import os
# Use ephemeral /tmp for SQLite so the function can write
os.environ.setdefault("DB_PATH", "/tmp/market.db")

from mangum import Mangum
# Import your existing FastAPI app
from backend.main import app

# Netlify/Lambda entrypoint
handler = Mangum(app)
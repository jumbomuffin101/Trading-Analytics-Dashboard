# netlify/functions/peek.py
import json
from typing import Dict, Any

from fastapi.testclient import TestClient
from backend.main import app  # <-- your existing FastAPI app

# Reuse your app exactly as-is
_client = TestClient(app)

def _response(status: int, body: Any, headers: Dict[str, str] = None):
    # Netlify/Lambda response shape
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "GET,POST,OPTIONS",
            **(headers or {}),
        },
        "body": body if isinstance(body, str) else json.dumps(body),
    }

def handler(event, context):
    # CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return _response(200, "")

    try:
        payload = {}
        if event.get("body"):
            payload = json.loads(event["body"])

        # Forward the request to your FastAPI endpoint
        resp = _client.post("/peek", json=payload)

        # Pass through body/status
        # (resp.text is already JSON string from FastAPI)
        return _response(resp.status_code, resp.text)
    except Exception as e:
        return _response(500, {"detail": f"peek failed: {e}"} )

from fastapi import FastAPI
from mangum import Mangum

app = FastAPI(title="Netlify FastAPI")

@app.get("/ping")
def ping():
    return {"message": "pong"}

# Netlify/AWS Lambda looks for 'handler'
handler = Mangum(app)

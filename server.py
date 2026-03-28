import os
import time
import logging
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

load_dotenv()

# ─── Logging ─────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("clinic")

app = FastAPI()

DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
DIST_DIR = Path(__file__).parent / "dist"

log.info("DeepSeek key loaded: %s...%s (%d chars)", DEEPSEEK_KEY[:6], DEEPSEEK_KEY[-4:], len(DEEPSEEK_KEY))
log.info("Serving frontend from: %s (exists=%s)", DIST_DIR, DIST_DIR.exists())


@app.get("/health")
def health():
    log.info("Health check OK")
    return {"status": "ok"}


@app.post("/api/chat/completions")
async def complete(request: Request):
    body = await request.json()
    model = body.get("model", "?")
    messages = body.get("messages", [])
    user_msg = messages[-1].get("content", "")[:80] if messages else ""
    stream_mode = body.get("stream", False)

    log.info("─── Chat request ───")
    log.info("  model=%s  stream=%s  messages=%d", model, stream_mode, len(messages))
    log.info("  last_msg: %s", user_msg)

    start = time.time()

    async def stream():
        chunk_count = 0
        byte_count = 0
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                log.info("  Connecting to DeepSeek...")
                async with client.stream(
                    "POST",
                    DEEPSEEK_URL,
                    headers={
                        "Authorization": f"Bearer {DEEPSEEK_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={**body, "stream": True},
                ) as response:
                    log.info("  DeepSeek responded: status=%d", response.status_code)
                    if response.status_code != 200:
                        error_body = b""
                        async for chunk in response.aiter_bytes():
                            error_body += chunk
                        log.error("  DeepSeek error: %s", error_body.decode()[:500])
                        yield error_body
                        return
                    async for chunk in response.aiter_bytes():
                        chunk_count += 1
                        byte_count += len(chunk)
                        yield chunk
        except httpx.TimeoutException:
            log.error("  DeepSeek TIMEOUT after %.1fs", time.time() - start)
            raise
        except Exception as e:
            log.error("  DeepSeek ERROR: %s", e)
            raise
        finally:
            elapsed = time.time() - start
            log.info("  Done: %d chunks, %d bytes, %.1fs", chunk_count, byte_count, elapsed)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ─── Serve React frontend ────────────────────────────────────────
if DIST_DIR.exists():
    # Serve static assets (js, css, etc.)
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

    # Catch-all: serve index.html for any non-API route
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        file_path = DIST_DIR / path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(DIST_DIR / "index.html")
else:
    log.warning("dist/ not found — run 'npm run build' first")

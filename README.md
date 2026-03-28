# ClinicScript

Clinical prescription app for Indian GP clinics with AI-powered autocomplete.

## Quick Start

```bash
# 1. Install Python deps
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt

# 2. Set your DeepSeek API key
echo "DEEPSEEK_API_KEY=sk-your-key" > .env

# 3. Build the frontend (one-time, or after any src/ changes)
npm install
npm run build

# 4. Start the server
uvicorn server:app --port 8000 --reload
```

Open http://localhost:8000

Everything runs on a single server — FastAPI serves both the API and the React frontend.

## Rebuild Frontend

After editing files in `src/`, rebuild:

```bash
npm run build
```

The server picks up the new `dist/` automatically.

## Notes
- First load downloads 22MB embedding model — cached forever after
- DeepSeek only called on low-confidence suggestions (~20% after week 1)
- All patient data stays in browser IndexedDB — never sent to any server
- App works offline using n-gram + local embeddings
- Backend logs show all API calls, DeepSeek responses, and timing

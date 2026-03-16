# MartGennie Backend

## Overview
This is the FastAPI backend for MartGennie. It provides auth, memory profile, chat analysis, package generation, plaza data, and negotiation APIs.

## Environment Setup
1. Copy the example file:
```bash
cp .env.example .env
```
2. Fill in the variables in `.env`.

### Required Values
- `DATABASE_URL`: PostgreSQL connection string for your local or remote database.
- `JWT_SECRET`: random secret used to sign auth tokens.
- `FRONTEND_ORIGINS`: allowed frontend origins, usually `http://localhost:8001,http://127.0.0.1:8001`.
- `OAUTH_STATE_SECRET`: random secret for OAuth state validation.

### OAuth Values
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

Get these from Google Cloud Console:
- Create an OAuth client
- Add frontend origin such as `http://localhost:8001`
- Add backend callback such as `http://localhost:8000/api/auth/google/callback`

Apple OAuth values are optional unless you plan to enable Apple sign-in.

### Model Provider Values
#### GLM
- `GLM_MODEL_KEY`

Get this from your GLM / Zhipu platform account. It is used for analysis, seller-side negotiation, and embeddings unless you override the routing.

#### OpenRouter
- `OPENROUTER_API_KEY`
- Optional metadata:
  - `OPENROUTER_HTTP_REFERER`
  - `OPENROUTER_APP_TITLE`

Get the API key from OpenRouter. This is used by default for bundle generation and buyer-agent negotiation.

### Step-Based LLM Routing
These variables let you choose which provider/model each step uses:
- `LLM_ANALYSIS_PROVIDER`, `LLM_ANALYSIS_MODEL`
- `LLM_BUNDLE_PROVIDER`, `LLM_BUNDLE_MODEL`
- `LLM_BUYER_DECISION_PROVIDER`, `LLM_BUYER_DECISION_MODEL`
- `LLM_SELL_PARSER_PROVIDER`, `LLM_SELL_PARSER_MODEL`
- `LLM_SELL_PRICE_PROVIDER`, `LLM_SELL_PRICE_MODEL`
- `LLM_SELL_REPLY_PROVIDER`, `LLM_SELL_REPLY_MODEL`
- `LLM_EMBEDDING_PROVIDER`, `LLM_EMBEDDING_MODEL`

Use `glm` or `openrouter` where supported. Embedding currently only supports `glm`.

## Install and Run
Install dependencies:
```bash
uv sync
```

Start the API:
```bash
uv run uvicorn src.web.main:app --reload --port 8000
```

Health check:
```bash
curl http://127.0.0.1:8000/health
```

## Useful Commands
- `uv sync`: install Python dependencies.
- `uv run uvicorn src.web.main:app --reload --port 8000`: start local API.
- `uv run pytest src/tests`: run backend tests.

## Notes
- The frontend assumes the backend is available at `http://127.0.0.1:8000` during local development unless you change the frontend `.env`.
- If chat or negotiation streams fail, confirm both the backend is running and the frontend `NEXT_PUBLIC_BACKEND_ORIGIN` matches this server.

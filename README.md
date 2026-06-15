# freeapijust

`freeapijust` is a small OpenAI-compatible gateway for personal development. It routes chat completion requests across configured free-tier or trial-credit LLM providers and automatically tries the next provider when one is rate-limited, unavailable, or over the local daily budget you set.

It does not bypass provider limits. Use it only with API keys and services you are allowed to use.

## What It Does

- Exposes `POST /v1/chat/completions`
- Exposes `GET /v1/models`
- Exposes `GET /v1/usage`
- Tracks local daily token/request usage in `data/usage.json`
- Applies per-provider RPM limits
- Applies a cooldown when a provider returns `429`
- Falls back on `402`, `403`, `408`, `409`, `429`, and `5xx`
- Keeps provider keys in `.env`, never in the repository

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm start
```

Then point OpenAI-compatible clients to:

```text
http://localhost:8787/v1
```

Use your `FREEAPIJUST_MASTER_KEY` as the API key for local client requests.

## Example Request

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/free","messages":[{"role":"user","content":"Say hello in Portuguese"}]}'
```

## Provider Setup

1. Copy `.env.example` to `.env`.
2. Add only the keys you legitimately own.
3. Edit `providers.json` if you want to disable providers, change priorities, or adjust conservative local limits.
4. Call `POST /v1/reload` after editing providers.

The default provider catalog includes OpenRouter, Groq, Cerebras, Mistral, GitHub Models, Gemini OpenAI-compatible API, NVIDIA NIM, Z.ai, and optional local Ollama.

## Notes

- Free tiers change often. Check each provider's current terms and limits before relying on them.
- Some providers may use free-tier prompts for model improvement. Review privacy terms before sending sensitive data.
- For production, add persistent storage, stricter authentication, observability, and provider-specific adapters.

## Inspired By

- FreeLLMAPI
- free-llm-gateway
- LiteLLM
- Portkey Gateway
- awesome-free-llm-apis
- free-llm-api-resources

This project is a clean-room aggregator and does not copy code from those projects.

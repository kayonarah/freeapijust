import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const usagePath = resolve(process.cwd(), "data", "usage.json");
const RATE_LIMIT_COOLDOWN_MS = 60_000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadUsage() {
  if (!existsSync(usagePath)) return {};
  return JSON.parse(readFileSync(usagePath, "utf8"));
}

function saveUsage(usage) {
  mkdirSync(dirname(usagePath), { recursive: true });
  writeFileSync(usagePath, JSON.stringify(usage, null, 2), "utf8");
}

function pruneRequestWindow(provider, now) {
  provider.requestsThisMinute = provider.requestsThisMinute.filter(
    (timestamp) => now - timestamp < 60_000
  );
}

function canUseProvider(provider, usage, now) {
  const day = todayKey();
  const used = usage[day]?.[provider.id]?.tokens ?? 0;
  pruneRequestWindow(provider, now);

  return (
    provider.cooldownUntil <= now &&
    provider.requestsThisMinute.length < provider.rpm &&
    used < provider.dailyTokenLimit
  );
}

function pickModel(provider, requestedModel) {
  if (requestedModel && provider.models.includes(requestedModel)) {
    return requestedModel;
  }

  return provider.models[0];
}

function normalizeError(error, provider) {
  return {
    provider: provider.id,
    status: error.status ?? 500,
    message: error.message ?? "Provider request failed",
  };
}

function shouldFallback(status) {
  return status === 402 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

async function callProvider(provider, body, signal) {
  const model = pickModel(provider, body.model);
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
      "x-title": "freeapijust",
    },
    body: JSON.stringify({ ...body, model }),
    signal,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") && text ? JSON.parse(text) : text;

  if (!response.ok) {
    const error = new Error(typeof payload === "string" ? payload : payload?.error?.message ?? response.statusText);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return { payload, model };
}

function recordUsage(provider, responsePayload, estimatedPromptTokens = 0) {
  const usage = loadUsage();
  const day = todayKey();
  usage[day] ??= {};
  usage[day][provider.id] ??= { tokens: 0, requests: 0 };

  const usedTokens =
    responsePayload?.usage?.total_tokens ??
    responsePayload?.usage?.totalTokens ??
    Math.max(1, estimatedPromptTokens);

  usage[day][provider.id].tokens += usedTokens;
  usage[day][provider.id].requests += 1;
  saveUsage(usage);
}

export async function routeChatCompletion(providers, body, options = {}) {
  const now = Date.now();
  const usage = loadUsage();
  const attempts = [];
  const availableProviders = providers
    .filter((provider) => canUseProvider(provider, usage, now))
    .sort((a, b) => a.priority - b.priority);

  if (availableProviders.length === 0) {
    const error = new Error("No provider is available. Check keys, rate limits, or daily token budgets.");
    error.status = 429;
    error.attempts = attempts;
    throw error;
  }

  const timeoutMs = options.timeoutMs ?? 45_000;
  const estimatedPromptTokens = JSON.stringify(body.messages ?? []).length / 4;

  for (const provider of availableProviders) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      provider.requestsThisMinute.push(Date.now());
      const result = await callProvider(provider, body, controller.signal);
      recordUsage(provider, result.payload, estimatedPromptTokens);

      return {
        provider,
        model: result.model,
        payload: result.payload,
        attempts,
      };
    } catch (error) {
      const status = error.name === "AbortError" ? 408 : error.status ?? 500;
      attempts.push(normalizeError({ ...error, status }, provider));

      if (status === 429) {
        provider.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      }

      if (!shouldFallback(status)) {
        throw Object.assign(error, { attempts, status });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const error = new Error("All configured providers failed or reached their free-tier limits.");
  error.status = attempts.at(-1)?.status ?? 502;
  error.attempts = attempts;
  throw error;
}

export function getUsageSnapshot() {
  return loadUsage();
}

import { createServer } from "node:http";
import { config as loadEnv } from "node:process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ensureLocalConfig, loadProviders } from "./providers.js";
import { getUsageSnapshot, routeChatCompletion } from "./router.js";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    process.env[key.trim()] ??= valueParts.join("=").trim();
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function isAuthorized(request) {
  const masterKey = process.env.FREEAPIJUST_MASTER_KEY;
  if (!masterKey) return true;

  const auth = request.headers.authorization ?? "";
  return auth === `Bearer ${masterKey}`;
}

function listModels(providers) {
  return {
    object: "list",
    data: providers.flatMap((provider) =>
      provider.models.map((model) => ({
        id: model,
        object: "model",
        owned_by: provider.id,
      }))
    ),
  };
}

loadDotEnv();
ensureLocalConfig();

let providers = loadProviders();
const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        providers: providers.map((provider) => provider.id),
      });
      return;
    }

    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: { message: "Invalid FREEAPIJUST_MASTER_KEY" } });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, listModels(providers));
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/usage") {
      sendJson(response, 200, getUsageSnapshot());
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/reload") {
      providers = loadProviders();
      sendJson(response, 200, { ok: true, providers: providers.map((provider) => provider.id) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readJson(request);
      const result = await routeChatCompletion(providers, body);
      sendJson(response, 200, result.payload, {
        "x-freeapijust-provider": result.provider.id,
        "x-freeapijust-model": result.model,
        "x-freeapijust-fallback-attempts": String(result.attempts.length),
      });
      return;
    }

    sendJson(response, 404, { error: { message: "Not found" } });
  } catch (error) {
    sendJson(response, error.status ?? 500, {
      error: {
        message: error.message,
        attempts: error.attempts ?? [],
      },
    });
  }
});

server.listen(port, () => {
  console.log(`freeapijust listening on http://localhost:${port}`);
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const providersPath = resolve(process.cwd(), "providers.json");
const examplePath = resolve(process.cwd(), "providers.example.json");

export function loadProviders() {
  const filePath = existsSync(providersPath) ? providersPath : examplePath;
  const providers = JSON.parse(readFileSync(filePath, "utf8"));

  return providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      ...provider,
      apiKey: provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : "local",
      cooldownUntil: 0,
      requestsThisMinute: [],
    }))
    .filter((provider) => provider.apiKey);
}

export function ensureLocalConfig() {
  if (!existsSync(providersPath)) {
    writeFileSync(
      providersPath,
      readFileSync(examplePath, "utf8"),
      "utf8"
    );
  }
}

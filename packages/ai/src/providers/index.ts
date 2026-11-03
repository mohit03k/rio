import type { Provider } from "../types/provider";
import { createOpenAiCompatible } from "./OpenAiCompatible";

function requireApiKey(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Set it in your environment or load your .env file.`);
  return value;
}

const providers: Record<string, () => Provider> = {
  "anthropic": () => createOpenAiCompatible("anthropic", requireApiKey("CLAUDE_API"), "https://api.anthropic.com/v1", "claude-opus-5-5"),
  "openrouter": () => createOpenAiCompatible("qwen", requireApiKey("OPENROUTER_API"),
    "https://openrouter.ai/api/v1/",
    "qwen/qwen3.8-27b"),
  "google": () => createOpenAiCompatible("gemini", requireApiKey("GEMINI_API"), "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-2.5-flash"),
  "groq": () => createOpenAiCompatible("groq", requireApiKey("GROQ_API"), "https://api.groq.com/openai/v1", "qwen/qwen3.8-27b")
}

export function getProvider(name: string): Provider {
  const provider = providers[name];

  if (!provider) {
    throw new Error("no provider found")
  }

  return provider();
}

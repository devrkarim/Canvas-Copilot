/**
 * Single Anthropic client + shared defaults. Every LLM call in the app goes
 * through here so model/thinking/fallback settings live in one place.
 */
import Anthropic from "@anthropic-ai/sdk";

const globalForLlm = globalThis as unknown as { __anthropic?: Anthropic };

export function anthropic(): Anthropic {
  if (!globalForLlm.__anthropic) globalForLlm.__anthropic = new Anthropic();
  return globalForLlm.__anthropic;
}

export const MODEL = "claude-opus-5";

/** Defaults for beta endpoints (tool runner): adaptive thinking + server-side refusal fallbacks. */
export const betaDefaults = {
  model: MODEL,
  thinking: { type: "adaptive" as const },
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

/** Defaults for the non-beta `messages.parse` structured-extraction calls. */
export const parseDefaults = {
  model: MODEL,
  thinking: { type: "adaptive" as const },
  output_config: { effort: "medium" as const },
  max_tokens: 16000,
};

export function llmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Pull the concatenated text blocks out of a response. */
export function textOf(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

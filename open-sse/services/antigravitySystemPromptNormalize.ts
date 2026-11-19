/**
 * Fork-owned: Antigravity systemInstruction normalization (competing-agent identity strip +
 * harness-marker rewrite), moved out of open-sse/executors/antigravity.ts so the
 * OpenAI -> Antigravity translator can apply it to client system parts before relocating
 * them into contents[0] (#9030). See .fork/notes/open-sse/executors/antigravity.ts.md and
 * .fork/notes/open-sse/translator/request/openai-to-gemini.ts.md.
 */
import { logger } from "../utils/logger.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Known competing-agent identity sentences that Antigravity's server-side
 * filter flags, answering with a 429 RESOURCE_EXHAUSTED (port of
 * decolua/9router b566b20, generalized). Only the identity sentence is
 * removed — surrounding instruction text is untouched.
 */
const COMPETITIVE_AGENT_PROMPT_PATTERNS: RegExp[] = [
  /\byou are a claude agent\b[^\n]*/i,
  /\bbuilt on anthropic's claude agent sdk\b[^\n]*/i,
  /\byou are claude code\b[^\n]*/i,
  /\byou are an ai assistant created by anthropic\b[^\n]*/i,
  // Fork: Codex CLI and DeepSeek Harness banners; only the sentence is removed.
  /\byou are codex,[^\n]*?\bbased on gpt-?\d+(?:\.\d+)*(?:-[a-z0-9]+)*\.?[ \t]*/i,
  /\byou are an ai agent powered by deepseek harness\b\.?[ \t]*/i,
];

/**
 * Oh My Pi (OMP) coding-harness markers reported to draw a false 429
 * RESOURCE_EXHAUSTED from Antigravity on large agent prompts even with quota
 * left. These are compatibility rewrites, not proof of intentional upstream
 * blocking: they only neutralize known harness tags/branding, and only inside
 * systemInstruction text. Order matters ("Oh My Pi coding harness" before
 * "Oh My Pi").
 */
const HARNESS_MARKER_REWRITES: Array<{ from: RegExp; to: string }> = [
  { from: /<(\/?)system[-_]conventions>/gi, to: "<$1conventions>" },
  { from: /<(\/?)system[-_]directive>/gi, to: "<$1instructions>" },
  { from: /<(\/?)critical>/gi, to: "<$1important>" },
  { from: /Oh My Pi coding harness/gi, to: "AI coding assistant" },
  { from: /Oh My Pi/gi, to: "coding assistant" },
  { from: /omp Live/gi, to: "coding assistant live" },
];

const promptNormalizeLog = logger("AG_PROMPT_NORMALIZE");

/**
 * Normalize systemInstruction.parts text before Antigravity dispatch: strip
 * competing-agent identity sentences (#10420) and rewrite OMP harness markers.
 * Only string `text` parts are touched; empty objects are dropped. Every other
 * part and field is kept. Returns undefined when no parts remain.
 * Returns the original reference when nothing matched (no allocation).
 */
export function normalizeAntigravitySystemInstruction(systemInstruction: unknown): unknown {
  const record = asRecord(systemInstruction);
  const allParts = Array.isArray(record?.parts)
    ? (record.parts as Array<Record<string, unknown>>)
    : null;
  if (!allParts) return systemInstruction;
  const parts = allParts.filter((part) => Object.keys(part).length > 0);
  if (parts.length === 0) return undefined;

  let changed = parts.length !== allParts.length;
  const newParts = parts.map((part) => {
    if (typeof part.text !== "string" || part.text.length === 0) return part;
    let text = part.text;
    for (const pattern of COMPETITIVE_AGENT_PROMPT_PATTERNS) {
      const stripped = text
        .replace(pattern, "")
        .replace(/\n{3,}/g, "\n\n")
        .trimStart();
      if (stripped !== text) {
        changed = true;
        text = stripped;
      }
    }
    let rewrites = 0;
    for (const { from, to } of HARNESS_MARKER_REWRITES) {
      const rewritten = text.replace(from, to);
      if (rewritten !== text) {
        rewrites++;
        text = rewritten;
      }
    }
    if (rewrites > 0) {
      changed = true;
      promptNormalizeLog.debug("Rewrote harness markers in systemInstruction", { rewrites });
    }
    return text === part.text ? part : { ...part, text };
  });

  return changed ? { ...record, parts: newParts } : systemInstruction;
}

/**
 * Normalize client system parts that the translator relocates into the first user turn:
 * same rules as systemInstruction, and parts left with empty text are dropped.
 */
export function normalizeAntigravityClientSystemParts<T>(parts: T[]): T[] {
  if (parts.length === 0) return parts;
  const normalized = normalizeAntigravitySystemInstruction({ parts }) as { parts: T[] } | undefined;
  if (!normalized) return [];
  return normalized.parts.filter((part) => (asRecord(part)?.text as unknown) !== "");
}

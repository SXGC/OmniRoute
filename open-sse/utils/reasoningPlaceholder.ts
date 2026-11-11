/**
 * Internal replay sentinel used when an upstream requires non-empty reasoning content but the
 * original reasoning summary is unavailable. It is valid request scaffolding, never user-visible
 * reasoning, so response translators must suppress it before emitting client-facing events.
 */
export const NON_ANTHROPIC_THINKING_PLACEHOLDER = "(prior reasoning summary unavailable)";

export function isInternalReasoningPlaceholder(value: unknown): boolean {
  return typeof value === "string" && value.trim() === NON_ANTHROPIC_THINKING_PLACEHOLDER;
}

/**
 * Strip the internal placeholder from user-visible content. Models sometimes
 * echo the sentinel through ordinary `message.content` / `delta.content`
 * (#8081). Removes all occurrences; returns "" when only whitespace remains so
 * callers can skip emission entirely.
 *
 * IMPORTANT (#5786): this runs per-delta on the streaming path, where a delta's
 * leading/trailing spaces are meaningful (e.g. "Hello, " + "world." + " Bye.").
 * Only collapse to "" when the placeholder WAS the whole content — never trim
 * real content, or streamed deltas glue together with their spaces eaten.
 */
export function stripInternalReasoningPlaceholder(value: string): string {
  if (!value.includes(NON_ANTHROPIC_THINKING_PLACEHOLDER)) return value;

  const stripped = value.replaceAll(NON_ANTHROPIC_THINKING_PLACEHOLDER, "");
  return stripped.trim() === "" ? "" : stripped;
}

/**
 * Upstreams that reject an ABSENT reasoning_content on replay turns, so the
 * placeholder must survive the cache miss.
 *
 * #9573/#9610 removed the placeholder globally because the model echoed it as
 * its own reasoning and stopped (empty turns). That holds for DeepSeek, where
 * an absent field was verified to be accepted — but Xiaomi MiMo still 400s
 * ("Param Incorrect: The reasoning_content in the thinking mode must be passed
 * back to the API", 9router#1321/#1337), so omitting the field there trades one
 * live bug for another. The opencode console gateways (opencode-go /
 * opencode-zen / opencode) enforce the same contract on their Responses
 * transport for deepseek/glm thinking models (production: 54× 400 "The
 * reasoning_text in the thinking mode must be passed back to the API" in one
 * day). Keep the placeholder only for those providers; the echo that comes
 * back is still stripped on the way in by isInternalReasoningPlaceholder(), so
 * it never re-poisons cache or history.
 */
export function requiresReasoningContentPresence(provider: unknown, model: unknown): boolean {
  const normalizedProvider = String(provider ?? "")
    .trim()
    .toLowerCase();
  const normalizedModel = String(model ?? "")
    .trim()
    .toLowerCase();
  return (
    normalizedProvider === "xiaomi-mimo" ||
    /(^|\/)mimo/i.test(normalizedModel) ||
    ["opencode-go", "opencode-zen"].includes(normalizedProvider)
  );
}

/** Tool-call ids issued by native DeepSeek look like `call_00_<suffix>` (`call_<2 digits>_`). */
const DEEPSEEK_ISSUED_TOOL_CALL_ID = /^call_\d{2}_/;

/**
 * Native DeepSeek accepts an ABSENT `reasoning_content` only on assistant
 * tool-call turns it issued itself. When a combo falls back to it mid tool loop
 * after another provider (e.g. OpenCode, ids like `call_528d4b5e...`) served the
 * previous step without reasoning, DeepSeek 400s with "The reasoning_content in
 * the thinking mode must be passed back to the API". Such turns need the
 * presence placeholder; DeepSeek-issued turns keep the field absent so the
 * model does not echo the sentinel (#9573/#9610). A missing or non-string id
 * is treated as foreign.
 */
export function hasForeignToolCallsRequiringReasoning(
  provider: unknown,
  toolCalls: unknown
): boolean {
  if (
    String(provider ?? "")
      .trim()
      .toLowerCase() !== "deepseek"
  ) {
    return false;
  }
  if (!Array.isArray(toolCalls)) return false;
  return toolCalls.some((toolCall) => {
    const id =
      toolCall && typeof toolCall === "object" ? (toolCall as { id?: unknown }).id : undefined;
    return typeof id !== "string" || !DEEPSEEK_ISSUED_TOOL_CALL_ID.test(id);
  });
}

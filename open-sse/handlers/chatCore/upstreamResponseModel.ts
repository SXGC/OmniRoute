/**
 * chatCore upstream response-model observation (Responses API only).
 *
 * The provider payload collector (`open-sse/utils/streamPayloadCollector.ts`)
 * already retains the model the upstream declared in its own Responses events:
 * its Responses reducer snapshots `response.completed` first (terminal wins)
 * and any other `response`-carrying event as fallback — the same semantics as
 * the sub2api `upstreamResponseModelObserver`. This helper just reads that
 * summary and decides whether it constitutes an *observation*:
 *
 * - Only `summary.object === "response"` counts. That shape is produced only
 *   when the upstream actually spoke the Responses protocol (translate-mode
 *   chat upstreams summarize as `chat.completion`), which scopes the feature
 *   to Responses API traffic without any extra wiring.
 * - `fallbackModel` ("unknown"/routed-model echoes) is NOT an observation:
 *   the reducer substitutes it when the upstream never declared a model, and
 *   treating it as one would make "not declared" indistinguishable from
 *   "matches". Callers pass the routed model so those echoes can be excluded.
 *
 * Log-only: billing is unchanged.
 */

/** Extracts the upstream-declared model from a provider payload or raw Responses body, or null. */
export function extractUpstreamResponseModel(
  providerPayload: unknown,
  routedModel: string | null | undefined
): string | null {
  if (!providerPayload || typeof providerPayload !== "object") return null;
  const payloadRecord = providerPayload as Record<string, unknown>;
  // Non-streaming Responses bodies arrive unwrapped (object === "response" at
  // the top level); streaming ones carry the collector's { summary } wrapper.
  const candidate = payloadRecord.object === "response" ? payloadRecord : payloadRecord.summary;
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  if (record.object !== "response") return null;
  const model = record.model;
  if (typeof model !== "string") return null;
  const trimmed = model.trim();
  if (!trimmed || trimmed === "unknown") return null;
  // The reducer's fallbackModel is the routed model — anything equal to it is
  // not provably an upstream declaration, so drop it (log nothing rather than
  // a self-echo).
  if (routedModel && trimmed === routedModel) return null;
  return trimmed;
}

/** True when the observed upstream model differs from the routed model (case-insensitive). */
export function upstreamModelMismatched(
  upstreamModel: string | null,
  routedModel: string | null | undefined
): boolean {
  if (!upstreamModel || !routedModel) return false;
  return upstreamModel.toLowerCase() !== routedModel.toLowerCase();
}

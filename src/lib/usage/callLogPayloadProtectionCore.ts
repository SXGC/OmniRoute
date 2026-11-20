import {
  sanitizeErrorMessage,
  sanitizeUpstreamDetails,
} from "../../../open-sse/utils/errorSanitization.ts";
import { projectResponsesFailureOutput } from "../../../open-sse/utils/responsesFailureOutput.ts";
import type { RequestPipelinePayloads } from "../../../open-sse/utils/requestLogger.ts";
import type { CallLogArtifact } from "./callLogArtifacts.ts";

type JsonRecord = Record<string, unknown>;

export type CallLogArtifactProtection = {
  protectRequestBody?: boolean;
  protectResponseBody?: boolean;
  protectPipelinePayloads?: boolean;
  failedResponse?: boolean;
  responseStatus?: number;
};

const SENSITIVE_KEYS = new Set([
  "api_key",
  "apiKey",
  "api-key",
  "authorization",
  "Authorization",
  "x-api-key",
  "X-Api-Key",
  "x-goog-api-key",
  "xi-api-key",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "password",
  "secret",
  "token",
  "cookie",
  "Cookie",
  "storageState",
  "storage-state",
  "runtimeKey",
]);

const SENSITIVE_CHALLENGE_KEYS = new Set([
  "recaptchav3token",
  "recaptchatoken",
  "turnstiletoken",
  "prooftoken",
  "resumetoken",
  "preparetoken",
]);

const ENCRYPTED_REASONING_KEY = "encrypted_content";
const SERIALIZED_ENCRYPTED_REASONING_RE = /("encrypted_content"\s*:\s*")((?:\\.|[^"\\])*)"/g;
const STREAM_CHUNK_TIMESTAMP_RE = /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] /;

const ERROR_SUBTREE_KEYS = new Set([
  "error",
  "errors",
  "warning",
  "warnings",
  "errormessage",
  "warningmessage",
  "errordescription",
  "warningdescription",
  "lasterror",
]);

const STREAM_ERROR_DISCRIMINATOR_KEYS = ["type", "event", "kind", "status"] as const;
const STREAM_ERROR_DISCRIMINATORS = new Set(["error", "warning"]);
const RESPONSES_FAILURE_DISCRIMINATORS = new Set(["response.failed"]);
const RESPONSE_FAILURE_MESSAGE_KEYS = new Set(["message", "detail", "details", "description"]);
const STREAM_ERROR_ENVELOPE_RE =
  /["'](?:error|errors|warning|warnings|last_error|lastError|errorMessage|warningMessage)["']\s*:|["'](?:type|event|kind)["']\s*:\s*["'](?:error|warning|response\.(?:failed|completed))["']|["']status["']\s*:\s*["']failed["']/i;

function isSensitivePayloadKey(key: string): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;
  const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
  return SENSITIVE_CHALLENGE_KEYS.has(normalizedKey);
}

function isErrorSubtreeKey(key: string): boolean {
  return ERROR_SUBTREE_KEYS.has(key.replace(/[-_]/g, "").toLowerCase());
}

function isResponseFailureMessageKey(key: string): boolean {
  return RESPONSE_FAILURE_MESSAGE_KEYS.has(key.replace(/[-_]/g, "").toLowerCase());
}

function isOpaqueBinary(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function describeOpaqueBinary(value: ArrayBufferView): string {
  return `[binary ${value.byteLength} bytes]`;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function encryptedReasoningOmissionMarker(length?: number): string {
  return length === undefined
    ? "[omitted: encrypted reasoning]"
    : `[omitted: encrypted reasoning, ${length} chars]`;
}

function inlineImageMarker(mime: string, base64: string): string {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;
  return `[inline image: ${mime}, ${bytes} bytes, ${base64.length} base64 chars]`;
}

function inlineImageDataUrlMarker(value: string): string | null {
  if (!value.startsWith("data:image/")) return null;
  const comma = value.indexOf(",");
  const header = comma > 0 && comma <= 200 ? value.slice(5, comma) : "";
  if (!header.endsWith(";base64")) return null;
  return inlineImageMarker(header.slice(0, header.indexOf(";")), value.slice(comma + 1));
}

function redactInlineImageDataUrlsCore(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return inlineImageDataUrlMarker(value) ?? value;
  if (!value || typeof value !== "object" || isOpaqueBinary(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      let copy: unknown[] | null = null;
      value.forEach((item, index) => {
        const next = redactInlineImageDataUrlsCore(item, seen);
        if (next === item) return;
        copy ??= value.slice();
        copy[index] = next;
      });
      return copy ?? value;
    }
    const record = value as JsonRecord;
    const mime = record.media_type ?? record.mimeType ?? record.mime_type;
    const imageMime = typeof mime === "string" && mime.startsWith("image/") ? mime : null;
    let copy: JsonRecord | null = null;
    for (const [key, item] of Object.entries(record)) {
      const next =
        imageMime && key === "data" && typeof item === "string" && item.length > 0
          ? inlineImageMarker(imageMime, item)
          : redactInlineImageDataUrlsCore(item, seen);
      if (next === item) continue;
      copy ??= { ...record };
      copy[key] = next;
    }
    return copy ?? record;
  } finally {
    seen.delete(value);
  }
}

function normalizePayloadForLogCore(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  const trimmed = payload.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return { _rawText: payload };
  }
}

function sanitizeErrorSubtreeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeErrorMessage(value);
  try {
    if (value instanceof Error) {
      return {
        name: sanitizeErrorMessage(value.name) || "Error",
        message: sanitizeErrorMessage(value.message),
      };
    }
    return sanitizeUpstreamDetails(value);
  } catch {
    return "[REDACTED]";
  }
}

function isResponsesFailureEvent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const record = value as JsonRecord;
    const directFailure = STREAM_ERROR_DISCRIMINATOR_KEYS.some((key) => {
      const discriminator = record[key];
      return (
        typeof discriminator === "string" &&
        RESPONSES_FAILURE_DISCRIMINATORS.has(discriminator.trim().toLowerCase())
      );
    });
    if (directFailure) return true;

    const status = record.status;
    if (typeof status === "string" && status.trim().toLowerCase() === "failed") return true;

    const nestedResponse = record.response;
    if (!nestedResponse || typeof nestedResponse !== "object" || Array.isArray(nestedResponse)) {
      return false;
    }
    const nestedStatus = (nestedResponse as JsonRecord).status;
    return typeof nestedStatus === "string" && nestedStatus.trim().toLowerCase() === "failed";
  } catch {
    return true;
  }
}

function isDiscriminatedStreamError(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const record = value as JsonRecord;
    return STREAM_ERROR_DISCRIMINATOR_KEYS.some((key) => {
      const discriminator = record[key];
      return (
        typeof discriminator === "string" &&
        STREAM_ERROR_DISCRIMINATORS.has(discriminator.trim().toLowerCase())
      );
    });
  } catch {
    return true;
  }
}

type ErrorSubtreeProjection = { value: unknown; found: boolean };

function projectErrorSubtreesOnly(
  value: unknown,
  seen = new WeakSet<object>(),
  forceResponsesFailure = false,
  protocolResponseObject = false
): ErrorSubtreeProjection {
  if (forceResponsesFailure && typeof value === "string") {
    return { value: sanitizeErrorMessage(value) || "[REDACTED]", found: true };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      STREAM_ERROR_ENVELOPE_RE.test(trimmed)
    ) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const projected = isDiscriminatedStreamError(parsed)
          ? { value: sanitizeErrorSubtreeValue(parsed), found: true }
          : projectErrorSubtreesOnly(parsed, seen);
        if (projected.found) {
          const serialized = JSON.stringify(projected.value);
          if (typeof serialized === "string") return { value: serialized, found: true };
        }
      } catch {
        return { value: sanitizeErrorMessage(value) || "[REDACTED]", found: true };
      }
    }
    return { value, found: false };
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return { value, found: false };
  }
  if (isOpaqueBinary(value)) return { value, found: false };
  if (isDiscriminatedStreamError(value)) {
    return { value: sanitizeErrorSubtreeValue(value), found: true };
  }
  const declaresResponsesFailure = isResponsesFailureEvent(value);
  const responsesFailure = forceResponsesFailure || declaresResponsesFailure;
  if (seen.has(value)) return { value: "[circular]", found: false };
  seen.add(value);

  if (Array.isArray(value)) {
    try {
      let found = false;
      const projected = value.map((entry) => {
        const result = projectErrorSubtreesOnly(entry, seen, responsesFailure, false);
        found ||= result.found;
        return result.value;
      });
      return { value: projected, found };
    } finally {
      seen.delete(value);
    }
  }

  try {
    let found = responsesFailure;
    const projected: JsonRecord = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (isErrorSubtreeKey(key) || (responsesFailure && isResponseFailureMessageKey(key))) {
        projected[key] = sanitizeErrorSubtreeValue(entryValue);
        found = true;
        continue;
      }
      const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
      const preservePartialOutput =
        responsesFailure &&
        normalizedKey === "output" &&
        (protocolResponseObject || declaresResponsesFailure);
      if (preservePartialOutput) {
        projected[key] = projectResponsesFailureOutput(
          entryValue,
          (_field, stringValue) => sanitizeErrorMessage(stringValue) || "[REDACTED]"
        );
        found = true;
        continue;
      }
      const childIsProtocolResponse =
        normalizedKey === "response" &&
        (declaresResponsesFailure || (forceResponsesFailure && !protocolResponseObject));
      const result = projectErrorSubtreesOnly(
        entryValue,
        seen,
        responsesFailure,
        childIsProtocolResponse
      );
      projected[key] = result.value;
      found ||= result.found;
    }
    return { value: projected, found };
  } catch {
    return { value: "[REDACTED]", found: false };
  } finally {
    seen.delete(value);
  }
}

function omitAndRedactPass(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  if (isOpaqueBinary(payload)) return describeOpaqueBinary(payload);
  if (Array.isArray(payload)) return payload.map(omitAndRedactPass);

  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(payload)) {
    if (isSensitivePayloadKey(key)) {
      out[key] = "[REDACTED]";
    } else if (key === ENCRYPTED_REASONING_KEY && typeof value === "string" && value.length > 0) {
      out[key] = encryptedReasoningOmissionMarker(value.length);
    } else if (typeof value === "string" && value.startsWith("Bearer ")) {
      out[key] = "Bearer [REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      out[key] = omitAndRedactPass(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function protectSinglePass(
  value: unknown,
  redactInlineImages: boolean,
  seen = new WeakSet<object>(),
  forceResponsesFailure = false,
  protocolResponseObject = false
): unknown {
  if (typeof value === "string") {
    if (redactInlineImages) {
      const marker = inlineImageDataUrlMarker(value);
      if (marker !== null) {
        return forceResponsesFailure ? sanitizeErrorMessage(marker) || "[REDACTED]" : marker;
      }
    }
    if (forceResponsesFailure) {
      return sanitizeErrorMessage(value) || "[REDACTED]";
    }
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      STREAM_ERROR_ENVELOPE_RE.test(trimmed)
    ) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const projected = isDiscriminatedStreamError(parsed)
          ? { value: sanitizeErrorSubtreeValue(parsed), found: true }
          : projectErrorSubtreesOnly(parsed, seen);
        if (projected.found) {
          const serialized = JSON.stringify(projected.value);
          if (typeof serialized === "string") return serialized;
        }
      } catch {
        return sanitizeErrorMessage(value) || "[REDACTED]";
      }
    }
    return value;
  }

  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (isOpaqueBinary(value)) return describeOpaqueBinary(value);
  if (isDiscriminatedStreamError(value)) {
    const prepared = redactInlineImages ? redactInlineImageDataUrlsCore(value) : value;
    return omitAndRedactPass(sanitizeErrorSubtreeValue(prepared));
  }

  const declaresResponsesFailure = isResponsesFailureEvent(value);
  const responsesFailure = forceResponsesFailure || declaresResponsesFailure;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    try {
      return value.map((entry) =>
        protectSinglePass(entry, redactInlineImages, seen, responsesFailure, false)
      );
    } finally {
      seen.delete(value);
    }
  }

  try {
    const record = value as JsonRecord;
    const mime = redactInlineImages
      ? (record.media_type ?? record.mimeType ?? record.mime_type)
      : null;
    const imageMime = typeof mime === "string" && mime.startsWith("image/") ? mime : null;
    const out: JsonRecord = {};
    for (const [key, rawEntryValue] of Object.entries(record)) {
      if (isSensitivePayloadKey(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      const entryValue =
        imageMime && key === "data" && typeof rawEntryValue === "string" && rawEntryValue.length > 0
          ? inlineImageMarker(imageMime, rawEntryValue)
          : rawEntryValue;
      if (isErrorSubtreeKey(key) || (responsesFailure && isResponseFailureMessageKey(key))) {
        const prepared = redactInlineImages
          ? redactInlineImageDataUrlsCore(entryValue)
          : entryValue;
        const sanitized = sanitizeErrorSubtreeValue(prepared);
        if (typeof sanitized === "string" && sanitized.startsWith("Bearer ")) {
          out[key] = "Bearer [REDACTED]";
        } else {
          out[key] = omitAndRedactPass(sanitized);
        }
        continue;
      }
      const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
      const preservePartialOutput =
        responsesFailure &&
        normalizedKey === "output" &&
        (protocolResponseObject || declaresResponsesFailure);
      if (preservePartialOutput) {
        const prepared = redactInlineImages
          ? redactInlineImageDataUrlsCore(entryValue)
          : entryValue;
        const projectedOutput = projectResponsesFailureOutput(
          prepared,
          (_field, stringValue) => sanitizeErrorMessage(stringValue) || "[REDACTED]"
        );
        out[key] = omitAndRedactPass(projectedOutput);
        continue;
      }
      const childIsProtocolResponse =
        normalizedKey === "response" &&
        (declaresResponsesFailure || (forceResponsesFailure && !protocolResponseObject));
      const child = protectSinglePass(
        entryValue,
        redactInlineImages,
        seen,
        responsesFailure,
        childIsProtocolResponse
      );
      if (key === ENCRYPTED_REASONING_KEY && typeof child === "string" && child.length > 0) {
        out[key] = encryptedReasoningOmissionMarker(child.length);
      } else if (typeof child === "string" && child.startsWith("Bearer ")) {
        out[key] = "Bearer [REDACTED]";
      } else {
        out[key] = child;
      }
    }
    return out;
  } catch {
    return "[REDACTED]";
  } finally {
    seen.delete(value);
  }
}

function omitEncryptedReasoningFromLogChunksCore(chunks: string[]): string[] {
  const combined = chunks.map((chunk) => chunk.replace(STREAM_CHUNK_TIMESTAMP_RE, "")).join("");
  let found = false;
  const omitted = combined.replace(SERIALIZED_ENCRYPTED_REASONING_RE, (_match, prefix: string) => {
    found = true;
    return `${prefix}${encryptedReasoningOmissionMarker()}"`;
  });
  return found ? [omitted] : chunks;
}

function sanitizeStreamErrorPayloadCore(
  rawPayload: string,
  forceError: boolean,
  forceResponsesFailure = false
): { found: boolean; value: string } {
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    if (forceError || isDiscriminatedStreamError(parsed)) {
      const projected = sanitizeErrorSubtreeValue(parsed);
      const serialized = JSON.stringify(projected);
      return {
        found: true,
        value: typeof serialized === "string" ? serialized : "[REDACTED]",
      };
    }
    const projected = projectErrorSubtreesOnly(
      parsed,
      new WeakSet<object>(),
      forceResponsesFailure
    );
    if (!projected.found) return { found: false, value: rawPayload };
    return { found: true, value: JSON.stringify(projected.value) };
  } catch {
    if (!forceError && !forceResponsesFailure && !STREAM_ERROR_ENVELOPE_RE.test(rawPayload)) {
      return { found: false, value: rawPayload };
    }
    return {
      found: true,
      value: sanitizeErrorMessage(rawPayload) || "[REDACTED]",
    };
  }
}

function sanitizeErrorFramesFromLogChunksCore(chunks: string[]): string[] {
  const combined = chunks.map((chunk) => chunk.replace(STREAM_CHUNK_TIMESTAMP_RE, "")).join("");
  let found = false;
  let errorEventActive = false;
  let responsesFailureEventActive = false;
  const projectedLines = combined.split("\n").map((line) => {
    if (line.trim().length === 0) {
      errorEventActive = false;
      responsesFailureEventActive = false;
      return line;
    }

    const eventMatch = line.match(/^\s*event:\s*([^\s]+)\s*$/i);
    if (eventMatch) {
      const eventName = eventMatch[1].toLowerCase();
      errorEventActive = STREAM_ERROR_DISCRIMINATORS.has(eventName);
      responsesFailureEventActive = RESPONSES_FAILURE_DISCRIMINATORS.has(eventName);
      return line;
    }

    const dataMatch = line.match(/^(\s*data:)([ \t]?)(.*)$/);
    if (dataMatch) {
      const rawPayload = dataMatch[3].trim();
      if (!rawPayload || rawPayload === "[DONE]") return line;
      const projected = sanitizeStreamErrorPayloadCore(
        rawPayload,
        errorEventActive,
        responsesFailureEventActive
      );
      if (!projected.found) return line;
      found = true;
      return `${dataMatch[1]}${dataMatch[2]}${projected.value}`;
    }

    if (errorEventActive || responsesFailureEventActive) {
      found = true;
      return sanitizeErrorMessage(line) || "[REDACTED]";
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return line;
    const projected = sanitizeStreamErrorPayloadCore(trimmed, false);
    if (!projected.found) return line;
    found = true;
    return `${line.slice(0, line.length - line.trimStart().length)}${projected.value}`;
  });

  return found ? [projectedLines.join("\n")] : chunks;
}

/** O(1) presence check equivalent to `protectPayloadForLog(payload) !== null` without tree walks. */
export function hasProtectablePayload(payload: unknown): boolean {
  if (payload === null || payload === undefined) return false;
  if (typeof payload === "string" && payload.trim() === "null") return false;
  return true;
}

/** O(top-level keys) presence check equivalent to `protectPipelinePayloads(payloads) !== null`. */
export function hasProtectablePipelinePayloads(payloads: unknown): boolean {
  if (!payloads || typeof payloads !== "object") return false;
  for (const [key, value] of Object.entries(payloads as JsonRecord)) {
    if (value === null || value === undefined) continue;
    if (key === "streamChunks" && typeof value === "object") {
      const chunks = value as Record<string, unknown>;
      if (
        Object.values(chunks).some(
          (chunkValue) => Array.isArray(chunkValue) && chunkValue.length > 0
        )
      ) {
        return true;
      }
      continue;
    }
    return true;
  }
  return false;
}

export function protectPayloadForWorker(payload: unknown): unknown {
  if (payload === null || payload === undefined) return null;
  const normalized = normalizePayloadForLogCore(payload);
  if (normalized === null || normalized === undefined) return null;
  return protectSinglePass(normalized, false);
}

export function protectRequestBodyForWorker(payload: unknown): unknown {
  if (payload === null || payload === undefined) return null;
  const normalized = normalizePayloadForLogCore(payload);
  if (normalized === null || normalized === undefined) return null;
  return protectSinglePass(normalized, true);
}

export function protectErrorPayloadForWorker(payload: unknown): unknown {
  if (payload === null || payload === undefined) return null;
  const normalized = normalizePayloadForLogCore(payload);
  if (isOpaqueBinary(normalized)) return describeOpaqueBinary(normalized);
  const errorProjected = sanitizeErrorSubtreeValue(normalized);
  return omitAndRedactPass(errorProjected);
}

export function protectPipelinePayloadsForWorker(
  payloads: unknown,
  responseStatus?: unknown
): RequestPipelinePayloads | null {
  if (!payloads || typeof payloads !== "object") return null;

  const protectedPayloads: RequestPipelinePayloads = {};
  for (const [key, value] of Object.entries(payloads as JsonRecord)) {
    if (value === null || value === undefined) continue;

    if (key === "streamChunks" && value && typeof value === "object") {
      const chunks = value as Record<string, unknown>;
      const compacted = Object.fromEntries(
        Object.entries(chunks)
          .filter(([, chunkValue]) => Array.isArray(chunkValue) && chunkValue.length > 0)
          .map(([stage, chunkValue]) => [
            stage,
            sanitizeErrorFramesFromLogChunksCore(
              omitEncryptedReasoningFromLogChunksCore(chunkValue as string[])
            ),
          ])
      );
      if (Object.keys(compacted).length > 0) {
        protectedPayloads.streamChunks = protectPayloadForWorker(
          compacted
        ) as RequestPipelinePayloads["streamChunks"];
      }
      continue;
    }

    if (key === "providerResponse" || key === "clientResponse") {
      const response = asRecord(value);
      if ("diagnostic" in response && !("body" in response)) {
        protectedPayloads[key as "providerResponse" | "clientResponse"] = protectPayloadForWorker(
          value
        ) as RequestPipelinePayloads["providerResponse"];
        continue;
      }
      const status = Number(response.status ?? responseStatus);
      if (Number.isFinite(status) && status >= 400 && status <= 599) {
        const projectedResponse =
          "body" in response
            ? { ...response, body: protectErrorPayloadForWorker(response.body) }
            : protectErrorPayloadForWorker(value);
        protectedPayloads[key as "providerResponse" | "clientResponse"] = protectPayloadForWorker(
          projectedResponse
        ) as RequestPipelinePayloads["providerResponse"];
        continue;
      }
    }

    protectedPayloads[key as keyof RequestPipelinePayloads] = protectPayloadForWorker(
      value
    ) as never;
  }

  return Object.keys(protectedPayloads).length > 0 ? protectedPayloads : null;
}

export function protectArtifactForWorker(
  artifact: CallLogArtifact,
  protection?: CallLogArtifactProtection
): CallLogArtifact {
  if (!protection) return artifact;
  const nextArtifact: CallLogArtifact = { ...artifact };

  if (protection.protectRequestBody) {
    nextArtifact.requestBody = protectRequestBodyForWorker(artifact.requestBody);
  }
  if (protection.protectResponseBody) {
    nextArtifact.responseBody = protection.failedResponse
      ? protectErrorPayloadForWorker(artifact.responseBody)
      : protectPayloadForWorker(artifact.responseBody);
  }
  if (protection.protectPipelinePayloads) {
    const protectedPipeline = protectPipelinePayloadsForWorker(
      artifact.pipeline,
      protection.failedResponse ? protection.responseStatus : undefined
    );
    if (protectedPipeline) {
      nextArtifact.pipeline = protectedPipeline;
    } else {
      delete nextArtifact.pipeline;
    }
  }

  return nextArtifact;
}

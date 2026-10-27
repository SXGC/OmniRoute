export type JsonRecord = Record<string, unknown>;

const TARGET_MODEL = "google/gemini-4-argon";
const SKIP_SIGNATURE = "skip_thought_signature_validator";

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFunctionCall(call: unknown): call is JsonRecord {
  if (!isPlainObject(call) || call.type !== "function") return false;
  if (typeof call.id !== "string" || call.id === "") return false;
  const fn = call.function;
  if (!isPlainObject(fn)) return false;
  return typeof fn.name === "string" && fn.name !== "" && typeof fn.arguments === "string";
}

function needsPatch(call: JsonRecord): boolean {
  const extraContent = call.extra_content;
  if (extraContent === undefined || extraContent === null) return true;
  if (!isPlainObject(extraContent)) return false;
  const google = extraContent.google;
  if (google === undefined || google === null) return true;
  if (!isPlainObject(google)) return false;
  const signature = google.thought_signature;
  return signature === undefined || signature === null || signature === "";
}

function patchCall(call: JsonRecord): JsonRecord {
  const extraContent = isPlainObject(call.extra_content) ? call.extra_content : {};
  const google = isPlainObject(extraContent.google) ? extraContent.google : {};
  return {
    ...call,
    extra_content: {
      ...extraContent,
      google: { ...google, thought_signature: SKIP_SIGNATURE },
    },
  };
}

export function patchCloudflareGeminiToolSignatures(
  routedModel: string,
  body: JsonRecord
): JsonRecord {
  if (routedModel !== TARGET_MODEL) return body;
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;

  let changed = false;
  const patchedMessages = messages.map((message) => {
    if (!isPlainObject(message) || message.role !== "assistant") return message;
    const toolCalls = message.tool_calls;
    if (!Array.isArray(toolCalls)) return message;
    let callsChanged = false;
    const patchedCalls = toolCalls.map((call) => {
      if (!isFunctionCall(call) || !needsPatch(call)) return call;
      callsChanged = true;
      return patchCall(call);
    });
    if (!callsChanged) return message;
    changed = true;
    return { ...message, tool_calls: patchedCalls };
  });

  if (!changed) return body;
  return { ...body, messages: patchedMessages };
}

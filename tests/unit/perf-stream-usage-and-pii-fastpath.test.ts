import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSSEStream } from "../../open-sse/utils/stream.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";
import { estimateInputTokens } from "../../open-sse/utils/usageEstimation.ts";
import type { GuardrailContext } from "../../src/lib/guardrails/base";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-perf-fastpath-"));
process.env.DATA_DIR = tmpDir;
delete process.env.PII_REDACTION_ENABLED;
delete process.env.PII_RESPONSE_SANITIZATION;

const { clearAllFeatureFlagOverrides } = await import("../../src/lib/db/featureFlags.ts");
const { resetDbInstance } = await import("../../src/lib/db/core.ts");
const { PIIMaskerGuardrail } = await import("../../src/lib/guardrails/piiMasker.ts");

test.after(() => {
  delete process.env.PII_REDACTION_ENABLED;
  delete process.env.PII_RESPONSE_SANITIZATION;
  clearAllFeatureFlagOverrides();
  resetDbInstance();
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function drainTransformStream(
  transform: TransformStream<Uint8Array, Uint8Array>,
  sseText: string
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();

  const readAll = (async () => {
    let out = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  })();

  await writer.write(encoder.encode(sseText));
  await writer.close();
  return readAll;
}

test("non-Claude stream with real provider usage does not estimate input tokens from request body on flush", async () => {
  let bodySerialized = 0;
  const body = {
    model: "gpt-6.2-sol",
    messages: [
      {
        role: "user",
        get content() {
          bodySerialized++;
          return "large prompt ".repeat(200);
        },
      },
    ],
  };

  let completedUsage: Record<string, unknown> | null = null;
  const transform = createSSEStream({
    mode: "passthrough",
    targetFormat: FORMATS.OPENAI,
    sourceFormat: FORMATS.OPENAI,
    provider: "codex",
    model: "gpt-6.2-sol",
    body,
    onComplete: (payload) => {
      completedUsage = (payload?.usage as Record<string, unknown> | null) ?? null;
    },
  });

  const sse = [
    'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
    'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":600,"completion_tokens":42,"total_tokens":642}}\n\n',
    "data: [DONE]\n\n",
  ].join("");

  // Reset after stream construction (which hashes session id / body length) so we
  // isolate stream-processing and flush() reads.
  bodySerialized = 0;
  await drainTransformStream(transform, sse);

  // sanitizeUsagePayloadForRequest reads body once to check plausibility; flush()
  // must NOT call estimateInputTokens(body) a second time via nativeClaudeUsage.getUsage().
  assert.ok(
    bodySerialized <= 2,
    `expected no flush-time estimateInputTokens walk on non-Claude stream, got ${bodySerialized} reads`
  );
  assert.ok(completedUsage);
  assert.equal(completedUsage.prompt_tokens, 600);
  assert.equal(completedUsage.completion_tokens, 42);
});

test("zero-allocation estimateInputTokens matches expected counts for ASCII, camelCase, CJK, and tools", () => {
  assert.equal(estimateInputTokens(null), 0);
  assert.equal(estimateInputTokens("not-an-object"), 0);

  const plain = estimateInputTokens({
    messages: [{ role: "user", content: "helloWorld foo_bar 123! 你好世界" }],
  });
  assert.equal(plain, 42);

  const withTools = estimateInputTokens({
    messages: [{ role: "user", content: "call tool" }],
    tools: [
      {
        type: "function",
        function: {
          name: "read_file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      },
    ],
  });
  assert.ok(withTools > plain * 0.5, `tools should contribute to estimate: ${withTools}`);

  // Astral CJK (U+20000) surrogate pair should count as 1 CJK token without throwing
  const astral = estimateInputTokens({ text: "𠀀" });
  assert.ok(astral > 0);
});

test("PIIMaskerGuardrail fast-returns without touching payload or response when flags are off", async () => {
  clearAllFeatureFlagOverrides();
  const guardrail = new PIIMaskerGuardrail();
  const ctx = {} as GuardrailContext;

  let reqReads = 0;
  const reqPayload = {
    model: "codex/gpt-6.2-sol",
    get messages() {
      reqReads++;
      return [{ role: "user", content: "my ssn is 123-45-6789 and IBAN DE89370400440532013000" }];
    },
  };

  const pre = await guardrail.preCall(reqPayload, ctx);
  assert.equal(pre.block, false);
  assert.equal(pre.meta, null);
  assert.equal(pre.modifiedPayload, undefined);
  assert.equal(
    reqReads,
    0,
    "preCall must not read or traverse messages when PII_REDACTION_ENABLED is off"
  );

  let resReads = 0;
  const resPayload = {
    get choices() {
      resReads++;
      return [{ message: { role: "assistant", content: "ssn 123-45-6789" } }];
    },
  };

  const post = await guardrail.postCall(resPayload, ctx);
  assert.deepEqual(post, { block: false });
  assert.equal(
    resReads,
    0,
    "postCall must not clone or stringify response when PII_RESPONSE_SANITIZATION is off"
  );
});

test("PIIMaskerGuardrail still masks request and response when flags are enabled", async () => {
  clearAllFeatureFlagOverrides();
  process.env.PII_REDACTION_ENABLED = "true";
  process.env.PII_RESPONSE_SANITIZATION = "true";
  try {
    const guardrail = new PIIMaskerGuardrail();
    const ctx = {} as GuardrailContext;

    const pre = await guardrail.preCall(
      { messages: [{ role: "user", content: "my ssn is 123-45-6789" }] },
      ctx
    );
    assert.equal(pre.block, false);
    const modifiedReq = pre.modifiedPayload as { messages: Array<{ content: string }> };
    assert.ok(modifiedReq);
    assert.ok(!modifiedReq.messages[0].content.includes("123-45-6789"));

    const post = await guardrail.postCall(
      { choices: [{ message: { role: "assistant", content: "ssn 123-45-6789" } }] },
      ctx
    );
    assert.equal(post.block, false);
    const modifiedRes = post.modifiedResponse as {
      choices: Array<{ message: { content: string } }>;
    };
    assert.ok(modifiedRes);
    assert.ok(!modifiedRes.choices[0].message.content.includes("123-45-6789"));
  } finally {
    delete process.env.PII_REDACTION_ENABLED;
    delete process.env.PII_RESPONSE_SANITIZATION;
  }
});

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "omniroute-deepseek-foreign-"));
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "deepseek-foreign-test-secret";

const { translateRequest } = await import("../../open-sse/translator/index.ts");
const { FORMATS } = await import("../../open-sse/translator/formats.ts");
const { clearReasoningCacheAll } = await import("../../open-sse/services/reasoningCache.ts");
const { NON_ANTHROPIC_THINKING_PLACEHOLDER, hasForeignToolCallsRequiringReasoning } =
  await import("../../open-sse/utils/reasoningPlaceholder.ts");

// A combo mixing OpenCode and native DeepSeek: OpenCode serves step N (tool call
// ids like `call_<24 hex>`, no reasoning), native DeepSeek serves step N+1 and
// 400s with "The reasoning_content in the thinking mode must be passed back to
// the API" unless the foreign tool-call turn carries reasoning_content.
const FOREIGN_ID = "call_528d4b5ed91d4c97ad41bd8e";
const DEEPSEEK_ID = "call_00_ET_ErsdyyvbvPwWW5q1ThOw1169";

type OutMessage = Record<string, unknown>;

function translate(provider: string, model: string, assistant: OutMessage, callId: string) {
  const translated = translateRequest(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    model,
    {
      messages: [
        { role: "user", content: "use a tool" },
        {
          content: null,
          tool_calls: [
            { id: callId, type: "function", function: { name: "read_file", arguments: "{}" } },
          ],
          ...assistant,
          role: "assistant",
        },
        { role: "tool", tool_call_id: callId, content: "tool result" },
      ],
    },
    false,
    null,
    provider
  ) as { messages: OutMessage[] };
  return translated.messages.find((m) => m.role === "assistant") as OutMessage;
}

describe("DeepSeek: reasoning_content presence for foreign tool calls", () => {
  before(() => clearReasoningCacheAll());
  after(() => clearReasoningCacheAll());

  it("adds the placeholder when the tool call id was not issued by DeepSeek", () => {
    clearReasoningCacheAll();
    const assistant = translate("deepseek", "deepseek-v4-flash", {}, FOREIGN_ID);
    assert.equal(assistant.reasoning_content, NON_ANTHROPIC_THINKING_PLACEHOLDER);
  });

  it("leaves DeepSeek-issued tool call turns without reasoning_content", () => {
    clearReasoningCacheAll();
    const assistant = translate("deepseek", "deepseek-v4-flash", {}, DEEPSEEK_ID);
    assert.equal("reasoning_content" in assistant, false);
  });

  it("keeps real reasoning on a foreign tool call turn", () => {
    clearReasoningCacheAll();
    const assistant = translate(
      "deepseek",
      "deepseek-v4-flash",
      { reasoning_content: "real prior reasoning" },
      FOREIGN_ID
    );
    assert.equal(assistant.reasoning_content, "real prior reasoning");
  });

  it("does not change behavior for other providers", () => {
    clearReasoningCacheAll();
    const assistant = translate("openai", "gpt-4o", {}, FOREIGN_ID);
    assert.notEqual(assistant.reasoning_content, NON_ANTHROPIC_THINKING_PLACEHOLDER);
    assert.equal(Boolean(assistant.reasoning_content), false);
  });

  it("predicate: mixed ids and malformed ids count as foreign", () => {
    const call = (id: unknown) => ({ id, type: "function", function: { name: "f" } });
    assert.equal(hasForeignToolCallsRequiringReasoning("deepseek", [call(DEEPSEEK_ID)]), false);
    assert.equal(
      hasForeignToolCallsRequiringReasoning("deepseek", [call(DEEPSEEK_ID), call(FOREIGN_ID)]),
      true
    );
    assert.equal(hasForeignToolCallsRequiringReasoning("deepseek", [call(undefined)]), true);
    assert.equal(hasForeignToolCallsRequiringReasoning("deepseek", [call(42)]), true);
    assert.equal(hasForeignToolCallsRequiringReasoning("DeepSeek", [call(FOREIGN_ID)]), true);
    assert.equal(hasForeignToolCallsRequiringReasoning("openai", [call(FOREIGN_ID)]), false);
    assert.equal(hasForeignToolCallsRequiringReasoning("deepseek", []), false);
    assert.equal(hasForeignToolCallsRequiringReasoning("deepseek", undefined), false);
  });
});

/**
 * Fork-owned identity rules for Antigravity (see .fork/notes/open-sse/executors/antigravity.ts.md).
 * Antigravity answers a systemInstruction that carries a competing-agent identity sentence with a
 * false 429 RESOURCE_EXHAUSTED; zero-width obfuscation (U+200B, U+034F) no longer helps, so the
 * sentence is removed. Covers the Codex CLI banner, the DeepSeek Harness (DSH) banner, and the
 * Gemini 4 / other chat models that previously skipped the normalization.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AntigravityExecutor,
  normalizeAntigravitySystemInstruction,
} from "../../open-sse/executors/antigravity.ts";

type Parts = { parts: Array<{ text: string }> };

function strip(text: string): string {
  return (normalizeAntigravitySystemInstruction({ parts: [{ text }] }) as Parts).parts[0].text;
}

test("strips the Codex CLI 0.169 banner and keeps the rest of the line", () => {
  assert.equal(
    strip("You are Codex, a coding agent based on GPT-5. You and the user share a workspace."),
    "You and the user share a workspace."
  );
});

test("strips older and versioned Codex banners", () => {
  assert.equal(strip("You are Codex, an agent based on GPT-5.\nBe brief."), "Be brief.");
  assert.equal(strip("You are Codex, based on GPT-5.1-codex. Be brief."), "Be brief.");
});

test("strips the DeepSeek Harness banner and keeps the rest of the line", () => {
  assert.equal(
    strip("You are an AI agent powered by DeepSeek Harness. Follow the plan."),
    "Follow the plan."
  );
  assert.equal(strip("You are an AI agent powered by DeepSeek Harness.\nGo."), "Go.");
});

test("keeps unrelated mentions of Codex or DeepSeek", () => {
  const input = { parts: [{ text: "Run the codex CLI, then ask DeepSeek Harness docs." }] };
  assert.strictEqual(normalizeAntigravitySystemInstruction(input), input);
});

async function transform(model: string, text: string) {
  const executor = new AntigravityExecutor();
  const result = await executor.transformRequest(
    model,
    {
      request: {
        systemInstruction: { role: "user", parts: [{ text }] },
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generationConfig: {},
      },
    },
    true,
    { projectId: "project-1" }
  );
  if (result instanceof Response) throw new Error("Unexpected Response from transformRequest");
  return result as unknown as { request: { systemInstruction?: Parts } };
}

for (const model of ["gemini-4-argon-high", "gemini-4-hydrogen-xhigh", "gpt-oss-120b-medium"]) {
  test(`${model}: identity banners are stripped from systemInstruction`, async () => {
    const envelope = await transform(
      model,
      "You are Codex, a coding agent based on GPT-5.\nYou are an AI agent powered by DeepSeek Harness.\nRules."
    );
    assert.equal(envelope.request.systemInstruction?.parts[0].text, "Rules.");
  });
}

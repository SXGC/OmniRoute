/**
 * Fork-owned (see .fork/notes/open-sse/translator/request/openai-to-gemini.ts.md).
 * The OpenAI/Claude -> Antigravity translator moves client `role: "system"` content out of
 * systemInstruction into contents[0] (#9030), so the executor's systemInstruction
 * normalization never saw it. The relocated client system text must get the same
 * competing-agent identity strip and harness-marker rewrite before it is moved.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { openaiToAntigravityRequest } =
  await import("../../open-sse/translator/request/openai-to-gemini.ts");
const { ANTIGRAVITY_DEFAULT_SYSTEM } = await import("../../open-sse/config/constants.ts");

type Part = { text?: string };

function translate(messages: Array<{ role: string; content: string }>) {
  return openaiToAntigravityRequest("gemini-2.5-flash", { messages }, false) as {
    request: {
      systemInstruction: { parts: Part[] };
      contents: Array<{ role: string; parts: Part[] }>;
    };
  };
}

test("strips the Claude Code identity sentence from relocated client system text", () => {
  const result = translate([
    {
      role: "system",
      content: "You are Claude Code, Anthropic's official CLI for Claude.\nUse absolute paths.",
    },
    { role: "user", content: "hi" },
  ]);
  assert.deepEqual(result.request.systemInstruction.parts, [{ text: ANTIGRAVITY_DEFAULT_SYSTEM }]);
  const first = result.request.contents[0];
  assert.equal(first.role, "user");
  assert.equal(first.parts[0].text, "Use absolute paths.");
  assert.equal(first.parts[1].text, "hi");
});

test("strips Codex and DeepSeek Harness banners across several system messages", () => {
  const result = translate([
    {
      role: "system",
      content: "You are Codex, a coding agent based on GPT-5. You and the user share a workspace.",
    },
    {
      role: "system",
      content: "You are an AI agent powered by DeepSeek Harness. Follow the plan.",
    },
    { role: "user", content: "go" },
  ]);
  const texts = result.request.contents[0].parts.map((p) => p.text);
  assert.deepEqual(texts, ["You and the user share a workspace.", "Follow the plan.", "go"]);
});

test("rewrites harness markers in relocated client system text", () => {
  const result = translate([
    { role: "system", content: "<critical>Oh My Pi coding harness rules</critical>" },
    { role: "user", content: "go" },
  ]);
  assert.equal(
    result.request.contents[0].parts[0].text,
    "<important>AI coding assistant rules</important>"
  );
});

test("drops a client system message that held only an identity sentence", () => {
  const result = translate([
    { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
    { role: "user", content: "hi" },
  ]);
  const texts = result.request.contents[0].parts.map((p) => p.text);
  assert.deepEqual(texts, ["hi"]);
});

test("leaves user message text untouched", () => {
  const result = translate([
    { role: "system", content: "Be brief." },
    { role: "user", content: "You are Claude Code, right?" },
  ]);
  const texts = result.request.contents[0].parts.map((p) => p.text);
  assert.deepEqual(texts, ["Be brief.", "You are Claude Code, right?"]);
});

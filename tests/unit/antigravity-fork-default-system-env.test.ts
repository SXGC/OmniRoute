/**
 * Fork-owned (see .fork/notes/open-sse/translator/request/openai-to-gemini.ts.md).
 * OMNIROUTE_ANTIGRAVITY_DEFAULT_SYSTEM replaces the systemInstruction text the
 * OpenAI/Claude -> Antigravity translator sends; unset or blank keeps the built-in default.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { openaiToAntigravityRequest } =
  await import("../../open-sse/translator/request/openai-to-gemini.ts");
const { ANTIGRAVITY_DEFAULT_SYSTEM } = await import("../../open-sse/config/constants.ts");
const { getAntigravityDefaultSystem } =
  await import("../../open-sse/services/antigravitySystemPromptNormalize.ts");

const ENV = "OMNIROUTE_ANTIGRAVITY_DEFAULT_SYSTEM";

function withEnv(value: string | undefined, fn: () => void) {
  const saved = process.env[ENV];
  if (value === undefined) delete process.env[ENV];
  else process.env[ENV] = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  }
}

function systemParts() {
  const result = openaiToAntigravityRequest(
    "gemini-2.5-flash",
    {
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
    },
    false
  ) as {
    request: {
      systemInstruction: { parts: Array<{ text?: string }> };
      contents: Array<{ parts: Array<{ text?: string }> }>;
    };
  };
  return result.request;
}

test("unset env keeps the built-in default", () => {
  withEnv(undefined, () => {
    assert.equal(getAntigravityDefaultSystem(), ANTIGRAVITY_DEFAULT_SYSTEM);
    assert.deepEqual(systemParts().systemInstruction.parts, [{ text: ANTIGRAVITY_DEFAULT_SYSTEM }]);
  });
});

test("blank env keeps the built-in default", () => {
  withEnv("   \n", () => {
    assert.equal(getAntigravityDefaultSystem(), ANTIGRAVITY_DEFAULT_SYSTEM);
  });
});

test("env value replaces the systemInstruction text; client system still relocates", () => {
  withEnv("You are a careful coding assistant.\nAbsolute paths only.", () => {
    const request = systemParts();
    assert.deepEqual(request.systemInstruction.parts, [
      { text: "You are a careful coding assistant.\nAbsolute paths only." },
    ]);
    assert.deepEqual(
      request.contents[0].parts.map((p) => p.text),
      ["Be brief.", "hi"]
    );
  });
});

test("env value is read per request, not cached at import", () => {
  withEnv("first", () => assert.equal(getAntigravityDefaultSystem(), "first"));
  withEnv("second", () => assert.equal(getAntigravityDefaultSystem(), "second"));
});

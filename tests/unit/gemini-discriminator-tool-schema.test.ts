import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanJSONSchemaForAntigravity,
  GEMINI_UNSUPPORTED_SCHEMA_KEYS,
} from "../../open-sse/translator/helpers/geminiHelper.ts";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.ts";

const schema = {
  type: "object",
  discriminator: { propertyName: "kind" },
  properties: {
    value: {
      type: "object",
      discriminator: { propertyName: "kind" },
      properties: { kind: { type: "string" } },
      required: ["kind"],
    },
    entries: {
      type: "array",
      items: {
        type: "object",
        discriminator: { propertyName: "kind" },
        properties: { kind: { type: "string" } },
      },
    },
    discriminator: { type: "string" },
  },
  required: ["value", "discriminator"],
};

const expected = {
  type: "object",
  properties: {
    value: {
      type: "object",
      properties: { kind: { type: "string" } },
      required: ["kind"],
    },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string" } },
      },
    },
    discriminator: { type: "string" },
  },
  required: ["value", "discriminator"],
};

test("discriminator is an unsupported Gemini schema keyword", () => {
  assert.ok(GEMINI_UNSUPPORTED_SCHEMA_KEYS.has("discriminator"));
});

test("schema cleaning removes discriminator metadata recursively but preserves named properties", () => {
  const original = structuredClone(schema);
  assert.deepEqual(cleanJSONSchemaForAntigravity(schema), expected);
  assert.deepEqual(schema, original);
});

test("OpenAI -> Antigravity strips discriminator from the fourteenth tool parameters", () => {
  const request = openaiToAntigravityRequest(
    "gemini-2.5-flash",
    {
      messages: [{ role: "user", content: "Use a tool" }],
      tools: Array.from({ length: 14 }, (_, index) => ({
        type: "function",
        function: {
          name: `tool_${index}`,
          description: "Example tool",
          parameters: index === 13 ? schema : { type: "object", properties: {} },
        },
      })),
    },
    false,
    { projectId: "test-project" }
  );

  const declarations = request.request.tools?.[0].functionDeclarations;
  assert.equal(declarations?.length, 14);
  assert.equal(declarations?.[13].name, "tool_13");
  assert.deepEqual(declarations?.[13].parameters, expected);
});

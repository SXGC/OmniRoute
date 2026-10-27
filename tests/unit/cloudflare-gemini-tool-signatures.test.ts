import test from "node:test";
import assert from "node:assert/strict";

import {
  patchCloudflareGeminiToolSignatures,
  type JsonRecord,
} from "../../open-sse/executors/cloudflareGeminiToolSignatures.ts";

const TARGET = "google/gemini-4-argon";
const SKIP = "skip_thought_signature_validator";

function validCall(overrides: JsonRecord = {}): JsonRecord {
  return {
    id: "call_1",
    type: "function",
    function: { name: "get_weather", arguments: '{"city":"Paris"}' },
    ...overrides,
  };
}

function assistantMessage(toolCalls: unknown[]): JsonRecord {
  return { role: "assistant", content: "", tool_calls: toolCalls };
}

function signatureOf(call: unknown): unknown {
  const c = call as JsonRecord;
  const ec = c.extra_content;
  if (typeof ec !== "object" || ec === null || Array.isArray(ec)) return undefined;
  const google = (ec as JsonRecord).google;
  if (typeof google !== "object" || google === null || Array.isArray(google)) return undefined;
  return (google as JsonRecord).thought_signature;
}

function callsOf(body: JsonRecord, messageIndex: number): JsonRecord[] {
  const messages = body.messages as JsonRecord[];
  return messages[messageIndex].tool_calls as JsonRecord[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) deepFreeze(record[key]);
    Object.freeze(value);
  }
  return value;
}

test("D1: non-empty thought signatures are preserved as-is", () => {
  const call = validCall({
    id: "call_sig",
    extra_content: { google: { thought_signature: "  real-sig  " } },
  });
  const body = { messages: [assistantMessage([call])] };
  const out = patchCloudflareGeminiToolSignatures(TARGET, body);
  assert.equal(out, body);
  assert.equal(signatureOf(callsOf(body, 0)[0]), "  real-sig  ");
});

test("D2: missing, null or empty signatures gain the skip validator marker", () => {
  const forms: JsonRecord[] = [
    validCall(),
    validCall({ extra_content: null }),
    validCall({ extra_content: {} }),
    validCall({ extra_content: { google: null } }),
    validCall({ extra_content: { google: {} } }),
    validCall({ extra_content: { google: { thought_signature: null } } }),
    validCall({ extra_content: { google: { thought_signature: "" } } }),
  ];
  const body = { messages: forms.map((toolCall) => assistantMessage([toolCall])) };
  const out = patchCloudflareGeminiToolSignatures(TARGET, body);
  const messages = out.messages as JsonRecord[];
  for (const [index, message] of messages.entries()) {
    const calls = message.tool_calls as unknown[];
    assert.equal(signatureOf(calls[0]), SKIP, `form ${index}`);
  }
});

test("D3: unrelated metadata survives the signature fill", () => {
  const call = validCall({
    extra_content: {
      google: { thought_signature: "", keep: "kept", count: 7 },
      other: { x: 1 },
    },
    index: 3,
  });
  const body = { messages: [assistantMessage([call])] };
  const out = patchCloudflareGeminiToolSignatures(TARGET, body);
  const patched = callsOf(out, 0)[0];
  const extraContent = patched.extra_content as JsonRecord;
  const google = extraContent.google as JsonRecord;
  assert.equal(google.thought_signature, SKIP);
  assert.equal(google.keep, "kept");
  assert.equal(google.count, 7);
  assert.deepEqual(extraContent.other, { x: 1 });
  assert.equal(patched.index, 3);
  assert.equal(patched.id, "call_1");
  assert.deepEqual(patched.function, {
    name: "get_weather",
    arguments: '{"city":"Paris"}',
  });
});

test("D4: malformed metadata containers and signatures are left untouched", () => {
  const malformed: JsonRecord[] = [
    validCall({ extra_content: "scalar" }),
    validCall({ extra_content: 7 }),
    validCall({ extra_content: [] }),
    validCall({ extra_content: { google: "scalar" } }),
    validCall({ extra_content: { google: [1, 2] } }),
    validCall({ extra_content: { google: { thought_signature: 42 } } }),
    validCall({ extra_content: { google: { thought_signature: false } } }),
    validCall({ extra_content: { google: { thought_signature: { nested: true } } } }),
    validCall({ extra_content: { google: { thought_signature: ["x"] } } }),
  ];
  const body = { messages: malformed.map((toolCall) => assistantMessage([toolCall])) };
  const out = patchCloudflareGeminiToolSignatures(TARGET, body);
  assert.equal(out, body);
  assert.equal(JSON.stringify(body).includes(SKIP), false);
});

test("D5: non-assistant messages and non-function calls gain no signature", () => {
  const messages: unknown[] = [
    { role: "user", content: "hi", tool_calls: [validCall()] },
    { role: "tool", tool_call_id: "call_1", content: "sunny", tool_calls: [validCall()] },
    { role: "system", content: "sys", tool_calls: [validCall()] },
    { role: "assistant", content: "", tool_calls: "not-an-array" },
    { role: "assistant", content: "", tool_calls: [validCall({ type: "custom" })] },
    { role: "assistant", content: "", tool_calls: [{ type: "function" }] },
    { role: "assistant", content: "", tool_calls: [validCall({ id: "" })] },
    { role: "assistant", content: "", tool_calls: [validCall({ id: 7 })] },
    { role: "assistant", content: "", tool_calls: [validCall({ function: "nope" })] },
    {
      role: "assistant",
      content: "",
      tool_calls: [validCall({ function: { name: "", arguments: "{}" } })],
    },
    {
      role: "assistant",
      content: "",
      tool_calls: [validCall({ function: { name: "get_weather", arguments: 5 } })],
    },
    { role: "assistant", content: "", tool_calls: ["not-an-object", null] },
    "not-a-message",
    null,
  ];
  const body = { messages };
  const out = patchCloudflareGeminiToolSignatures(TARGET, body);
  assert.equal(out, body);
  assert.equal(JSON.stringify(body).includes(SKIP), false);
});

test("D6: frozen input is not mutated and repeated patching is idempotent", () => {
  const body = deepFreeze({
    model: TARGET,
    messages: [assistantMessage([validCall()])],
  });
  const before = JSON.stringify(body);
  const out = patchCloudflareGeminiToolSignatures(TARGET, body);
  assert.notEqual(out, body);
  assert.equal(JSON.stringify(body), before);
  assert.equal(signatureOf(callsOf(body, 0)[0]), undefined);
  assert.equal(signatureOf(callsOf(out, 0)[0]), SKIP);
  const twice = patchCloudflareGeminiToolSignatures(TARGET, out);
  assert.equal(JSON.stringify(twice), JSON.stringify(out));
});

test("D7: parallel calls keep real signatures in place and patch only missing ones", () => {
  const calls: JsonRecord[] = [
    validCall({ id: "call_a", extra_content: { google: { thought_signature: "real-a" } } }),
    validCall({ id: "call_b" }),
    validCall({ id: "call_c", extra_content: { google: { thought_signature: "" } } }),
    validCall({ id: "call_d", extra_content: { google: { thought_signature: 9 } } }),
  ];
  const body = { messages: [assistantMessage(calls)] };
  const out = patchCloudflareGeminiToolSignatures(TARGET, body);
  const patched = callsOf(out, 0);
  assert.deepEqual(
    patched.map((c) => c.id),
    ["call_a", "call_b", "call_c", "call_d"]
  );
  assert.equal(signatureOf(patched[0]), "real-a");
  assert.equal(signatureOf(patched[1]), SKIP);
  assert.equal(signatureOf(patched[2]), SKIP);
  assert.equal(signatureOf(patched[3]), 9);
  assert.equal(patched[0], calls[0]);
  assert.equal(patched[3], calls[3]);
  for (const call of patched) {
    assert.deepEqual(call.function, { name: "get_weather", arguments: '{"city":"Paris"}' });
  }
});

test("D11: only the exact routed model triggers patching", () => {
  const body = { messages: [assistantMessage([validCall()])] };
  const nonTargets = [
    "google/gemini-4-argon ",
    " google/gemini-4-argon",
    "GOOGLE/GEMINI-4-ARGON",
    "google/gemini-4-argon-preview",
    "google/gemini-3-argon",
    "gemini-4-argon",
    "@cf/google/gemini-4-argon",
  ];
  for (const model of nonTargets) {
    assert.equal(patchCloudflareGeminiToolSignatures(model, body), body, model);
  }
});

test("D11: body.model does not influence the routing decision", () => {
  const routedHit = { model: "unrelated", messages: [assistantMessage([validCall()])] };
  const out1 = patchCloudflareGeminiToolSignatures(TARGET, routedHit);
  assert.notEqual(out1, routedHit);
  assert.equal(signatureOf(callsOf(out1, 0)[0]), SKIP);

  const bodyOnly = { model: TARGET, messages: [assistantMessage([validCall()])] };
  const out2 = patchCloudflareGeminiToolSignatures("unrelated", bodyOnly);
  assert.equal(out2, bodyOnly);
});

test("only messages with patched calls are copied", () => {
  const untouchedUser = { role: "user", content: "hi" };
  const untouchedAssistant = assistantMessage([
    validCall({ extra_content: { google: { thought_signature: "sig" } } }),
  ]);
  const target = assistantMessage([validCall()]);
  const body = { messages: [untouchedUser, target, untouchedAssistant] };
  const out = patchCloudflareGeminiToolSignatures(TARGET, body);
  const messages = out.messages as unknown[];
  assert.equal(messages[0], untouchedUser);
  assert.equal(messages[2], untouchedAssistant);
  assert.notEqual(messages[1], target);
});

test("non-array messages are returned unchanged", () => {
  const bodies: JsonRecord[] = [{}, { messages: "nope" }, { messages: null }];
  for (const body of bodies) {
    assert.equal(patchCloudflareGeminiToolSignatures(TARGET, body), body);
  }
});

test("outcome contract classifies patched and unchanged behavior", () => {
  const unsigned = (): JsonRecord => ({ messages: [assistantMessage([validCall()])] });
  const cases: Array<{ name: string; model: string; body: JsonRecord; expect: boolean }> = [
    {
      name: "outside model",
      model: "other-model",
      body: unsigned(),
      expect: false,
    },
    {
      name: "no candidate",
      model: TARGET,
      body: { messages: [{ role: "user", content: "hi" }] },
      expect: false,
    },
    {
      name: "malformed metadata",
      model: TARGET,
      body: { messages: [assistantMessage([validCall({ extra_content: [] })])] },
      expect: false,
    },
    {
      name: "missing signature",
      model: TARGET,
      body: unsigned(),
      expect: true,
    },
  ];
  for (const testCase of cases) {
    const out = patchCloudflareGeminiToolSignatures(testCase.model, testCase.body);
    if (testCase.expect) {
      assert.notEqual(out, testCase.body, testCase.name);
    } else {
      assert.equal(out, testCase.body, testCase.name);
    }
  }
});

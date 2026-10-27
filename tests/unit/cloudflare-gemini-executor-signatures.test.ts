import test from "node:test";
import assert from "node:assert/strict";

import { CloudflareAIExecutor } from "../../open-sse/executors/cloudflare-ai.ts";

const TARGET = "google/gemini-4-argon";
const SKIP = "skip_thought_signature_validator";
const CREDENTIALS = {
  apiKey: "cf-api-token",
  providerSpecificData: { accountId: "account-123" },
};

const USAGE = { prompt_tokens: 41, completion_tokens: 5, total_tokens: 46 };
const JSON_COMPLETION_BODY = JSON.stringify({
  id: "chatcmpl-cf",
  object: "chat.completion",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
  usage: USAGE,
});
const SSE_COMPLETION_BODY = `data: ${JSON.stringify({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: USAGE,
})}\n\ndata: [DONE]\n\n`;
const UPSTREAM_400_BODY = JSON.stringify({
  errors: [{ message: "Model execution failed (User Input Error)" }],
  success: false,
});
const SSE_ERROR_BODY = `data: ${JSON.stringify({
  error: { message: "upstream error", code: 400 },
})}\n\ndata: [DONE]\n\n`;

function unsignedCall(id: string): Record<string, unknown> {
  return {
    id,
    type: "function",
    function: { name: "get_weather", arguments: '{"city":"Paris"}' },
  };
}

function signedCall(id: string, signature: string): Record<string, unknown> {
  return {
    ...unsignedCall(id),
    extra_content: { google: { thought_signature: signature } },
  };
}

function signatureOf(call: unknown): unknown {
  const c = call as Record<string, unknown>;
  const ec = c.extra_content;
  if (typeof ec !== "object" || ec === null || Array.isArray(ec)) return undefined;
  const google = (ec as Record<string, unknown>).google;
  if (typeof google !== "object" || google === null || Array.isArray(google)) return undefined;
  return (google as Record<string, unknown>).thought_signature;
}

function toolHistoryBody(): Record<string, unknown> {
  return {
    model: TARGET,
    messages: [
      { role: "user", content: "What is the weather in Paris?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [unsignedCall("call_unsigned"), signedCall("call_signed", "real-sig")],
      },
      { role: "tool", tool_call_id: "call_unsigned", content: '{"temp":18}' },
      { role: "tool", tool_call_id: "call_signed", content: '{"temp":19}' },
    ],
    tools: [
      { type: "function", function: { name: "get_weather", parameters: { type: "object" } } },
    ],
  };
}

function jsonCompletion(): Response {
  return new Response(JSON_COMPLETION_BODY, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sseCompletion(): Response {
  return new Response(SSE_COMPLETION_BODY, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function upstream400(): Response {
  return new Response(UPSTREAM_400_BODY, {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function sseError(): Response {
  return new Response(SSE_ERROR_BODY, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

type FetchCall = { url: string; options: RequestInit };

async function withFetchStub<T>(
  respond: () => Response,
  run: (calls: FetchCall[]) => Promise<T>
): Promise<{ result: T; calls: FetchCall[] }> {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, options?: RequestInit) => {
    calls.push({ url: String(url), options: options ?? {} });
    return respond();
  }) as typeof fetch;
  try {
    const result = await run(calls);
    return { result, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function sentBody(calls: FetchCall[]): Record<string, unknown> {
  assert.equal(calls.length, 1);
  return JSON.parse(String(calls[0].options.body));
}

function sentToolCalls(sent: Record<string, unknown>): Record<string, unknown>[] {
  const messages = sent.messages as Record<string, unknown>[];
  return messages[1].tool_calls as Record<string, unknown>[];
}

test("R1/R3: execute() fills missing signatures on the exact model with no extra configuration", async () => {
  const executor = new CloudflareAIExecutor();
  const body = toolHistoryBody();
  const before = JSON.stringify(body);

  const { result, calls } = await withFetchStub(jsonCompletion, () =>
    executor.execute({ model: TARGET, body, stream: false, credentials: CREDENTIALS })
  );

  assert.equal(result.response.status, 200);
  const toolCalls = sentToolCalls(sentBody(calls));
  assert.equal(signatureOf(toolCalls[0]), SKIP);
  assert.equal(signatureOf(toolCalls[1]), "real-sig");
  assert.equal(JSON.stringify(body), before);
  assert.equal(
    calls[0].url,
    "https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1/chat/completions"
  );
  assert.equal(
    (calls[0].options.headers as Record<string, string>).Authorization,
    "Bearer cf-api-token"
  );
});

test("R2: execute() leaves other models' requests without the marker", async () => {
  const executor = new CloudflareAIExecutor();
  const body = toolHistoryBody();
  const before = JSON.stringify(body);

  const { result, calls } = await withFetchStub(jsonCompletion, () =>
    executor.execute({
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      body,
      stream: false,
      credentials: CREDENTIALS,
    })
  );

  assert.equal(result.response.status, 200);
  const toolCalls = sentToolCalls(sentBody(calls));
  assert.equal(signatureOf(toolCalls[0]), undefined);
  assert.equal(signatureOf(toolCalls[1]), "real-sig");
  assert.equal(JSON.stringify(body), before);
});

test("D8: streaming and non-streaming requests share the same signature rule", async () => {
  const executor = new CloudflareAIExecutor();

  const json = await withFetchStub(jsonCompletion, () =>
    executor.execute({
      model: TARGET,
      body: toolHistoryBody(),
      stream: false,
      credentials: CREDENTIALS,
    })
  );
  const streamed = await withFetchStub(sseCompletion, () =>
    executor.execute({
      model: TARGET,
      body: toolHistoryBody(),
      stream: true,
      credentials: CREDENTIALS,
    })
  );

  assert.equal(json.result.response.status, 200);
  assert.equal(streamed.result.response.status, 200);
  const jsonCalls = sentToolCalls(sentBody(json.calls));
  const streamCalls = sentToolCalls(sentBody(streamed.calls));
  assert.equal(signatureOf(jsonCalls[0]), SKIP);
  assert.equal(signatureOf(streamCalls[0]), SKIP);
  assert.equal(
    (streamed.calls[0].options.headers as Record<string, string>).Accept,
    "text/event-stream"
  );
  assert.equal(sentBody(streamed.calls).stream, undefined);
});

test("D8: execute() returns the upstream JSON response object with usage and byte-exact body", async () => {
  const executor = new CloudflareAIExecutor();
  const body = { ...toolHistoryBody(), stream_options: { include_usage: true } };
  const before = JSON.stringify(body);
  const response = jsonCompletion();

  const { result, calls } = await withFetchStub(
    () => response,
    () => executor.execute({ model: TARGET, body, stream: false, credentials: CREDENTIALS })
  );

  assert.equal(result.response, response);
  assert.equal(result.response.status, 200);
  assert.equal(await result.response.text(), JSON_COMPLETION_BODY);
  assert.deepEqual(JSON.parse(JSON_COMPLETION_BODY).usage, USAGE);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(body), before);
  const sent = sentBody(calls);
  assert.deepEqual(sent.stream_options, { include_usage: true });
});

test("D8: execute() returns the upstream SSE stream with usage and terminal frames intact", async () => {
  const executor = new CloudflareAIExecutor();
  const response = sseCompletion();

  const { result, calls } = await withFetchStub(
    () => response,
    () =>
      executor.execute({
        model: TARGET,
        body: toolHistoryBody(),
        stream: true,
        credentials: CREDENTIALS,
      })
  );

  assert.equal(result.response, response);
  assert.equal(await result.response.text(), SSE_COMPLETION_BODY);
  assert.ok(SSE_COMPLETION_BODY.includes('"finish_reason":"stop"'));
  assert.ok(SSE_COMPLETION_BODY.includes("data: [DONE]"));
  assert.ok(SSE_COMPLETION_BODY.includes(JSON.stringify(USAGE)));
  assert.equal(calls.length, 1);
});

test("D8: upstream error responses reach the caller byte-exact over JSON and SSE", async () => {
  const executor = new CloudflareAIExecutor();

  const json = await withFetchStub(upstream400, () =>
    executor.execute({
      model: TARGET,
      body: toolHistoryBody(),
      stream: false,
      credentials: CREDENTIALS,
    })
  );
  assert.equal(json.result.response.status, 400);
  assert.equal(await json.result.response.text(), UPSTREAM_400_BODY);
  assert.equal(json.calls.length, 1);

  const sse = await withFetchStub(sseError, () =>
    executor.execute({
      model: TARGET,
      body: toolHistoryBody(),
      stream: true,
      credentials: CREDENTIALS,
    })
  );
  assert.equal(sse.result.response.status, 200);
  assert.equal(await sse.result.response.text(), SSE_ERROR_BODY);
  assert.equal(sse.calls.length, 1);
});

test("D10: existing content normalization still applies to the target model", async () => {
  const executor = new CloudflareAIExecutor();
  const body = {
    model: TARGET,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
      },
      { role: "assistant", content: null, tool_calls: [unsignedCall("call_unsigned")] },
      { role: "tool", tool_call_id: "call_unsigned", content: '{"temp":18}' },
    ],
  };

  const { result, calls } = await withFetchStub(jsonCompletion, () =>
    executor.execute({ model: TARGET, body, stream: false, credentials: CREDENTIALS })
  );

  assert.equal(result.response.status, 200);
  const sent = sentBody(calls);
  const messages = sent.messages as Record<string, unknown>[];
  assert.equal(messages[0].content, "hello world");
  assert.equal(messages[1].content, "");
  assert.equal(signatureOf((messages[1].tool_calls as Record<string, unknown>[])[0]), SKIP);
});

test("D11: the routed model parameter alone decides patching inside the executor", async () => {
  const executor = new CloudflareAIExecutor();
  const body = { ...toolHistoryBody(), model: "some-other-model" };

  const { result, calls } = await withFetchStub(jsonCompletion, () =>
    executor.execute({ model: TARGET, body, stream: false, credentials: CREDENTIALS })
  );
  assert.equal(result.response.status, 200);
  assert.equal(signatureOf(sentToolCalls(sentBody(calls))[0]), SKIP);
});

test("D12: an upstream 400 is returned after exactly one dispatch with no signature retry", async () => {
  const executor = new CloudflareAIExecutor();
  const body = toolHistoryBody();

  const { result, calls } = await withFetchStub(upstream400, () =>
    executor.execute({ model: TARGET, body, stream: false, credentials: CREDENTIALS })
  );

  assert.equal(result.response.status, 400);
  assert.equal(calls.length, 1);
  assert.equal(signatureOf(sentToolCalls(sentBody(calls))[0]), SKIP);
});

test("R2: transformRequest adds no signature marker for other models", () => {
  const executor = new CloudflareAIExecutor();
  const body = toolHistoryBody();
  const out = executor.transformRequest(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    body,
    false,
    null
  );
  assert.equal(JSON.stringify(out).includes(SKIP), false);
  assert.equal(JSON.stringify(body).includes(SKIP), false);
  const calls = (out.messages as Record<string, unknown>[])[1].tool_calls as Record<
    string,
    unknown
  >[];
  assert.equal(signatureOf(calls[0]), undefined);
});

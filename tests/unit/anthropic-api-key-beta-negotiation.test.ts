/**
 * Regression coverage for the `anthropic` API-key provider's beta negotiation
 * contract (fix/anthropic-api-key-beta-negotiation):
 *
 * 1. Default wire shape: no static anthropic-beta header, no `?beta=true` URL
 *    suffix, x-api-key auth, Anthropic-Version, JSON content-type.
 * 2. Client allowlist negotiation: allowlisted client betas are forwarded from
 *    an empty seed (executor path), deduped against nothing, and rejected
 *    tokens never travel.
 * 3. Model/body gates survive the new default: context-1m is dropped for a
 *    non-qualifying model, skills beta is dropped on tool-less bodies.
 * 4. A client sending only rejected betas (or none) gets NO anthropic-beta
 *    header at all — the merge must not mint an empty one.
 * 5. cache_control in the body is preserved untouched.
 * 6. Baselines stay intact: the `claude` OAuth provider keeps its static beta
 *    set and `?beta=true` suffix; ANTHROPIC_BETA_FULL / CLAUDE_OAUTH /
 *    FORWARDABLE_CLIENT_BETAS keep their existing contents.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-apkey-beta-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const {
  ANTHROPIC_BETA_FULL,
  ANTHROPIC_BETA_API_KEY,
  ANTHROPIC_BETA_CLAUDE_OAUTH,
  FORWARDABLE_CLIENT_BETAS,
  mergeClientAnthropicBeta,
  applyClientAnthropicBeta,
} = await import("../../open-sse/config/anthropicHeaders.ts");
const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");
const { buildProviderUrl } = await import("../../open-sse/services/provider.ts");
const core = await import("../../src/lib/db/core.ts");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.ts");

const PLAIN_BODY = { messages: [{ role: "user", content: "hi" }] };

function betaTokens(headers: Record<string, string>): string[] {
  const beta = headers["Anthropic-Beta"] ?? headers["anthropic-beta"] ?? "";
  return beta
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── 1. default wire shape ───────────────────────────────────────────────────

test("API-key default: no static anthropic-beta in executor headers", () => {
  const executor = new DefaultExecutor("anthropic");
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    null,
    "claude-sonnet-5",
    undefined,
    PLAIN_BODY
  );
  assert.equal(
    headers["Anthropic-Beta"] ?? headers["anthropic-beta"] ?? "",
    "",
    `no static beta must be sent by default: ${JSON.stringify(headers)}`
  );
});

test("API-key default: auth, version, content-type, no URL suffix", () => {
  const executor = new DefaultExecutor("anthropic");
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    null,
    "claude-sonnet-5",
    undefined,
    PLAIN_BODY
  );
  assert.equal(headers["x-api-key"], "sk-ant-test");
  assert.equal(headers["Authorization"], undefined);
  assert.equal(headers["Anthropic-Version"], "2023-06-01");
  assert.equal(
    (headers["Content-Type"] ?? headers["content-type"] ?? "").includes("application/json"),
    true
  );

  const url = executor.buildUrl("claude-sonnet-5", false, 0, { apiKey: "sk-ant-test" });
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(
    buildProviderUrl("anthropic", "claude-sonnet-5", false),
    "https://api.anthropic.com/v1/messages"
  );
});

// ── 2. client allowlist negotiation on the executor path ────────────────────

test("API-key negotiation: allowlisted client betas are forwarded from empty seed", () => {
  const executor = new DefaultExecutor("anthropic");
  const clientHeaders = {
    "anthropic-beta": [
      "claude-code-20250219", // rejected: not forwardable
      "code-execution-2025-08-25", // allowlisted
      "context-1m-2025-08-07", // allowlisted + model-gated (sonnet-5 qualifies)
    ].join(","),
  };
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    clientHeaders,
    "claude-sonnet-5",
    undefined,
    PLAIN_BODY
  );
  const tokens = betaTokens(headers);
  assert.ok(tokens.includes("code-execution-2025-08-25"), `code-execution dropped: ${tokens}`);
  assert.ok(tokens.includes("context-1m-2025-08-07"), `context-1m dropped: ${tokens}`);
  assert.ok(!tokens.includes("claude-code-20250219"), `rejected beta leaked: ${tokens}`);
  assert.equal(
    tokens.filter((t) => t.toLowerCase() === "code-execution-2025-08-25").length,
    1,
    `code-execution duplicated: ${tokens}`
  );
});

test("API-key negotiation: cased client header key is honored", () => {
  const executor = new DefaultExecutor("anthropic");
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    { "Anthropic-Beta": "code-execution-2025-08-25" },
    "claude-sonnet-5",
    undefined,
    PLAIN_BODY
  );
  assert.ok(betaTokens(headers).includes("code-execution-2025-08-25"));
});

// ── 3. model/body gates ─────────────────────────────────────────────────────

test("API-key negotiation: context-1m dropped for non-qualifying model", () => {
  const executor = new DefaultExecutor("anthropic");
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    { "anthropic-beta": "context-1m-2025-08-07" },
    "claude-haiku-4-5",
    undefined,
    PLAIN_BODY
  );
  const tokens = betaTokens(headers);
  assert.ok(!tokens.includes("context-1m-2025-08-07"), `context-1m leaked to Haiku: ${tokens}`);
});

test("API-key negotiation: skills beta dropped on tool-less body", () => {
  const executor = new DefaultExecutor("anthropic");
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    { "anthropic-beta": "skills-2025-10-02" },
    "claude-sonnet-5",
    undefined,
    PLAIN_BODY
  );
  const tokens = betaTokens(headers);
  assert.ok(
    !tokens.includes("skills-2025-10-02"),
    `skills beta leaked on tool-less body: ${tokens}`
  );
});

test("API-key negotiation: skills beta forwarded with code_execution tool", () => {
  const executor = new DefaultExecutor("anthropic");
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    { "anthropic-beta": "skills-2025-10-02" },
    "claude-sonnet-5",
    undefined,
    {
      messages: [{ role: "user", content: "run" }],
      tools: [{ type: "code_execution_20250825", name: "code_execution" }],
    }
  );
  const tokens = betaTokens(headers);
  assert.ok(
    tokens.includes("skills-2025-10-02"),
    `skills beta dropped with code_execution: ${tokens}`
  );
});

// ── 4. no empty header minting ──────────────────────────────────────────────

test("API-key negotiation: rejected-only client betas produce no header", () => {
  const executor = new DefaultExecutor("anthropic");
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    { "anthropic-beta": "claude-code-20250219,oauth-2025-04-20" },
    "claude-sonnet-5",
    undefined,
    PLAIN_BODY
  );
  assert.equal(
    headers["Anthropic-Beta"] ?? headers["anthropic-beta"] ?? "",
    "",
    `rejected-only merge must not mint an empty header: ${JSON.stringify(headers)}`
  );
});

test("API-key negotiation: empty client beta string leaves headers unset", () => {
  const headers = {} as Record<string, string>;
  applyClientAnthropicBeta(headers, "", { seedWhenAbsent: true });
  applyClientAnthropicBeta(headers, null, { seedWhenAbsent: true });
  applyClientAnthropicBeta(headers, undefined, { seedWhenAbsent: true });
  assert.equal("anthropic-beta" in headers, false);
});

// ── 5. cache_control preservation ───────────────────────────────────────────

test("API-key path: cache_control markers in body survive header negotiation", () => {
  const executor = new DefaultExecutor("anthropic");
  const body = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "cached", cache_control: { type: "ephemeral" } },
          { type: "text", text: "plain" },
        ],
      },
    ],
  };
  const headers = executor.buildHeaders(
    { apiKey: "sk-ant-test" },
    false,
    { "anthropic-beta": "code-execution-2025-08-25" },
    "claude-sonnet-5",
    undefined,
    body
  );
  assert.ok(betaTokens(headers).includes("code-execution-2025-08-25"));
  const marker = body.messages[0].content[0].cache_control;
  assert.deepEqual(marker, { type: "ephemeral" });
});

// ── 6. baselines unchanged ──────────────────────────────────────────────────

test("API-key path: no OpenAI alternate is declared for anthropic today", async () => {
  const { REGISTRY } = await import("../../open-sse/config/providers/index.ts");
  const entry = REGISTRY["anthropic"];
  assert.ok(entry, "anthropic registry entry missing");
  assert.equal(
    (entry.alternateFormats ?? []).length,
    0,
    `anthropic must not declare alternate formats: ${JSON.stringify(entry.alternateFormats)}`
  );
});

test("API-key path: a future OpenAI alternate must not receive seeded client betas", async () => {
  const { REGISTRY } = await import("../../open-sse/config/providers/index.ts");
  const entry = REGISTRY["anthropic"];
  assert.ok(entry, "anthropic registry entry missing");
  const savedFormats = entry.alternateFormats;
  const savedUrlSuffix = entry.urlSuffix;
  try {
    // Simulate a future registry that exposes an OpenAI alternate for anthropic.
    entry.alternateFormats = [
      {
        format: "openai",
        label: "OpenAI Chat Completions",
        baseUrl: "https://api.anthropic.com/openai",
        chatPath: "/chat/completions",
      },
    ] as never;
    const executor = new DefaultExecutor("anthropic");
    const credentials = {
      apiKey: "sk-ant-test",
      providerSpecificData: { targetFormat: "openai" },
    } as never;
    const headers = executor.buildHeaders(
      credentials,
      false,
      { "anthropic-beta": "code-execution-2025-08-25" },
      "claude-sonnet-5",
      undefined,
      PLAIN_BODY
    );
    assert.equal(
      headers["Anthropic-Beta"] ?? headers["anthropic-beta"] ?? "",
      "",
      `client beta leaked onto an OpenAI alternate wire: ${JSON.stringify(headers)}`
    );
  } finally {
    entry.alternateFormats = savedFormats;
    if (savedUrlSuffix === undefined) delete (entry as { urlSuffix?: string }).urlSuffix;
    else entry.urlSuffix = savedUrlSuffix;
  }
});

test("claude OAuth baseline: static beta set and ?beta=true suffix unchanged", () => {
  const executor = new DefaultExecutor("claude");
  const url = executor.buildUrl("claude-sonnet-5", true, 0, { accessToken: "oauth-tok" });
  assert.equal(url, "https://api.anthropic.com/v1/messages?beta=true");

  assert.notEqual(ANTHROPIC_BETA_CLAUDE_OAUTH, "");
  assert.ok(
    ANTHROPIC_BETA_CLAUDE_OAUTH.includes("oauth-2025-04-20"),
    `OAuth beta set lost oauth: ${ANTHROPIC_BETA_CLAUDE_OAUTH}`
  );
});

test("constants: FULL / API_KEY / FORWARDABLE contents unchanged in shape", () => {
  assert.equal(ANTHROPIC_BETA_API_KEY, "");
  assert.ok(ANTHROPIC_BETA_FULL.includes("interleaved-thinking-2025-05-14"));
  assert.ok(ANTHROPIC_BETA_CLAUDE_OAUTH.includes("fine-grained-tool-streaming-2025-05-14"));
  assert.ok(FORWARDABLE_CLIENT_BETAS.includes("code-execution-2025-08-25"));
  assert.ok(FORWARDABLE_CLIENT_BETAS.includes("skills-2025-10-02"));
  assert.ok(FORWARDABLE_CLIENT_BETAS.includes("context-1m-2025-08-07"));
  assert.ok(!FORWARDABLE_CLIENT_BETAS.includes("claude-code-20250219"));
  assert.ok(!FORWARDABLE_CLIENT_BETAS.includes("oauth-2025-04-20"));
});

test("mergeClientAnthropicBeta: unknown allowlist entries still rejected on API-key path", () => {
  const out = mergeClientAnthropicBeta("", "not-a-real-beta,skills-2025-10-02", undefined, null, {
    tools: [{ type: "code_execution_20250825", name: "code_execution" }],
  });
  assert.equal(out, "skills-2025-10-02");
});

// ── 7. end-to-end execute: skills beta is client-negotiated only ────────────

const originalFetch = globalThis.fetch;

function noopLog() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

async function flushAsyncSideEffects() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

const CODE_EXEC_BODY = {
  model: "claude-sonnet-5",
  max_tokens: 64,
  stream: false,
  tools: [{ type: "code_execution_20250825", name: "code_execution" }],
  messages: [{ role: "user", content: "run code" }],
};

async function runUpstream(body, clientHeaders) {
  let captured = null;
  globalThis.fetch = async (url, init = {}) => {
    captured = {
      url: String(url),
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body || "{}")),
    };
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 4, output_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const result = await handleChatCore({
    body: structuredClone(body),
    modelInfo: { provider: "anthropic", model: body.model, extendedContext: false },
    credentials: { apiKey: "sk-ant-test", providerSpecificData: {} },
    log: noopLog(),
    clientRawRequest: {
      endpoint: "/v1/messages",
      body: structuredClone(body),
      headers: new Headers({
        accept: "application/json",
        "content-type": "application/json",
        ...clientHeaders,
      }),
    },
    userAgent: "unit-test",
  });

  assert.equal(result.success, true, `upstream call failed: ${JSON.stringify(result)}`);
  assert.ok(captured, "fetch was not called");
  return captured;
}

test.afterEach(async () => {
  globalThis.fetch = originalFetch;
  await flushAsyncSideEffects();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
});

test.after(() => {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("E2E API-key: no client beta + code_execution → no anthropic-beta header", async () => {
  const captured = await runUpstream(structuredClone(CODE_EXEC_BODY), {});
  assert.equal(
    captured.headers.get("anthropic-beta") ?? "",
    "",
    `skills beta auto-added without client negotiation: ${captured.headers.get("anthropic-beta")}`
  );
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.headers.get("x-api-key"), "sk-ant-test");
});

test("E2E API-key: client-negotiated skills beta + code_execution → forwarded as negotiated", async () => {
  const captured = await runUpstream(structuredClone(CODE_EXEC_BODY), {
    "anthropic-beta": "skills-2025-10-02",
  });
  assert.equal(captured.headers.get("anthropic-beta"), "skills-2025-10-02");
});

test("E2E API-key: client-negotiated skills beta without code_execution → not sent", async () => {
  const body = { ...structuredClone(CODE_EXEC_BODY), tools: [{ name: "get_weather" }] };
  const captured = await runUpstream(body, { "anthropic-beta": "skills-2025-10-02" });
  assert.equal(captured.headers.get("anthropic-beta") ?? "", "");
});

test("E2E API-key: OpenAI alternates (openai + openai-responses) + code_execution → no beta on the OpenAI wire", async () => {
  const { REGISTRY } = await import("../../open-sse/config/providers/index.ts");
  const entry = REGISTRY["anthropic"];
  assert.ok(entry, "anthropic registry entry missing");
  const savedFormats = entry.alternateFormats;

  const cases = [
    {
      format: "openai",
      alternate: {
        format: "openai",
        label: "OpenAI Chat Completions",
        baseUrl: "https://api.anthropic.com/openai",
        chatPath: "/chat/completions",
      },
      urlMarker: "/chat/completions",
      response: () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 1,
            model: "claude-sonnet-5",
            choices: [
              { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    },
    {
      format: "openai-responses",
      alternate: {
        format: "openai-responses",
        label: "OpenAI Responses",
        baseUrl: "https://api.anthropic.com/openai",
        chatPath: "/responses",
      },
      urlMarker: "/responses",
      response: () =>
        new Response(
          JSON.stringify({
            id: "resp_test",
            object: "response",
            created_at: 1,
            status: "completed",
            model: "claude-sonnet-5",
            output: [
              {
                type: "message",
                id: "msg_test",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "ok" }],
              },
            ],
            usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    },
  ];

  try {
    for (const testCase of cases) {
      entry.alternateFormats = [testCase.alternate];
      let captured = null;
      globalThis.fetch = async (url, init = {}) => {
        captured = {
          url: String(url),
          headers: new Headers(init.headers),
          body: JSON.parse(String(init.body || "{}")),
        };
        return testCase.response();
      };

      const res = await handleChatCore({
        body: structuredClone(CODE_EXEC_BODY),
        modelInfo: { provider: "anthropic", model: "claude-sonnet-5", extendedContext: false },
        credentials: {
          apiKey: "sk-ant-test",
          providerSpecificData: { targetFormat: testCase.format },
        },
        log: noopLog(),
        clientRawRequest: {
          endpoint: "/v1/messages",
          body: structuredClone(CODE_EXEC_BODY),
          headers: new Headers({
            accept: "application/json",
            "content-type": "application/json",
          }),
        },
        userAgent: "unit-test",
      });
      assert.equal(
        res.success,
        true,
        `[${testCase.format}] upstream call failed: ${JSON.stringify(res)}`
      );
      assert.ok(captured, `[${testCase.format}] fetch was not called`);

      assert.equal(
        captured.headers.get("anthropic-beta") ?? "",
        "",
        `[${testCase.format}] beta leaked onto the OpenAI-family wire: ${captured.headers.get("anthropic-beta")}`
      );
      assert.ok(
        captured.url.includes(testCase.urlMarker),
        `[${testCase.format}] expected alternate URL marker ${testCase.urlMarker}, got ${captured.url}`
      );
    }
  } finally {
    entry.alternateFormats = savedFormats;
  }
});

test("E2E API-key: serialized cache_control (incl. ttl 1h marker) preserved, no beta", async () => {
  const body = {
    ...structuredClone(CODE_EXEC_BODY),
    system: [
      {
        type: "text",
        text: "system prompt",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "cached", cache_control: { type: "ephemeral" } },
          { type: "text", text: "plain" },
        ],
      },
    ],
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution",
        cache_control: { type: "ephemeral" },
      },
    ],
  };
  const captured = await runUpstream(body, {});
  assert.equal(captured.headers.get("anthropic-beta") ?? "", "");

  const system = Array.isArray(captured.body.system) ? captured.body.system : [];
  assert.deepEqual(system[0]?.cache_control, { type: "ephemeral", ttl: "1h" });
  const userContent = captured.body.messages?.[0]?.content ?? [];
  assert.deepEqual(userContent[0]?.cache_control, { type: "ephemeral" });
  assert.equal(userContent[1]?.cache_control, undefined);
  const tools = captured.body.tools ?? [];
  assert.deepEqual(tools[0]?.cache_control, { type: "ephemeral" });
});

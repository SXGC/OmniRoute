import test from "node:test";
import assert from "node:assert/strict";

import { DefaultExecutor } from "../../open-sse/executors/default.ts";

// Anthropic rejects org-scoped API keys without `anthropic-workspace-id`
// ("This API key is not scoped to a workspace"), so the client's own header
// must ride onto the upstream request for Anthropic-shaped providers.

const CLAUDE_CREDENTIALS = { apiKey: "sk-ant-test" };

test("claude: forwards the client's anthropic-workspace-id upstream", () => {
  const executor = new DefaultExecutor("claude");
  const headers = executor.buildHeaders(CLAUDE_CREDENTIALS, true, {
    "anthropic-workspace-id": "wrkspc_01QVLzYnxZgB2ptJS9o2HG3H",
  }) as Record<string, string>;
  assert.equal(headers["anthropic-workspace-id"], "wrkspc_01QVLzYnxZgB2ptJS9o2HG3H");
});

test("claude: header lookup is case-insensitive", () => {
  const executor = new DefaultExecutor("claude");
  const headers = executor.buildHeaders(CLAUDE_CREDENTIALS, true, {
    "Anthropic-Workspace-Id": "wrkspc_case_variant",
  }) as Record<string, string>;
  assert.equal(headers["anthropic-workspace-id"], "wrkspc_case_variant");
});

test("claude: connection customHeaders win over the client header", () => {
  const executor = new DefaultExecutor("anthropic-compatible-acme");
  const headers = executor.buildHeaders(
    {
      ...CLAUDE_CREDENTIALS,
      providerSpecificData: {
        baseUrl: "https://acme.example.com",
        customHeaders: { "anthropic-workspace-id": "wrkspc_operator" },
      },
    },
    true,
    { "anthropic-workspace-id": "wrkspc_client" }
  ) as Record<string, string>;
  assert.equal(headers["anthropic-workspace-id"], "wrkspc_operator");
});

test("claude-code-compatible nodes forward the header despite the early return", () => {
  const executor = new DefaultExecutor("anthropic-compatible-cc-acme");
  const headers = executor.buildHeaders(
    {
      ...CLAUDE_CREDENTIALS,
      providerSpecificData: { baseUrl: "https://acme.example.com" },
    },
    true,
    { "anthropic-workspace-id": "wrkspc_cc_client" }
  ) as Record<string, string>;
  assert.equal(headers["anthropic-workspace-id"], "wrkspc_cc_client");
});

test("anthropic: official API-key provider id forwards the header", () => {
  const executor = new DefaultExecutor("anthropic");
  const headers = executor.buildHeaders(CLAUDE_CREDENTIALS, true, {
    "anthropic-workspace-id": "wrkspc_official",
  }) as Record<string, string>;
  assert.equal(headers["anthropic-workspace-id"], "wrkspc_official");
});

test("generic anthropic-compatible-* nodes forward the header", () => {
  const executor = new DefaultExecutor("anthropic-compatible-acme");
  const headers = executor.buildHeaders(
    {
      ...CLAUDE_CREDENTIALS,
      providerSpecificData: { baseUrl: "https://acme.example.com" },
    },
    true,
    { "anthropic-workspace-id": "wrkspc_compatible" }
  ) as Record<string, string>;
  assert.equal(headers["anthropic-workspace-id"], "wrkspc_compatible");
});

test("agentrouter on its default claude format forwards the header", () => {
  const executor = new DefaultExecutor("agentrouter");
  const headers = executor.buildHeaders(CLAUDE_CREDENTIALS, true, {
    "anthropic-workspace-id": "wrkspc_agentrouter",
  }) as Record<string, string>;
  assert.equal(headers["anthropic-workspace-id"], "wrkspc_agentrouter");
});

test("agentrouter switched to an OpenAI alternate format does NOT forward the header", () => {
  for (const targetFormat of ["openai", "openai-responses"]) {
    const executor = new DefaultExecutor("agentrouter");
    const headers = executor.buildHeaders(
      {
        ...CLAUDE_CREDENTIALS,
        providerSpecificData: { targetFormat },
      },
      true,
      { "anthropic-workspace-id": "wrkspc_leak" }
    ) as Record<string, string>;
    const leaked = Object.keys(headers).some(
      (key) => key.toLowerCase() === "anthropic-workspace-id"
    );
    assert.equal(leaked, false, `leaked with targetFormat=${targetFormat}`);
  }
});

test("non-anthropic providers do not forward anthropic-workspace-id", () => {
  const executor = new DefaultExecutor("groq");
  const headers = executor.buildHeaders(CLAUDE_CREDENTIALS, true, {
    "anthropic-workspace-id": "wrkspc_01QVLzYnxZgB2ptJS9o2HG3H",
  }) as Record<string, string>;
  const leaked = Object.keys(headers).some((key) => key.toLowerCase() === "anthropic-workspace-id");
  assert.equal(leaked, false);
});

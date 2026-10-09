/**
 * TDD regression for #9064: `anthropic` provider strips code-execution and
 * skills beta flags, so upstream rejects `container` dict form ("must be a
 * string").
 *
 * Root cause: FORWARDABLE_CLIENT_BETAS (only 2 entries) dropped any
 * client-negotiated beta for these flags. Without them, Anthropic evaluates
 * `container` under the old string-only contract and 400s.
 *
 * Fix: add both flags to FORWARDABLE_CLIENT_BETAS, forwarded only when the
 * client explicitly requests them. The API-key path now sends NO default
 * anthropic-beta set (ANTHROPIC_BETA_API_KEY is empty); all betas arrive via
 * client allowlist negotiation (see anthropic-api-key-beta-negotiation.test.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";

const { ANTHROPIC_BETA_API_KEY, mergeClientAnthropicBeta, FORWARDABLE_CLIENT_BETAS } =
  await import("../../open-sse/config/anthropicHeaders.ts");

const CODE_EXECUTION = "code-execution-2025-08-25";
const SKILLS = "skills-2025-10-02";

// ── static header assertion ─────────────────────────────────────────────────

test("#9064 static ANTHROPIC_BETA_API_KEY carries no default betas on the API-key path", () => {
  assert.equal(
    ANTHROPIC_BETA_API_KEY,
    "",
    `ANTHROPIC_BETA_API_KEY must be empty; betas are client-negotiated only: ${ANTHROPIC_BETA_API_KEY}`
  );
});

test("#14200 static ANTHROPIC_BETA_API_KEY must NOT include skills beta unconditionally (dynamic only)", () => {
  const tokens = ANTHROPIC_BETA_API_KEY.split(",").map((s) => s.trim());
  assert.ok(
    !tokens.includes(SKILLS),
    `skills beta must not be statically included in ANTHROPIC_BETA_API_KEY to prevent 400 on tool-less requests: ${ANTHROPIC_BETA_API_KEY}`
  );
});

// ── client-negotiated beta forwarding ───────────────────────────────────────

test("#9064 mergeClientAnthropicBeta must forward client-negotiated code-execution beta", () => {
  const out = mergeClientAnthropicBeta(
    ANTHROPIC_BETA_API_KEY,
    `claude-code-20250219,${CODE_EXECUTION}`
  );
  const tokens = out.split(",").map((s) => s.trim());
  assert.ok(tokens.includes(CODE_EXECUTION), `client code-execution beta dropped: ${out}`);
  assert.ok(FORWARDABLE_CLIENT_BETAS.includes(CODE_EXECUTION));
});

test("#9064 mergeClientAnthropicBeta must forward client-negotiated skills beta", () => {
  const out = mergeClientAnthropicBeta(ANTHROPIC_BETA_API_KEY, `claude-code-20250219,${SKILLS}`);
  const tokens = out.split(",").map((s) => s.trim());
  assert.ok(tokens.includes(SKILLS), `client skills beta dropped: ${out}`);
  assert.ok(FORWARDABLE_CLIENT_BETAS.includes(SKILLS));
});

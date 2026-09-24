/**
 * Tests for the upstream response-model observation helper
 * (open-sse/handlers/chatCore/upstreamResponseModel.ts).
 *
 * Semantics mirrored from sub2api's upstreamResponseModelObserver: only the
 * provider's own Responses payload counts as a declaration, and the collector's
 * reducer already resolves terminal-wins (response.completed snapshot beats any
 * earlier snapshot). These tests pin the extraction + mismatch rules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractUpstreamResponseModel,
  upstreamModelMismatched,
} from "../../open-sse/handlers/chatCore/upstreamResponseModel.ts";

describe("extractUpstreamResponseModel", () => {
  it("reads the model from a collector summary wrapper (streaming shape)", () => {
    const providerPayload = {
      _streamed: true,
      _format: "sse-json",
      summary: { object: "response", model: "gpt-5.4", status: "completed" },
    };
    assert.equal(extractUpstreamResponseModel(providerPayload, "gpt-5.5"), "gpt-5.4");
  });

  it("reads the model from an unwrapped Responses body (non-streaming shape)", () => {
    const body = { object: "response", model: "gpt-5.4", status: "completed" };
    assert.equal(extractUpstreamResponseModel(body, "gpt-5.5"), "gpt-5.4");
  });

  it("returns null for chat-completion summaries (non-Responses upstream)", () => {
    const providerPayload = {
      _streamed: true,
      summary: { object: "chat.completion", model: "gpt-5.4" },
    };
    assert.equal(extractUpstreamResponseModel(providerPayload, "gpt-5.5"), null);
  });

  it("returns null when no model was declared (reducer 'unknown' fallback)", () => {
    const providerPayload = {
      summary: { object: "response", model: "unknown" },
    };
    assert.equal(extractUpstreamResponseModel(providerPayload, "gpt-5.5"), null);
  });

  it("returns null when the declaration only echoes the routed model (fallbackModel)", () => {
    const providerPayload = {
      summary: { object: "response", model: "gpt-5.5" },
    };
    assert.equal(extractUpstreamResponseModel(providerPayload, "gpt-5.5"), null);
  });

  it("returns null for empty/whitespace models and non-object payloads", () => {
    assert.equal(
      extractUpstreamResponseModel({ summary: { object: "response", model: "  " } }, "m"),
      null
    );
    assert.equal(extractUpstreamResponseModel(null, "m"), null);
    assert.equal(extractUpstreamResponseModel("string", "m"), null);
    assert.equal(extractUpstreamResponseModel({}, "m"), null);
  });

  it("trims surrounding whitespace from a declared model", () => {
    const providerPayload = {
      summary: { object: "response", model: "  gpt-5.4-2026-08-15  " },
    };
    assert.equal(extractUpstreamResponseModel(providerPayload, "gpt-5.5"), "gpt-5.4-2026-08-15");
  });
});

describe("upstreamModelMismatched", () => {
  it("flags differing models", () => {
    assert.equal(upstreamModelMismatched("gpt-5.4", "gpt-5.5"), true);
  });

  it("is case-insensitive (sub2api EqualFold parity)", () => {
    assert.equal(upstreamModelMismatched("GPT-5.4", "gpt-5.4"), false);
  });

  it("returns false when either side is missing", () => {
    assert.equal(upstreamModelMismatched(null, "gpt-5.5"), false);
    assert.equal(upstreamModelMismatched("gpt-5.4", null), false);
    assert.equal(upstreamModelMismatched(null, null), false);
  });
});

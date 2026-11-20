import assert from "node:assert/strict";
import test from "node:test";
import { createSSEStream } from "../../open-sse/utils/stream.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";
import { resetDbInstance } from "../../src/lib/db/core.ts";

test.after(() => resetDbInstance());

async function runResponsesPassthrough(deltaCount: number) {
  let bodyStringifyCalls = 0;
  const body = {
    model: "gpt-6.2-sol",
    input: [{ role: "user", content: "hello world" }],
    toJSON() {
      bodyStringifyCalls += 1;
      return { model: this.model, input: this.input };
    },
  };

  let completedUsage: Record<string, unknown> | null = null;
  const stream = createSSEStream({
    mode: "passthrough",
    targetFormat: FORMATS.OPENAI_RESPONSES,
    sourceFormat: FORMATS.OPENAI_RESPONSES,
    clientResponseFormat: FORMATS.OPENAI_RESPONSES,
    provider: "codex",
    model: "gpt-6.2-sol",
    body,
    onComplete(result) {
      completedUsage = (result.usage as Record<string, unknown>) ?? null;
    },
  });

  const events: Array<{ event: string; data: unknown }> = [
    {
      event: "response.created",
      data: {
        type: "response.created",
        sequence_number: 0,
        response: { id: "resp_1", object: "response", status: "in_progress", output: [] },
      },
    },
    ...Array.from({ length: deltaCount }, (_, i) => ({
      event: "response.output_text.delta",
      data: {
        type: "response.output_text.delta",
        sequence_number: i + 1,
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta: `tok${i} `,
      },
    })),
    {
      event: "response.completed",
      data: {
        type: "response.completed",
        sequence_number: deltaCount + 1,
        response: {
          id: "resp_1",
          object: "response",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "done" }],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: deltaCount,
            total_tokens: 12 + deltaCount,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    },
  ];

  const raw =
    events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}`).join("\n\n") + "\n\n";
  await new Response(new Response(raw).body!.pipeThrough(stream)).text();

  return { bodyStringifyCalls, completedUsage };
}

async function runClaudePassthrough(deltaCount: number) {
  let bodyStringifyCalls = 0;
  const body = {
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: "say hi" }],
    toJSON() {
      bodyStringifyCalls += 1;
      return { model: this.model, messages: this.messages };
    },
  };

  const stream = createSSEStream({
    mode: "passthrough",
    targetFormat: FORMATS.CLAUDE,
    sourceFormat: FORMATS.CLAUDE,
    clientResponseFormat: FORMATS.CLAUDE,
    provider: "claude",
    model: "claude-sonnet-4-5",
    body,
  });

  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [],
        usage: { input_tokens: 12, output_tokens: 1 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...Array.from({ length: deltaCount }, (_, i) => ({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: `chunk-${i} ` },
    })),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 0 },
    },
    { type: "message_stop" },
  ];

  const raw =
    events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}`).join("\n\n") + "\n\n";
  const wire = await new Response(new Response(raw).body!.pipeThrough(stream)).text();
  return { bodyStringifyCalls, wire };
}

test("Responses passthrough does not scale body estimation with delta chunk count", async () => {
  const small = await runResponsesPassthrough(5);
  const large = await runResponsesPassthrough(50);

  assert.equal(
    large.bodyStringifyCalls,
    small.bodyStringifyCalls,
    "extra output_text.delta frames must not trigger additional request-body token estimates"
  );
  assert.ok(large.completedUsage, "completion should still report upstream usage");
  assert.equal(large.completedUsage.input_tokens, 12);
  assert.equal(large.completedUsage.output_tokens, 50);
});

test("Claude passthrough repairs zero output_tokens on message_delta without per-delta body estimation", async () => {
  const small = await runClaudePassthrough(5);
  const large = await runClaudePassthrough(50);

  assert.equal(
    large.bodyStringifyCalls,
    small.bodyStringifyCalls,
    "extra content_block_delta frames must not trigger additional request-body token estimates"
  );

  const deltaMatch = large.wire.match(/data:\s*(\{"type":"message_delta"[^\n]*\})/);
  assert.ok(deltaMatch, "message_delta frame should be forwarded");
  const parsedDelta = JSON.parse(deltaMatch[1]);
  assert.ok(
    parsedDelta.usage?.output_tokens > 0,
    "Claude message_delta with output_tokens: 0 should still be repaired"
  );
});

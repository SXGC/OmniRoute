import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSync } from "esbuild";

import { useDecollidedMigrationsDir } from "./helpers/decollidedMigrationsDir.ts";

useDecollidedMigrationsDir();
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-call-log-offload-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const WORKER_BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-call-log-worker-js-"));
const BUNDLED_WORKER_FILE = path.join(WORKER_BUNDLE_DIR, "callLogArtifactWorker.js");

const core = await import("../../src/lib/db/core.ts");
const callLogs = await import("../../src/lib/usage/callLogs.ts");
const { writeCallArtifactAsync, closeCallLogArtifactWriter, __setCallLogWorkerOverrideForTests } =
  await import("../../src/lib/usage/callLogArtifactWriter.ts");
const { protectRequestBodyForLog, protectPayloadForLog, protectErrorPayloadForLog } =
  await import("../../src/lib/logPayloads.ts");
const { protectPipelinePayloads } = await import("../../src/lib/usage/callLogs/format.ts");
const {
  hasProtectablePayload,
  hasProtectablePipelinePayloads,
  protectRequestBodyForWorker,
  protectPayloadForWorker,
  protectErrorPayloadForWorker,
  protectPipelinePayloadsForWorker,
} = await import("../../src/lib/usage/callLogPayloadProtectionCore.ts");

function ensureRunnableWorker(): void {
  const features = process.features as { typescript?: boolean | string };
  if (features.typescript) return;
  fs.writeFileSync(path.join(WORKER_BUNDLE_DIR, "package.json"), '{"type":"module"}');
  buildSync({
    entryPoints: ["src/lib/usage/callLogArtifactWorker.ts"],
    bundle: true,
    platform: "node",
    packages: "external",
    format: "esm",
    outfile: BUNDLED_WORKER_FILE,
  });
  __setCallLogWorkerOverrideForTests({ workerFile: BUNDLED_WORKER_FILE, execArgv: [] });
}

ensureRunnableWorker();

test.after(async () => {
  await callLogs.closeCallLogSaves(2_000);
  await closeCallLogArtifactWriter(2_000);
  __setCallLogWorkerOverrideForTests(null);
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.rmSync(WORKER_BUNDLE_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("worker single-pass protection matches main-thread protection across payload shapes", () => {
  const circular: Record<string, unknown> = { ok: true, api_key: "sk-secret-circular" };
  circular.self = circular;

  const requestFixtures: unknown[] = [
    null,
    undefined,
    "",
    "null",
    "not json raw text",
    '{"api_key":"sk-json","authorization":"Bearer secret-tok","nested":{"custom":"Bearer abc","arr":["Bearer keep-in-array"]}}',
    {
      model: "claude-sonnet-4-6",
      api_key: "sk-ant-secret",
      turnstile_token: "cf-challenge-123",
      headers: {
        Authorization: "Bearer top-secret",
        cookie: "session=abc",
        customAuth: "Bearer inline-bearer",
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "inspect screenshot" },
            { type: "image_url", image_url: { url: "data:image/png;base64,QUJDRA==" } },
            {
              type: "image",
              source: { type: "base64", media_type: "image/webp", data: "QUJDRA==" },
            },
            { inlineData: { mimeType: "image/jpeg", data: "QUJD" } },
          ],
        },
        {
          role: "assistant",
          encrypted_content: "opaque-encrypted-blob-12345",
        },
      ],
      error: {
        message: "Failed with sk-live-secret1234567890 at /home/alice/app.ts:42",
        api_key: "sk-nested-err",
      },
      jsonEnvelope: JSON.stringify({
        type: "error",
        message: "upstream sk-live-secret1234567890 failed",
      }),
      binary: new Uint8Array([1, 2, 3, 4]),
    },
    {
      type: "response.failed",
      status: "failed",
      message: "upstream failed sk-live-secret1234567890",
      response: {
        status: "failed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "partial answer" }],
          },
        ],
      },
    },
  ];

  for (const fixture of requestFixtures) {
    assert.deepEqual(protectRequestBodyForWorker(fixture), protectRequestBodyForLog(fixture));
    assert.deepEqual(protectPayloadForWorker(fixture), protectPayloadForLog(fixture));
  }

  assert.deepEqual(protectPayloadForWorker(circular), protectPayloadForLog(circular));
  assert.deepEqual(protectRequestBodyForWorker(circular), {
    ok: true,
    api_key: "[REDACTED]",
    self: "[circular]",
  });

  const errorFixtures: unknown[] = [
    null,
    undefined,
    "",
    "null",
    "upstream error with sk-live-secret1234567890",
    {
      error: {
        message: "bad key sk-live-secret1234567890",
        api_key: "sk-err",
      },
      encrypted_content: "secret-reasoning",
    },
    new Uint8Array([9, 8, 7]),
  ];

  for (const fixture of errorFixtures) {
    assert.deepEqual(protectErrorPayloadForWorker(fixture), protectErrorPayloadForLog(fixture));
  }

  const pipelineFixtures: Array<{ payload: unknown; status?: number }> = [
    { payload: null },
    { payload: {} },
    { payload: { clientRawRequest: null, streamChunks: { upstream: [] } } },
    {
      payload: {
        clientRawRequest: {
          api_key: "sk-123",
          input: [{ type: "input_image", image_url: "data:image/png;base64,QUJDRA==" }],
        },
        providerResponse: {
          status: 400,
          body: { error: { message: "bad token sk-live-secret1234567890" } },
        },
        clientResponse: {
          diagnostic: { schemaKeyword: "oneOf", category: "validation" },
        },
        streamChunks: {
          upstream: [
            '[12:00:00.000] data: {"encrypted_content":"abc123"}\n\n',
            '[12:00:00.010] event: error\ndata: {"type":"error","message":"boom sk-live-secret1234567890"}\n\n',
          ],
          empty: [],
        },
      },
      status: 400,
    },
  ];

  for (const { payload, status } of pipelineFixtures) {
    assert.deepEqual(
      protectPipelinePayloadsForWorker(payload, status),
      protectPipelinePayloads(payload, status)
    );
  }
});

test("presence checks match protect* non-nullness without traversing payload trees", () => {
  const payloadCases: unknown[] = [
    null,
    undefined,
    "",
    "null",
    "  null  ",
    "{}",
    0,
    false,
    { a: 1 },
  ];
  for (const value of payloadCases) {
    assert.equal(hasProtectablePayload(value), protectPayloadForLog(value) !== null);
  }

  const pipelineCases: unknown[] = [
    null,
    undefined,
    {},
    { clientRawRequest: null },
    { streamChunks: {} },
    { streamChunks: { upstream: [] } },
    { streamChunks: { upstream: ["chunk"] } },
    { clientRawRequest: "null" },
    { clientRawRequest: { model: "gpt-4.1" } },
  ];
  for (const value of pipelineCases) {
    assert.equal(hasProtectablePipelinePayloads(value), protectPipelinePayloads(value) !== null);
  }
});

test("saveCallLog offloads payload protection to the worker thread and avoids main-thread multi-pass walks", async () => {
  let nestedPropertyReadsOnMainThread = 0;
  const nestedMessage: Record<string, unknown> = {
    role: "user",
    api_key: "sk-ant-should-be-redacted",
    customHeader: "Bearer should-be-redacted",
    encrypted_content: "encrypted-reasoning-payload",
    screenshot: "data:image/png;base64,QUJDRA==",
  };
  Object.defineProperty(nestedMessage, "content", {
    enumerable: true,
    get() {
      nestedPropertyReadsOnMainThread++;
      return "hello worker offload";
    },
  });

  await callLogs.saveCallLog({
    id: "worker-offload-1",
    timestamp: "2026-11-19T12:00:00.000Z",
    method: "POST",
    path: "/v1/messages",
    status: 200,
    model: "anthropic/claude-sonnet-4-6",
    provider: "anthropic",
    duration: 42,
    requestBody: {
      model: "claude-sonnet-4-6",
      messages: [nestedMessage],
    },
    responseBody: {
      id: "msg_1",
      authorization: "Bearer secret-response-token",
      encrypted_content: "resp-encrypted-blob",
      content: [{ type: "text", text: "ok" }],
    },
    pipelinePayloads: {
      clientRawRequest: {
        api_key: "sk-pipeline-secret",
        image: "data:image/png;base64,QUJDRA==",
      },
      streamChunks: {
        upstream: ['data: {"encrypted_content":"stream-blob"}\n\n'],
      },
    },
  });

  // Main-thread sync protection previously ran 4 recursive passes (+ 1 postMessage = 5 reads).
  // With worker offload, only structuredClone inside postMessage reads the property once.
  assert.equal(nestedPropertyReadsOnMainThread, 1);

  const detail = await callLogs.getCallLogById("worker-offload-1");
  assert.ok(detail);
  const reqBody = detail.requestBody as { messages: Array<Record<string, unknown>> };
  assert.equal(reqBody.messages[0].content, "hello worker offload");
  assert.equal(reqBody.messages[0].api_key, "[REDACTED]");
  assert.equal(reqBody.messages[0].customHeader, "Bearer [REDACTED]");
  assert.equal(reqBody.messages[0].encrypted_content, "[omitted: encrypted reasoning, 27 chars]");
  assert.equal(
    reqBody.messages[0].screenshot,
    "[inline image: image/png, 4 bytes, 8 base64 chars]"
  );

  const resBody = detail.responseBody as Record<string, unknown>;
  assert.equal(resBody.authorization, "[REDACTED]");
  assert.equal(resBody.encrypted_content, "[omitted: encrypted reasoning, 19 chars]");

  const pipeline = detail.pipelinePayloads as {
    clientRawRequest: Record<string, unknown>;
    streamChunks: { upstream: string[] };
  };
  assert.equal(pipeline.clientRawRequest.api_key, "[REDACTED]");
  // Pipeline copy preserves inline images for Responses continuation replay.
  assert.equal(pipeline.clientRawRequest.image, "data:image/png;base64,QUJDRA==");
  assert.match(pipeline.streamChunks.upstream[0], /\[omitted: encrypted reasoning\]/);
});

test("saveCallLog keeps sync request_summary for search requests while still writing artifacts", async () => {
  await callLogs.saveCallLog({
    id: "worker-offload-search-1",
    timestamp: "2026-11-19T12:01:00.000Z",
    method: "POST",
    path: "/v1/search",
    status: 200,
    requestType: "search",
    model: "perplexity/sonar",
    provider: "perplexity",
    duration: 15,
    requestBody: {
      query: "omniroute worker offload",
      api_key: "sk-search-secret",
      max_results: 5,
    },
    responseBody: {
      results: [{ title: "ok" }],
      token: "secret-resp-token",
    },
  });

  const detail = await callLogs.getCallLogById("worker-offload-search-1");
  assert.ok(detail);
  assert.deepEqual(detail.requestSummary, {
    query: "omniroute worker offload",
    filters: { api_key: "[REDACTED]", max_results: 5 },
  });
  assert.equal((detail.responseBody as Record<string, unknown>).token, "[REDACTED]");
});

test("DataCloneError on one raw payload degrades via protected JSON fallback without failing queued writes", async () => {
  const uncloneableArtifact = {
    schemaVersion: 5 as const,
    summary: {
      id: "uncloneable-1",
      timestamp: "2026-11-19T12:02:00.000Z",
      method: "POST",
      path: "/v1/chat/completions",
      status: 200,
      model: "openai/gpt-4.1",
      requestedModel: null,
      provider: "openai",
      account: "-",
      connectionId: null,
      duration: 5,
      tokens: {
        in: 1,
        out: 1,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
        compressed: null,
      },
      requestType: "chat",
      sourceFormat: "openai",
      targetFormat: "openai",
      apiKeyId: null,
      apiKeyName: null,
      comboName: null,
      comboStepId: null,
      comboExecutionKey: null,
    },
    requestBody: {
      api_key: "sk-secret-fn",
      fn: () => "not cloneable",
      keep: "yes",
    },
    responseBody: { ok: true },
    error: null,
  };

  const healthyArtifact = {
    ...uncloneableArtifact,
    summary: { ...uncloneableArtifact.summary, id: "healthy-after-uncloneable" },
    requestBody: { keep: "healthy" },
  };

  const [first, second] = await Promise.all([
    writeCallArtifactAsync(uncloneableArtifact, {
      protectRequestBody: true,
      protectResponseBody: true,
    }),
    writeCallArtifactAsync(healthyArtifact, {
      protectRequestBody: true,
      protectResponseBody: true,
    }),
  ]);

  assert.ok(first);
  assert.ok(second);
  const firstDisk = JSON.parse(
    fs.readFileSync(path.join(TEST_DATA_DIR, "call_logs", first.relPath), "utf8")
  ) as { requestBody: Record<string, unknown> };
  assert.equal(firstDisk.requestBody.api_key, "[REDACTED]");
  assert.equal(firstDisk.requestBody.keep, "yes");
  assert.equal("fn" in firstDisk.requestBody, false);
});

/**
 * DB round-trip for call_logs.upstream_response_model (migration 186):
 * saveCallLog persists the column, getCallLogs/getCallLogById project it back
 * as upstreamResponseModel, and absent declarations stay NULL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { useDecollidedMigrationsDir } from "./helpers/decollidedMigrationsDir.ts";

useDecollidedMigrationsDir();
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-upstream-model-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const callLogs = await import("../../src/lib/usage/callLogs.ts");
const artifactWriter = await import("../../src/lib/usage/callLogArtifactWriter.ts");

test.after(async () => {
  await artifactWriter.closeCallLogArtifactWriter();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("saveCallLog persists upstream_response_model and reads project it back", async () => {
  void callLogs.saveCallLog({
    id: "upstream-model-1",
    timestamp: "2026-09-22T00:00:00.000Z",
    status: 200,
    model: "gpt-5.5",
    requestedModel: "claude-sonnet-cx",
    upstreamResponseModel: "gpt-5.4-2026-08-15",
    provider: "test-provider",
    tokens: {},
  });
  // No declaration — column must stay NULL.
  void callLogs.saveCallLog({
    id: "upstream-model-2",
    timestamp: "2026-09-22T00:00:01.000Z",
    status: 200,
    model: "gpt-5.5",
    provider: "test-provider",
    tokens: {},
  });

  assert.equal(await callLogs.waitForCallLogSaves(10_000), true);

  const raw = core
    .getDbInstance()
    .prepare("SELECT upstream_response_model FROM call_logs WHERE id = ?")
    .get("upstream-model-1") as { upstream_response_model: string | null };
  assert.equal(raw.upstream_response_model, "gpt-5.4-2026-08-15");

  const byId = await callLogs.getCallLogById("upstream-model-1");
  assert.equal(byId?.upstreamResponseModel, "gpt-5.4-2026-08-15");

  const list = await callLogs.getCallLogs({ limit: 10 });
  const row1 = list.find((l: { id: string }) => l.id === "upstream-model-1");
  const row2 = list.find((l: { id: string }) => l.id === "upstream-model-2");
  assert.equal(row1?.upstreamResponseModel, "gpt-5.4-2026-08-15");
  assert.equal(row2?.upstreamResponseModel, null);
});

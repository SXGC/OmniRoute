import { parentPort } from "node:worker_threads";

import {
  writeCallArtifact,
  type CallLogArtifact,
  type CallLogArtifactWriteResult,
} from "./callLogArtifacts.ts";
import {
  protectArtifactForWorker,
  type CallLogArtifactProtection,
} from "./callLogPayloadProtectionCore.ts";

type WriteRequest = {
  id: number;
  artifact: CallLogArtifact;
  protection?: CallLogArtifactProtection;
  environment: {
    pipelineMaxSizeKb?: string;
    chatDebugFile?: string;
    appLogLevel?: string;
    dataDir?: string;
    providerSafetyStopsTerminal?: string;
  };
};

type WriteReply = {
  id: number;
  result: CallLogArtifactWriteResult | null;
};

function applyWriteEnvironment(environment: WriteRequest["environment"]): void {
  const values = {
    CALL_LOG_PIPELINE_MAX_SIZE_KB: environment.pipelineMaxSizeKb,
    CHAT_DEBUG_FILE: environment.chatDebugFile,
    APP_LOG_LEVEL: environment.appLogLevel,
    // The worker resolves its paths lazily like the parent; pin it to the
    // parent's resolved dir so both executors share one target.
    DATA_DIR: environment.dataDir,
    PROVIDER_SAFETY_STOPS_TERMINAL: environment.providerSafetyStopsTerminal,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

parentPort?.on("message", (request: WriteRequest) => {
  const originalConsoleError = console.error;
  let result: CallLogArtifactWriteResult | null = null;

  try {
    // The writer reads these options lazily; mirror the caller's per-write environment snapshot.
    applyWriteEnvironment(request.environment);
    // writeCallArtifact's legacy error includes filesystem paths. Keep worker failures generic.
    console.error = () => {};
    const artifact = request.protection
      ? protectArtifactForWorker(request.artifact, request.protection)
      : request.artifact;
    result = writeCallArtifact(artifact);
  } catch {
    result = null;
  } finally {
    console.error = originalConsoleError;
  }

  try {
    parentPort?.postMessage({ id: request.id, result } satisfies WriteReply);
  } catch {
    parentPort?.postMessage({ id: request.id, result: null } satisfies WriteReply);
  }
});

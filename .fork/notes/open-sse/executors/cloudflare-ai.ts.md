# open-sse/executors/cloudflare-ai.ts

kind: D · status: claimed · reason: Fill the missing-signature validator skip marker on assistant tool-call history for the exact google/gemini-4-argon model so unsigned replay history stops failing with Cloudflare 400 User Input Error.

## 改动

在 `transformRequest()` 现有内容规范化（#2539 文本数组扁平化、#4838 null content 补空串、#6390 图片部分透传）结束后，调用 `patchCloudflareGeminiToolSignatures(model, { ...body, messages })`（helper 位于 `open-sse/executors/cloudflareGeminiToolSignatures.ts`，fork 新增文件）。仅当执行器收到的最终 model 参数严格等于 `google/gemini-4-argon` 时，helper 为缺失/空 `extra_content.google.thought_signature` 的有效 function 工具调用填入 `skip_thought_signature_validator`；真实签名原值保留，输入对象不被原地修改。

## 原因

Cloudflare Workers AI 的 `google/gemini-4-argon` 对不含 `tool_calls[].extra_content.google.thought_signature` 的 assistant 工具历史返回 400 `User Input Error`（code 7003）。已保存的对照探针（`/home/cai/dev/OmniRoute/_artifacts/cf400-probe-20261027/diagnosis.md`，16/18 号；该工件位于主 checkout 的私有 `_artifacts/` 目录，不在本 worktree，从 worktree 根按相对路径查找会失败）证明：完整历史加 sentinel 后流正常结束；同一输入仅去掉签名路径后 SSE 中出现上游 400。部分客户端在回放历史时会剥离 thought signature，且旧签名无法找回，故对缺失字段填校验绕过标记是最小兼容修复。上游执行器无此行为。

## 重做

合并上游时保留 `transformRequest()` 末尾对 `patchCloudflareGeminiToolSignatures` 的调用及 import（除非上游文件结构重排，则把调用接到等价的规范化出口处）。运行聚焦回归：

```bash
node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit --test-concurrency=1 tests/unit/cloudflare-gemini-executor-signatures.test.ts tests/unit/cloudflare-gemini-tool-signatures.test.ts tests/unit/executor-cloudflare-ai.test.ts tests/unit/cloudflare-ai-toolcall-content-4838.test.ts tests/unit/cloudflare-ai-image-parts-6390.test.ts
```

若上游已为缺失签名提供兼容处理，接受上游实现并移除本 seam 登记、本说明及 helper 文件与其测试。

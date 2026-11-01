# tests/unit/gemini-38-thinking-level-output.test.ts

kind: B · status: claimed · reason: Assert the fork default that Gemini 3.8 requests carry includeThoughts true unless thinking is switched off.

## 改动

文件头注释改为说明 fork 默认行为。6 个用例中原先断言 `includeThoughts` 为 `undefined` 的地方改为 `true`；其中 3 个用例标题随断言调整：「does not default-inject」改为「default-injects」，「set only when the client asked」改为「set whether or not the client asked」，「not includeThoughts」改为「with includeThoughts」。`reasoning_effort: "none"` 用例保持断言 `includeThoughts: false`。

## 原因

配套 `open-sse/services/thinkingBudget.ts` 的 seam。上游测试锁定的是「未请求就不发 includeThoughts」，与 fork 默认相反，不改会失败。

## 重做

合并上游时，以上游最新版本为底，把凡是断言 3.8 非零预算下 `includeThoughts` 为 `undefined` 的地方改为 `true`。上游新增的 3.8 用例同样按此处理。若 `thinkingBudget.ts` 的 seam 退役，同时接受上游测试并移除本登记和本说明。

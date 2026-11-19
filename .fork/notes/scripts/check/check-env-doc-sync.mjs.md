# scripts/check/check-env-doc-sync.mjs

kind: B · status: claimed · reason: Exempt the fork-only OMNIROUTE_ANTIGRAVITY_DEFAULT_SYSTEM variable, documented in fork notes instead of upstream env docs.

## 改动

`IGNORE_FROM_CODE` 里，在 `// Agent environment / system execution paths.` 之前加了一行 `"OMNIROUTE_ANTIGRAVITY_DEFAULT_SYSTEM"`，附带说明这是 fork 独有变量的注释。

## 原因

这个门禁要求代码里读取的每个 `process.env.X` 都写进 `.env.example` 和 `docs/reference/ENVIRONMENT.md`。这两个是上游文件，而 fork 规则要求 fork 独有行为只记在 `.fork/notes/`，不写进上游文档。变量的说明在 `.fork/notes/open-sse/translator/request/openai-to-gemini.ts.md`。

## 重做

合并上游时，保证 `IGNORE_FROM_CODE` 里仍有这一项。如果 fork 不再读取这个变量，就删掉这一行、这条 seam 和这份笔记。合并后运行 `npm run check:env-doc-sync`。

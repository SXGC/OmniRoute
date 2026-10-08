# AGENTS.md

kind: B · status: claimed · reason: Document the fork-seam rules that every agent must follow before editing an upstream file.

## 改动

在 “Upstream contributions” 一节之后新增 `### Fork seams` 小节，写明 `.fork/seams.json` 和 `.fork/notes/` 的登记规则。

## 原因

AI 会话只会自动读取 AGENTS.md。seam 规则如果只写在 fork 自己的文件里，代理在改上游文件之前看不到这些规则。

## 重做

合并上游时，保留 `### Fork seams` 整节，放在 “Upstream contributions” 之后、`## Environment` 之前。小节内容不要改动。

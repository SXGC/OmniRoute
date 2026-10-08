# open-sse/config/codexInstructions.ts

kind: B · status: claimed · reason: Use a one-line Codex default instruction instead of the long CLIProxyAPI Codex CLI prompt.

## 改动

把 `CODEX_DEFAULT_INSTRUCTIONS` 换成 `"You are a helpful assistant."`，并删掉来源注释（CLIProxyAPI）。`CODEX_CHAT_DEFAULT_INSTRUCTIONS` 保持不变。

## 原因

上游默认注入一整份 Codex CLI 的系统提示（沙箱、审批、输出格式等）。本 fork 把 Codex 当通用模型用，这段长提示会改变回答风格，每次请求还要多消耗大量 token。

## 重做

合并上游时，如果上游改写了这段长提示，仍然保留 fork 的一行版本，不要把上游新的长文本合进来。只有当上游把这个常量改名或拆分时，才在新位置做同样的替换。

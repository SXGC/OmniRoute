# tests/unit/anthropic-api-key-beta-15942.test.ts

kind: D · status: claimed · reason: Keep upstream CC identity safeguards while asserting the fork's empty API-key beta defaults.

## 改动

普通 API-key 请求断言没有 anthropic-beta，默认常量为空；保留上游 OAuth、Claude Code 身份及凭据回归检查。

## 原因

fork 默认不注入功能 beta，只按客户端显式请求协商。上游新增的默认功能 beta 断言与此合同相反。

## 重做

保留身份检查，按 fork 空默认 beta 合同调整 API-key 断言，并与 anthropic-api-key-beta-negotiation.test.ts 一起运行。上游采用同等合同后撤销登记与说明。

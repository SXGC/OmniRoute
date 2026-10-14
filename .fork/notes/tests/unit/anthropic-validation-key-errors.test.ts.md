# tests/unit/anthropic-validation-key-errors.test.ts

kind: D · status: claimed · reason: Probe Anthropic key validation at the fork's beta-free Messages endpoint.

## 改动

mock 的 Messages 地址不带 ?beta=true，保留余额、workspace 和 customHeaders 全部上游断言。

## 原因

fork Anthropic registry 使用 beta-free 地址；上游新增测试 mock 旧地址会把真实探测误送到默认 404 分支。

## 重做

mock 地址与 fork registry 保持一致，运行此文件和 anthropic-api-key-beta-negotiation.test.ts。上游不再使用 beta query 后撤销登记与说明。

# AGENTS.md

kind: B · status: claimed · reason: Document the fork-seam rules that every agent must follow before editing an upstream file.

## 改动

在 “Upstream contributions” 一节之后新增 `### Fork seams` 小节，写明 `.fork/seams.json` 和 `.fork/notes/` 的登记规则。

新增 `### Fork image publishing` 小节：本地镜像统一使用 `omniroute:latest`，阿里云 ACR 使用 `registry.cn-hangzhou.aliyuncs.com/jct_image/omniroute:latest`。推送后核对摘要；未经明确要求，不新增其他发布标签，也不删除已有远端标签。

## 原因

AI 会话只会自动读取 AGENTS.md。seam 规则如果只写在 fork 自己的文件里，代理在改上游文件之前看不到这些规则。

## 重做

合并上游时，保留 `### Fork image publishing` 与 `### Fork seams` 两节，放在 “Upstream contributions” 之后、`## Environment` 之前。保留固定 `latest` 标签和 seam 登记规则。

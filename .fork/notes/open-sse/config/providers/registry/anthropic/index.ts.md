# open-sse/config/providers/registry/anthropic/index.ts

kind: B · status: claimed · reason: Drop the anthropic provider's static Anthropic-Beta header and ?beta=true urlSuffix so the API-key wire shape carries no default betas.

## 改动

从 `anthropicProvider` 注册项中移除 `urlSuffix: "?beta=true"` 与 `headers["Anthropic-Beta"]`（连同不再使用的 `ANTHROPIC_BETA_API_KEY` import）。保留 `x-api-key` 认证与 `Anthropic-Version` 头。`claude`（OAuth）注册项的 `?beta=true` 与静态 beta 集不受影响。

## 原因

API-key 路径的默认 beta 由本注册项静态注入；移除后 `DefaultExecutor.buildUrl()` 与 `services/provider.ts` 的 `buildProviderUrl` 都不再追加 `?beta=true`，`buildHeaders` 也不再携带静态 `Anthropic-Beta`，beta 只能经客户端允许名单协商进入（见 anthropicHeaders.ts seam 与 executors/default.ts seam）。

## 重做

合并上游时保留这两处删除。运行 `DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/anthropic-api-key-beta-negotiation.test.ts tests/unit/deno-deploy-relay-path-ssrf.test.ts tests/unit/proxyfetch-vercel-relay-2743.test.ts`。若上游移除了默认 beta/suffix，接受上游实现并移除本登记和说明。

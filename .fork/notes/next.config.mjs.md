# next.config.mjs

kind: B · status: claimed · reason: Disable experimental.turbopackFileSystemCacheForBuild so Docker Turbopack builds skip 40-140s SST write and compaction overhead.

## 改动

在 `experimental` 中增加 `turbopackFileSystemCacheForBuild: false`。

## 原因

Next.js 16.4 默认开启 Turbopack 构建磁盘缓存（`turbo-persistence` LSM/SST 数据库）。在 OmniRoute 672 个路由规模下，Docker BuildKit cache mount 里的缓存写入 + 数据库 compaction 实测耗时 136 秒（42s 写入 + 94s compaction），几乎抵消了增量编译收益；关闭后可消除落盘和 compaction 停顿。

## 重做

合并上游时，确认 `next.config.mjs` 的 `experimental` 中是否已有 `turbopackFileSystemCacheForBuild` 配置；若无则重新加上 `turbopackFileSystemCacheForBuild: false`。

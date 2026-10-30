# docs/providers/grok-cli-media.md

kind: D · status: claimed · reason: Add the frontmatter title fumadocs requires so the upstream-added provider doc does not break the Next production build.

## 改动

在文件开头补一个 fumadocs 前置块：

```yaml
---
title: "Providers — Grok Build media"
version: 3.8.53
lastUpdated: 2026-10-30
---
```

## 原因

上游在 release/v3.8.53 新增这个 provider 文档时没带 frontmatter。`source.config.ts` 把 `./providers/**/*.md` 交给 `defineDocs()`，fumadocs 的默认 schema 要求 `title` 是字符串，缺失时 `next build` 直接失败：

```
[MDX] invalid frontmatter in docs/providers/grok-cli-media.md:
- title: Invalid input: expected string, received undefined
```

本地复现：`npm run check:docs-frontmatter` 对同一文件报 `no frontmatter block`，`docker build --target runner-cli` 在 `npm run build` 阶段失败。

## 重做

合并上游时先跑 `npm run check:docs-frontmatter`。如果上游已给该文件补上 `title`，接受上游版本，删除本登记和本说明；如果上游仍未补，保留前置块（标题文案可随上游正文调整），并确认 version/lastUpdated 与同类文档一致。

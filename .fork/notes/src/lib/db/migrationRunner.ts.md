# src/lib/db/migrationRunner.ts

kind: B · status: claimed · reason: Load fork migrations from migrations/fork/ as fork-NNN and move legacy fork ledger rows out of upstream slots.

## 改动

加了两处一行的调用：`getMigrationFiles()` 的返回值里，在 `getExtraMigrationFiles()` 之前插入 `getForkMigrationFiles(MIGRATIONS_DIR)`；`runMigrations()` 里在 `validateRequiredPhysicalMigrationProvenance` 之前调用 `reconcileForkLegacyMigrations(db, files)`。逻辑都在 fork 自己的 `migrationRunner/forkMigrations.ts` 里。

## 原因

fork 的迁移如果占用上游的数字编号，每次同步都可能和上游下一个迁移撞号：要么启动直接报错，要么其中一个迁移被静默跳过。改成命名空间 `fork-NNN` 后永远不会撞号。旧的 fork 库里记录的是 `190`，必须先改写成 `fork-001`，上游自己的 190 才会执行。

## 重做

合并上游时，在 `getMigrationFiles()` 的最终返回值和 `runMigrations()` 拿到 `files` 之后的位置，重新加上这两处调用。不要改上游的 `RENAMED_MIGRATION_COMPATIBILITY`，上游有测试锁定了它。运行 `node --import tsx/esm --test tests/unit/db-migration-runner*.test.ts tests/unit/db-migrationrunner-constants-split.test.ts`。

# open-sse/translator/helpers/geminiHelper.ts

kind: D · status: claimed · reason: Strip unsupported discriminator schema metadata before sending Gemini and Antigravity requests.

## 改动

在 `GEMINI_UNSUPPORTED_SCHEMA_KEYS` 中添加 `discriminator`。现有清洗逻辑递归删除该元数据，但保留 `properties` 中名为 `discriminator` 的正常参数。

## 原因

Antigravity 拒绝参数 Schema 中的 `discriminator` 字段，并返回 HTTP 400。原清单缺少该字段，工具格式转换后仍会携带它。

## 重做

合并上游时保留清单中的 `discriminator`。运行 `node --import tsx/esm --test tests/unit/gemini-discriminator-tool-schema.test.ts`，检查递归清洗及第 14 个工具的转换结果。若上游已实现同等行为，接受上游实现并移除对应登记和本说明。

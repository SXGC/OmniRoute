# open-sse/utils/reasoningPlaceholder.ts

kind: D · status: claimed · reason: Add hasForeignToolCallsRequiringReasoning(), which flags native-DeepSeek tool-call turns whose ids do not match DeepSeek's call_<2 digits>_ format.

## 改动

文件末尾新增 `DEEPSEEK_ISSUED_TOOL_CALL_ID = /^call_\d{2}_/` 和导出函数 `hasForeignToolCallsRequiringReasoning(provider, toolCalls)`：provider 为 `deepseek` 且任一工具调用 id 缺失、非字符串或不匹配该格式时返回 true。

## 原因

原生 DeepSeek 只接受它自己签发的工具调用轮次缺省 reasoning_content；对其签发的轮次仍保持缺省，避免模型回显占位符（#9573/#9610）。上游没有区分签发来源的逻辑。

## 重做

保留该函数及正则。若上游提供等价判断，改用上游并撤销本 seam。

聚焦回归：

```bash
node --import tsx/esm --test --test-force-exit tests/unit/deepseek-foreign-toolcall-reasoning-presence.test.ts tests/unit/reasoning-cache.test.ts tests/unit/tool-request-sanitization.test.ts
```

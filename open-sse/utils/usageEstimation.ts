// Heuristic token estimation constants
const CHARS_PER_TOKEN_SCHEMA = 6; // ~6 chars/token for JSON schemas (more verbose per token)

function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

function isWhitespaceCode(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0xfeff;
}

/**
 * Improved token estimation heuristic (no dependency, zero-allocation single pass).
 * Splits text on common token boundaries (whitespace, punctuation, camelCase)
 * and applies a sub-word correction factor. Better accuracy for:
 * - English text (~4 chars/token)
 * - CJK text (~1 char/token for ideographs)
 * - Code (~3.5 chars/token, more punctuation-heavy)
 *
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokenCount(text: unknown) {
  if (!text || typeof text !== "string") return 0;

  let cjkCount = 0;
  let nonCjkTokens = 0;
  let inWord = false;
  let prevLower = false;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        const cp = ((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        i++;
        if (cp >= 0x20000 && cp <= 0x2fa1f) {
          cjkCount++;
        } else {
          nonCjkTokens++;
        }
        inWord = false;
        prevLower = false;
        continue;
      }
    }

    if ((code >= 0x3000 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) {
      cjkCount++;
      inWord = false;
      prevLower = false;
      continue;
    }

    if (isWhitespaceCode(code)) {
      inWord = false;
      prevLower = false;
      continue;
    }

    if (isWordChar(code)) {
      const isUpper = code >= 65 && code <= 90;
      const isLower = code >= 97 && code <= 122;
      if (!inWord || (prevLower && isUpper)) {
        nonCjkTokens++;
      }
      inWord = true;
      prevLower = isLower;
      continue;
    }

    nonCjkTokens++;
    inWord = false;
    prevLower = false;
  }

  return cjkCount + Math.ceil(nonCjkTokens * 1.3);
}

/**
 * Estimate input tokens from request body.
 * Separates tool definitions (JSON schemas) from message content
 * for more accurate estimation since JSON schemas are more verbose but
 * compress into fewer tokens than plain text.
 */
export function estimateInputTokens(body: unknown) {
  if (!body || typeof body !== "object") return 0;
  const record = body as Record<string, unknown>;

  try {
    let toolTokens = 0;
    let messageTokens = 0;

    // Separate tool definitions from the rest of the body
    if (record.tools && Array.isArray(record.tools)) {
      const toolStr = JSON.stringify(record.tools);
      toolTokens = Math.ceil(toolStr.length / CHARS_PER_TOKEN_SCHEMA);
      // Estimate messages without tools
      const { tools, ...bodyWithoutTools } = record;
      messageTokens = estimateTokenCount(JSON.stringify(bodyWithoutTools));
    } else {
      messageTokens = estimateTokenCount(JSON.stringify(record));
    }

    return messageTokens + toolTokens;
  } catch {
    // Fallback if stringify fails
    return 0;
  }
}

/**
 * Estimate output tokens from content length.
 * Uses improved heuristic when possible, falls back to length-based estimation.
 */
export function estimateOutputTokens(contentLength: number | null | undefined) {
  if (!contentLength || contentLength <= 0) return 0;
  // When we only have a character count, use 4 chars/token with sub-word correction
  return Math.max(1, Math.ceil(contentLength / 3.5));
}

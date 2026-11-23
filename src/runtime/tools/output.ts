export const MAX_TOOL_OUTPUT_CHARS = 128 * 1024;
export const OUTPUT_TRUNCATION_NOTICE = "\n[... earlier output truncated ...]\n";

export function appendBoundedOutput(output: string, chunk: string): string {
    const combined = output + chunk;
    if (combined.length <= MAX_TOOL_OUTPUT_CHARS) {
        return combined;
    }

    const bodyLength = MAX_TOOL_OUTPUT_CHARS - OUTPUT_TRUNCATION_NOTICE.length;
    let start = combined.length - bodyLength;
    const firstCodeUnit = combined.charCodeAt(start);
    if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) {
        start += 1;
    }
    return OUTPUT_TRUNCATION_NOTICE + combined.slice(start);
}

export function formatTruncatedOutput(output: string, discardedCharacters: number): string {
    if (discardedCharacters === 0) {
        return output;
    }
    return `${OUTPUT_TRUNCATION_NOTICE}[${discardedCharacters} earlier characters were discarded; only the latest ${MAX_TOOL_OUTPUT_CHARS} characters are retained.]\n${output}`;
}

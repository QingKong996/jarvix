export const SANDBOX_VIOLATION_TRACKING_LIMIT = 256;

export function rememberSandboxViolation(seen: Set<string>, signature: string): boolean {
    if (seen.has(signature)) {
        return false;
    }
    seen.add(signature);
    if (seen.size > SANDBOX_VIOLATION_TRACKING_LIMIT) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) {
            seen.delete(oldest);
        }
    }
    return true;
}

export function formatSandboxViolations(lines: readonly string[]): string {
    const sanitized = lines
        .map((line) => sanitizeViolationLine(line))
        .filter((line) => line.length > 0);
    if (sanitized.length === 0) {
        return "";
    }
    return [
        "<sandbox_violations>",
        ...sanitized,
        "</sandbox_violations>"
    ].join("\n");
}

export function appendSandboxViolations(
    output: string,
    violations: readonly string[]
): string {
    const block = formatSandboxViolations(violations);
    if (block.length === 0) {
        return output;
    }
    return output.length > 0 ? `${output}\n${block}` : block;
}

function sanitizeViolationLine(line: string): string {
    return line
        .replace(/[\r\n]+/g, " ")
        .replace(/[<>]/g, "")
        .trim();
}

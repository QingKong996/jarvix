import {
    basename,
    dirname,
    isAbsolute,
    parse,
    relative,
    resolve,
    sep
} from "node:path";
import { realPathOf, type FilesystemPathEntry } from "@anthropic-ai/sandbox-runtime";
import type { SandboxPolicy } from "./sandbox.ts";

export type SandboxPathDecision =
    | {
        allowed: true;
        path: string;
    }
    | {
        allowed: false;
        path: string;
        reason: string;
    };

type PathRule = {
    path: string;
    glob: boolean;
};

type PathRuleMatch = {
    path: string;
    specificity: number;
};

/**
 * Check read access against denyRead and allowRead. For reads, a more specific
 * allowRead entry overrides a broader denyRead entry.
 */
export function authorizeSandboxRead(
    policy: SandboxPolicy | null,
    requestedPath: string
): SandboxPathDecision {
    const absolutePath = resolve(requestedPath);
    if (policy === null || policy.filesystem.disabled === true) {
        return { allowed: true, path: absolutePath };
    }

    let target: string;
    try {
        target = canonicalSandboxPath(absolutePath);
    } catch (error) {
        return {
            allowed: false,
            path: absolutePath,
            reason: `the path could not be resolved: ${errorMessage(error)}`
        };
    }

    const denied = matchingReadRule(policy.filesystem.denyRead, target);
    const allowed = matchingReadRule(policy.filesystem.allowRead, target);
    if (!denied || (allowed && allowed.specificity >= denied.specificity)) {
        return { allowed: true, path: absolutePath };
    }
    return {
        allowed: false,
        path: absolutePath,
        reason: `the path is inside sandbox denyRead root ${denied.path}`
    };
}

/**
 * Check write access against the sandbox policy itself. Callers must not
 * derive separate directory rules: allowWrite and denyWrite are authoritative.
 */
export function authorizeSandboxWrite(
    policy: SandboxPolicy | null,
    requestedPath: string
): SandboxPathDecision {
    const absolutePath = resolve(requestedPath);
    if (policy === null || policy.filesystem.disabled === true) {
        return { allowed: true, path: absolutePath };
    }

    let target: string;
    try {
        target = canonicalSandboxPath(absolutePath);
    } catch (error) {
        return {
            allowed: false,
            path: absolutePath,
            reason: `the path could not be resolved: ${errorMessage(error)}`
        };
    }

    const denyRules = pathRules(policy.filesystem.denyWrite);
    const unsupportedDeny = denyRules.find((rule) => rule.glob);
    if (unsupportedDeny) {
        return {
            allowed: false,
            path: absolutePath,
            reason: `denyWrite contains a glob rule that apply_patch cannot verify (${unsupportedDeny.path})`
        };
    }
    for (const rule of denyRules) {
        let deniedRoot: string;
        try {
            deniedRoot = canonicalSandboxPath(rule.path);
        } catch (error) {
            return {
                allowed: false,
                path: absolutePath,
                reason: `the denyWrite rule ${rule.path} could not be resolved: ${errorMessage(error)}`
            };
        }
        if (isWithin(deniedRoot, target)) {
            return {
                allowed: false,
                path: absolutePath,
                reason: `the path is inside sandbox denyWrite root ${deniedRoot}`
            };
        }
    }

    const allowRoots: string[] = [];
    for (const rule of pathRules(policy.filesystem.allowWrite)) {
        if (rule.glob) {
            continue;
        }
        try {
            allowRoots.push(canonicalSandboxPath(rule.path));
        } catch {
            // An allow rule that cannot be resolved grants nothing.
        }
    }
    if (allowRoots.length === 0) {
        return {
            allowed: false,
            path: absolutePath,
            reason: "the sandbox policy has no writable roots"
        };
    }
    if (allowRoots.some((root) => isWithin(root, target))) {
        return { allowed: true, path: absolutePath };
    }
    return {
        allowed: false,
        path: absolutePath,
        reason: `the path is outside sandbox allowWrite roots (${allowRoots.join(", ")})`
    };
}

export function authorizeSandboxWrites(
    policy: SandboxPolicy | null,
    requestedPaths: readonly string[]
): SandboxPathDecision[] {
    return requestedPaths.map((path) => authorizeSandboxWrite(policy, path));
}

function pathRules(entries: readonly FilesystemPathEntry[] | undefined): PathRule[] {
    return (entries ?? []).map((entry) => {
        if (typeof entry === "string") {
            return {
                path: entry,
                glob: hasGlobSyntax(entry)
            };
        }
        return {
            path: entry.path,
            glob: false
        };
    });
}

function matchingReadRule(
    entries: readonly FilesystemPathEntry[] | undefined,
    target: string
): PathRuleMatch | null {
    let best: PathRuleMatch | null = null;
    for (const rule of pathRules(entries)) {
        const match = rule.glob
            ? matchGlobRule(rule.path, target)
            : matchPathRule(rule.path, target);
        if (match && (!best || match.specificity > best.specificity)) {
            best = match;
        }
    }
    return best;
}

function matchPathRule(path: string, target: string): PathRuleMatch | null {
    let root: string;
    try {
        root = canonicalSandboxPath(path);
    } catch {
        return null;
    }
    return isWithin(root, target)
        ? { path, specificity: comparablePath(root).length }
        : null;
}

function matchGlobRule(pattern: string, target: string): PathRuleMatch | null {
    const absolutePattern = process.platform === "win32"
        ? resolve(pattern).replace(/\\/g, "/")
        : resolve(pattern);
    const comparableTarget = process.platform === "win32"
        ? target.replace(/\\/g, "/").toLowerCase()
        : target;
    const expression = new RegExp(
        `^${globExpression(absolutePattern)}$`,
        process.platform === "win32" ? "i" : ""
    );
    if (!expression.test(comparableTarget)) {
        return null;
    }
    return {
        path: pattern,
        specificity: absolutePattern.replace(/[*?[\]]/g, "").length
    };
}

function globExpression(pattern: string): string {
    let expression = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index]!;
        if (character === "*" && pattern[index + 1] === "*") {
            if (pattern[index + 2] === "/") {
                expression += "(?:.*/)?";
                index += 2;
            } else {
                expression += ".*";
                index += 1;
            }
        } else if (character === "*") {
            expression += "[^/]*";
        } else if (character === "?") {
            expression += "[^/]";
        } else if (character === "[") {
            const close = pattern.indexOf("]", index + 1);
            if (close > index + 1) {
                const content = pattern.slice(index + 1, close);
                expression += `[${content.startsWith("!") ? `^${content.slice(1)}` : content}]`;
                index = close;
            } else {
                expression += "\\[";
            }
        } else {
            expression += character.replace(/[\\^$+.()|{}[\]]/g, "\\$&");
        }
    }
    return expression;
}

function hasGlobSyntax(spelling: string): boolean {
    return process.platform === "win32"
        ? /[*?]/.test(spelling)
        : /[*?[\]]/.test(spelling);
}

/**
 * Mirror the sandbox's path interpretation for a path that may not exist yet:
 * resolve links on the nearest existing ancestor, then append the missing tail.
 */
function canonicalSandboxPath(path: string): string {
    const absolute = resolve(path);
    try {
        return realPathOf(absolute);
    } catch (error) {
        if (!isMissingPath(error)) {
            throw error;
        }
    }

    const missingParts: string[] = [];
    let current = absolute;
    while (true) {
        const parent = dirname(current);
        if (parent === current) {
            return absolute;
        }
        missingParts.unshift(basename(current));
        current = parent;
        try {
            return resolve(realPathOf(current), ...missingParts);
        } catch (error) {
            if (!isMissingPath(error)) {
                throw error;
            }
        }
    }
}

function isWithin(root: string, target: string): boolean {
    const comparableRoot = comparablePath(root);
    const comparableTarget = comparablePath(target);
    const pathFromRoot = relative(comparableRoot, comparableTarget);
    return pathFromRoot === ""
        || (
            pathFromRoot !== ".."
            && !pathFromRoot.startsWith(`..${sep}`)
            && !isAbsolute(pathFromRoot)
        );
}

function comparablePath(path: string): string {
    const normalized = process.platform === "win32" ? path.toLowerCase() : path;
    const root = parse(normalized).root;
    return normalized.length > root.length
        ? normalized.replace(/[\\/]+$/, "")
        : normalized;
}

function isMissingPath(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

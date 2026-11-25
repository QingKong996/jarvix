import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import {
    basename,
    dirname,
    isAbsolute,
    parse,
    relative,
    resolve,
    sep
} from "node:path";
import type {
    JarvixPathCompletion,
    JarvixPathCompletionResult,
    JarvixPathKind
} from "../../protocol/path-completion.ts";
import { PATH_COMPLETION_LIMIT } from "../../protocol/path-completion.ts";
import type { JarvixSessionContext } from "../../protocol/session.ts";
import { workingDirectoriesFor } from "../../core/session/directories.ts";

type CompletionTarget = {
    directory: string;
    prefix: string;
    displayRoot: string | null;
};

/** Complete one filesystem path segment without recursively scanning the tree. */
export async function completePaths(
    query: string,
    context: JarvixSessionContext
): Promise<JarvixPathCompletionResult> {
    const roots = workingDirectoriesFor(context);
    let batches: JarvixPathCompletion[][] = [];
    for (const targets of completionTargetPlans(query, roots)) {
        batches = await Promise.all(
            targets.map((target) => entriesFor(target))
        );
        if (batches.some((batch) => batch.length > 0)) {
            break;
        }
    }
    const seen = new Set<string>();
    const results: JarvixPathCompletion[] = [];
    for (const entry of batches.flat()) {
        const key = comparablePath(entry.path);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        results.push(entry);
    }
    disambiguateRelativePaths(results);
    results.sort((left, right) => {
        if (left.kind !== right.kind) {
            return left.kind === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, {
            numeric: true,
            sensitivity: "base"
        });
    });
    return { entries: results.slice(0, PATH_COMPLETION_LIMIT) };
}

function disambiguateRelativePaths(results: JarvixPathCompletion[]): void {
    const counts = new Map<string, number>();
    for (const entry of results) {
        const key = comparableDisplayPath(entry.relativePath);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const entry of results) {
        if ((counts.get(comparableDisplayPath(entry.relativePath)) ?? 0) > 1) {
            entry.relativePath = entry.path;
        }
    }
}

function completionTargetPlans(
    query: string,
    roots: readonly string[]
): CompletionTarget[][] {
    const normalizedQuery = normalizeQuerySeparators(query);
    const expanded = normalizeQuerySeparators(expandHome(query));
    if (expanded !== normalizedQuery) {
        const homeQuery = query === "~" || hasTrailingSeparator(query)
            ? `${expanded.replace(/\/+$/u, "")}/`
            : expanded;
        return [[targetForPath(resolve(expanded), homeQuery, null)]];
    }
    if (isAbsoluteQuery(expanded)) {
        const absolute = [
            targetForPath(resolve(expanded), expanded, null)
        ];
        return isAmbiguousRootPath(expanded)
            ? [absolute, relativeTargets(expanded, roots)]
            : [absolute];
    }
    return [relativeTargets(expanded, roots)];
}

function relativeTargets(
    query: string,
    roots: readonly string[]
): CompletionTarget[] {
    const relativeQuery = stripRelativePrefix(query);
    const baseRoots = roots.length > 0 ? roots : [homedir()];
    return baseRoots.map((root) => {
        const resolvedRoot = resolve(root);
        if (relativeQuery.length === 0) {
            return {
                directory: resolvedRoot,
                prefix: "",
                displayRoot: resolvedRoot
            };
        }
        return targetForPath(
            resolve(resolvedRoot, relativeQuery),
            relativeQuery,
            resolvedRoot
        );
    });
}

function targetForPath(
    target: string,
    query: string,
    displayRoot: string | null
): CompletionTarget {
    if (
        query.length === 0
        || hasTrailingSeparator(query)
        || endsWithDirectorySegment(query)
    ) {
        return {
            directory: target,
            prefix: "",
            displayRoot
        };
    }
    return {
        directory: dirname(target),
        prefix: basename(target),
        displayRoot
    };
}

async function entriesFor(
    target: CompletionTarget
): Promise<JarvixPathCompletion[]> {
    let entries;
    try {
        entries = await readdir(target.directory, { withFileTypes: true });
    } catch {
        return [];
    }

    const prefix = process.platform === "win32"
        ? target.prefix.toLowerCase()
        : target.prefix;
    const includeHidden = target.prefix.startsWith(".");
    const results: JarvixPathCompletion[] = [];
    for (const entry of entries) {
        if (!includeHidden && entry.name.startsWith(".")) {
            continue;
        }
        const comparableName = process.platform === "win32"
            ? entry.name.toLowerCase()
            : entry.name;
        if (prefix.length > 0 && !comparableName.startsWith(prefix)) {
            continue;
        }

        const kind: JarvixPathKind = entry.isDirectory() ? "directory" : "file";
        const path = resolve(target.directory, entry.name);
        results.push({
            path,
            relativePath: displayPath(path, target.displayRoot),
            name: entry.name,
            kind
        });
        if (results.length >= PATH_COMPLETION_LIMIT) {
            break;
        }
    }
    return results;
}

function displayPath(path: string, root: string | null): string {
    if (root === null) {
        return path;
    }
    const value = relative(root, path);
    return value.length === 0
        || value === ".."
        || value.startsWith(`..${sep}`)
        || isAbsolute(value)
        ? path
        : `./${portablePath(value)}`;
}

function expandHome(query: string): string {
    if (query === "~") {
        return homedir();
    }
    if (/^~[\\/]/u.test(query)) {
        return resolve(homedir(), normalizeQuerySeparators(query.slice(2)));
    }
    return query;
}

function hasTrailingSeparator(value: string): boolean {
    return value.endsWith("/") || value.endsWith("\\");
}

function endsWithDirectorySegment(value: string): boolean {
    const normalized = value.replace(/[\\/]+$/u, "");
    return normalized === "."
        || normalized === ".."
        || normalized.endsWith("/.")
        || normalized.endsWith("/..");
}

function normalizeQuerySeparators(value: string): string {
    return value.replace(/\\/gu, "/");
}

function isAbsoluteQuery(value: string): boolean {
    return process.platform === "win32"
        ? /^[A-Za-z]:\//u.test(value) || value.startsWith("//")
        : value.startsWith("/");
}

function isAmbiguousRootPath(value: string): boolean {
    return process.platform !== "win32" && /^\/(?!\/)/u.test(value);
}

function stripRelativePrefix(value: string): string {
    let result = value;
    while (true) {
        if (result.startsWith("./")) {
            result = result.slice(2);
            continue;
        }
        if (result === ".") {
            return "";
        }
        if (result.startsWith("/")) {
            result = result.slice(1);
            continue;
        }
        return result;
    }
}

function portablePath(value: string): string {
    return value.replace(/\\/gu, "/");
}

function comparablePath(path: string): string {
    const normalized = process.platform === "win32"
        ? resolve(path).toLowerCase()
        : resolve(path);
    const root = parse(normalized).root;
    return normalized.length > root.length
        ? normalized.replace(/[\\/]+$/u, "")
        : normalized;
}

function comparableDisplayPath(path: string): string {
    const normalized = portablePath(path);
    return process.platform === "win32"
        ? normalized.toLowerCase()
        : normalized;
}

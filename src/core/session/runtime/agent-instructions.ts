import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep
} from "node:path";
import type {
    LlmSystemMessage,
    LlmToolCallBlock
} from "../../../protocol/llm.ts";
import { patchWriteTargets } from "../../../runtime/tools/apply-patch/apply-patch-engine.ts";
import { parseApplyPatch } from "../../../runtime/tools/apply-patch/apply-patch-parser.ts";

const AGENTS_FILE_NAME = "AGENTS.md";
const GLOBAL_CONFIG_DIRECTORY = ".jarvix";

const AGENT_INSTRUCTIONS_GUIDANCE = [
    "AGENTS.md files apply to the directory tree rooted at their location.",
    "Jarvix loads the global and selected working-directory files once, in that order; more specific files may be appended after tools access their directories.",
    "Before operating on a directory below or outside the working directories, inspect any applicable AGENTS.md file that has not already been provided.",
    "When instructions conflict, prefer the more specific directory scope."
].join("\n");

export type AgentInstructionScope = "global" | "project" | "directory";

export type AgentInstructionSource = {
    path: string;
    scope: AgentInstructionScope;
    content: string;
};

export type AgentInstructionsOptions = {
    homeDirectory?: string;
};

/** Loads stable AGENTS.md context once and appends newly relevant files on demand. */
export class AgentInstructions {
    private readonly homeDirectory: string;
    private readonly staticPaths = new Set<string>();
    private readonly loadedPaths = new Set<string>();
    private staticKey: string | null = null;
    private staticPrompt: string | null = null;

    constructor(options: AgentInstructionsOptions = {}) {
        this.homeDirectory = options.homeDirectory ?? homedir();
    }

    staticInstructions(workingDirectories: readonly string[] = []): string {
        const key = JSON.stringify(workingDirectories.map(pathKey));
        if (this.staticPrompt !== null && this.staticKey === key) {
            return this.staticPrompt;
        }

        this.staticPaths.clear();
        const sources: AgentInstructionSource[] = [];
        const globalPath = join(
            this.homeDirectory,
            GLOBAL_CONFIG_DIRECTORY,
            AGENTS_FILE_NAME
        );
        this.staticPaths.add(pathKey(globalPath));
        const global = readInstruction(globalPath, "global");
        if (global) {
            sources.push(global);
        }

        for (const directory of workingDirectories) {
            const projectPath = join(resolve(directory), AGENTS_FILE_NAME);
            const key = pathKey(projectPath);
            if (this.staticPaths.has(key)) {
                continue;
            }
            this.staticPaths.add(key);
            const project = readInstruction(projectPath, "project");
            if (project) {
                sources.push(project);
            }
        }

        this.staticPrompt = [
            "<agent_instructions>",
            AGENT_INSTRUCTIONS_GUIDANCE,
            ...sources.flatMap((source) => ["", renderInstruction(source)]),
            "</agent_instructions>"
        ].join("\n");
        this.staticKey = key;
        return this.staticPrompt;
    }

    discover(
        paths: readonly string[],
        workingDirectories: readonly string[] = []
    ): AgentInstructionSource[] {
        if (paths.length === 0 || workingDirectories.length === 0) {
            return [];
        }
        this.staticInstructions(workingDirectories);

        const candidates = new Map<string, string>();
        for (const path of paths) {
            const directory = directoryForPath(path);
            for (const candidate of applicableDirectories(directory, workingDirectories)) {
                const file = join(candidate, AGENTS_FILE_NAME);
                const key = pathKey(file);
                if (this.staticPaths.has(key) || this.loadedPaths.has(key)) {
                    continue;
                }
                candidates.set(key, file);
            }
        }

        const discovered: AgentInstructionSource[] = [];
        for (const [key, file] of candidates) {
            const source = readInstruction(file, "directory");
            if (!source) {
                continue;
            }
            this.loadedPaths.add(key);
            discovered.push(source);
        }
        return discovered;
    }
}

export function agentInstructionsMessage(
    sources: readonly AgentInstructionSource[]
): LlmSystemMessage {
    return {
        role: "system",
        content: [
            "<agent_instructions_update>",
            "Additional AGENTS.md instructions apply to directories accessed by the latest tools.",
            ...sources.flatMap((source) => ["", renderInstruction(source)]),
            "</agent_instructions_update>"
        ].join("\n"),
        context: "agent-instructions",
        timestamp: Date.now()
    };
}

/** Resolve the filesystem paths a tool call may operate on. */
export function agentInstructionPathsForToolCall(
    call: LlmToolCallBlock,
    workingDirectories: readonly string[] = []
): string[] {
    const defaultCwd = resolve(workingDirectories[0] ?? process.cwd());
    const arguments_ = call.arguments;
    const paths = new Map<string, string>();
    const add = (path: string): void => {
        const resolved = resolve(defaultCwd, path);
        paths.set(pathKey(resolved), resolved);
    };
    const configuredCwd = typeof arguments_.cwd === "string"
        && arguments_.cwd.trim().length > 0
        ? resolve(defaultCwd, arguments_.cwd)
        : defaultCwd;

    if (call.name === "exec_command") {
        add(configuredCwd);
        if (typeof arguments_.command === "string") {
            for (const path of shellCommandPaths(arguments_.command)) {
                add(path);
            }
        }
    } else if (call.name === "apply_patch") {
        add(configuredCwd);
        if (typeof arguments_.patch === "string") {
            try {
                const patch = parseApplyPatch(arguments_.patch);
                for (const target of patchWriteTargets(patch, configuredCwd)) {
                    add(target.path);
                }
            } catch {
                // Invalid patches are reported by the tool itself.
            }
        }
    } else if (call.name === "view_image" && typeof arguments_.path === "string") {
        add(arguments_.path);
    } else if (call.name === "request_permission") {
        const directories = arguments_.directories;
        if (Array.isArray(directories)) {
            for (const directory of directories) {
                if (
                    typeof directory === "object"
                    && directory !== null
                    && "path" in directory
                    && typeof directory.path === "string"
                ) {
                    add(directory.path);
                }
            }
        }
    }

    return [...paths.values()];
}

function renderInstruction(source: AgentInstructionSource): string {
    return [
        `<agents_md scope="${source.scope}" path="${escapeAttribute(source.path)}">`,
        source.content,
        "</agents_md>"
    ].join("\n");
}

function shellCommandPaths(command: string): string[] {
    const paths = new Set<string>();
    const tokenPattern = /"([^"]*)"|'([^']*)'|([^\s"'`]+)/g;
    for (const match of command.matchAll(tokenPattern)) {
        let value = match[1] ?? match[2] ?? match[3] ?? "";
        if (value.startsWith("--") && value.includes("=")) {
            value = value.slice(value.indexOf("=") + 1);
        }
        value = trimCommandPath(value);
        if (!isPathLike(value)) {
            continue;
        }
        paths.add(expandHomePath(value));
    }
    return [...paths];
}

function isPathLike(value: string): boolean {
    if (value.length === 0 || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        return false;
    }
    return /^[a-z]:[\\/]/i.test(value)
        || value.startsWith("/")
        || value.startsWith("\\")
        || value.startsWith("~/")
        || value.startsWith("~\\")
        || value.includes("/")
        || value.includes("\\");
}

function trimCommandPath(value: string): string {
    return value.replace(/^[([{]+/, "").replace(/[)\]}.,;:]+$/, "");
}

function expandHomePath(value: string): string {
    if (value === "~") {
        return homedir();
    }
    if (value.startsWith("~/") || value.startsWith("~\\")) {
        return join(homedir(), value.slice(2));
    }
    return value;
}

function readInstruction(
    path: string,
    scope: AgentInstructionScope
): AgentInstructionSource | null {
    try {
        const content = readFileSync(path, "utf8")
            .replace(/^\uFEFF/, "")
            .replace(/\r\n?/g, "\n")
            .trim();
        if (content.length === 0) {
            return null;
        }
        return {
            path: resolve(path),
            scope,
            content
        };
    } catch {
        return null;
    }
}

function directoryForPath(path: string): string {
    const resolved = resolve(path);
    try {
        return statSync(resolved).isDirectory()
            ? resolved
            : dirname(resolved);
    } catch {
        return dirname(resolved);
    }
}

function applicableDirectories(
    directory: string,
    workingDirectories: readonly string[]
): string[] {
    const root = containingWorkingDirectory(directory, workingDirectories);
    const directories: string[] = [];
    let current = directory;

    while (true) {
        if (root && pathKey(current) === pathKey(root)) {
            break;
        }
        directories.push(current);
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return directories.reverse();
}

function containingWorkingDirectory(
    directory: string,
    workingDirectories: readonly string[]
): string | null {
    let match: string | null = null;
    for (const workingDirectory of workingDirectories) {
        const root = resolve(workingDirectory);
        if (!isWithin(root, directory)) {
            continue;
        }
        if (!match || root.length > match.length) {
            match = root;
        }
    }
    return match;
}

function isWithin(root: string, target: string): boolean {
    const path = relative(root, target);
    return path === ""
        || (
            path !== ".."
            && !path.startsWith(`..${sep}`)
            && !isAbsolute(path)
        );
}

function pathKey(path: string): string {
    const resolved = resolve(path);
    return process.platform === "win32"
        ? resolved.toLowerCase()
        : resolved;
}

function escapeAttribute(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("\"", "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

import {
    readFileSync,
    readdirSync,
    statSync
} from "node:fs";
import { homedir } from "node:os";
import {
    basename,
    join,
    resolve
} from "node:path";
import type { Dirent } from "node:fs";
import { load } from "js-yaml";
import type { LlmSystemMessage } from "../../protocol/llm.ts";
import type {
    JarvixSkill,
    JarvixSkillListScope,
    JarvixSkillScope,
    JarvixSkillSettings,
    JarvixSkillSource
} from "../../protocol/skill.ts";
import { isValidSkillName } from "../../protocol/skill.ts";

const SKILL_FILE_NAME = "SKILL.md";
const JARVIX_DIRECTORY = ".jarvix";
const AGENTS_DIRECTORY = ".agents";
const SKILLS_DIRECTORY = "skills";
const MAX_SKILLS = 2_000;
const MAX_SKILL_DESCRIPTION_LENGTH = 1_024;

type SkillRoot = {
    path: string;
    scope: JarvixSkillScope;
    source: JarvixSkillSource;
    priority: number;
};

type ParsedSkillDocument = {
    name: string;
    description: string;
    body: string;
    disableModelInvocation: boolean;
};

export type SkillCatalogOptions = {
    homeDirectory?: string;
    settings?: () => JarvixSkillSettings;
};

export class SkillCatalog {
    private readonly homeDirectory: string;
    private readonly settings: () => JarvixSkillSettings;

    constructor(options: SkillCatalogOptions = {}) {
        this.homeDirectory = options.homeDirectory ?? homedir();
        this.settings = options.settings ?? (() => ({}));
    }

    discover(
        workingDirectories: readonly string[] = [],
        scope: JarvixSkillListScope = "all"
    ): JarvixSkill[] {
        const settings = this.settings();
        const selected = new Map<string, JarvixSkill & { priority: number }>();

        for (const root of skillRoots(workingDirectories, this.homeDirectory)) {
            if (scope !== "all" && root.scope !== scope) {
                continue;
            }
            for (const skill of discoverRoot(root, settings)) {
                const existing = selected.get(skill.name);
                if (!existing || root.priority > existing.priority) {
                    selected.set(skill.name, {
                        ...skill,
                        priority: root.priority
                    });
                }
            }
        }

        return [...selected.values()]
            .map(({ priority: _priority, ...skill }) => skill)
            .sort((left, right) => (
                scopeOrder(left.scope) - scopeOrder(right.scope)
                || left.name.localeCompare(right.name)
            ));
    }

    read(skill: JarvixSkill): string {
        const content = readFileSync(skill.location, "utf8");
        const parsed = parseSkillDocument(content);
        if (!parsed) {
            throw new Error(`Invalid skill: ${skill.location}`);
        }
        return parsed.body;
    }
}

export function skillRootDirectories(
    workingDirectories: readonly string[] = [],
    homeDirectory = homedir()
): string[] {
    return skillRoots(workingDirectories, homeDirectory).map((root) => root.path);
}

export function availableSkillsMessage(
    skills: readonly JarvixSkill[]
): LlmSystemMessage | null {
    const available = skills.filter((skill) => skill.modelInvocable);
    if (available.length === 0) {
        return null;
    }
    return {
        role: "system",
        content: [
            "<available_skills>",
            "The following skills provide specialized instructions for specific tasks.",
            "When a task matches a skill's description, use exec_command to read the SKILL.md at its location before proceeding.",
            "Resolve relative paths against the skill's directory, which is the parent of SKILL.md.",
            ...available.flatMap((skill) => [
                "",
                "<skill>",
                `<name>${escapeXml(skill.name)}</name>`,
                `<description>${escapeXml(skill.description)}</description>`,
                `<location>${escapeXml(skill.location)}</location>`,
                "</skill>"
            ]),
            "</available_skills>"
        ].join("\n"),
        context: "skills",
        timestamp: Date.now()
    };
}

export function skillContentMessage(
    skill: JarvixSkill,
    body: string
): LlmSystemMessage {
    return {
        role: "system",
        content: [
            `<skill_content name="${escapeAttribute(skill.name)}">`,
            body.trim(),
            "",
            `Skill directory: ${skill.directory}`,
            "Relative paths in this skill are relative to the skill directory.",
            "</skill_content>"
        ].join("\n"),
        context: "skill",
        timestamp: Date.now()
    };
}

function skillRoots(
    workingDirectories: readonly string[],
    homeDirectory: string
): SkillRoot[] {
    const roots: SkillRoot[] = [
        {
            path: join(homeDirectory, AGENTS_DIRECTORY, SKILLS_DIRECTORY),
            scope: "user",
            source: "agents",
            priority: 0
        },
        {
            path: join(homeDirectory, JARVIX_DIRECTORY, SKILLS_DIRECTORY),
            scope: "user",
            source: "jarvix",
            priority: 1
        }
    ];

    for (const directory of workingDirectories) {
        const workingDirectory = resolve(directory);
        roots.push(
            {
                path: join(workingDirectory, AGENTS_DIRECTORY, SKILLS_DIRECTORY),
                scope: "project",
                source: "agents",
                priority: 2
            },
            {
                path: join(workingDirectory, JARVIX_DIRECTORY, SKILLS_DIRECTORY),
                scope: "project",
                source: "jarvix",
                priority: 3
            }
        );
    }
    return roots;
}

function discoverRoot(
    root: SkillRoot,
    settings: JarvixSkillSettings
): JarvixSkill[] {
    let entries: Dirent[];
    try {
        entries = readdirSync(root.path, { withFileTypes: true });
    } catch {
        return [];
    }

    const skills: JarvixSkill[] = [];
    for (const entry of entries) {
        if (skills.length >= MAX_SKILLS) {
            break;
        }
        if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) {
            continue;
        }
        const directory = resolve(root.path, entry.name);
        const location = join(directory, SKILL_FILE_NAME);
        let content: string;
        try {
            if (!statSync(location).isFile()) {
                continue;
            }
            content = readFileSync(location, "utf8");
        } catch {
            continue;
        }
        const parsed = parseSkillDocument(content);
        if (!parsed) {
            continue;
        }
        const directoryName = basename(directory);
        const nameMatchesDirectory = parsed.name === directoryName;
        const enabled = settings[location] ?? nameMatchesDirectory;
        skills.push({
            name: parsed.name,
            description: parsed.description,
            location,
            directory,
            directoryName,
            scope: root.scope,
            source: root.source,
            disableModelInvocation: parsed.disableModelInvocation,
            nameMatchesDirectory,
            enabled,
            modelInvocable: enabled && !parsed.disableModelInvocation
        });
    }
    return skills;
}

function parseSkillDocument(content: string): ParsedSkillDocument | null {
    const normalized = content
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n");
    const frontmatter = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (!frontmatter) {
        return null;
    }

    let metadata: unknown;
    try {
        metadata = load(frontmatter[1] ?? "");
    } catch {
        return null;
    }
    if (!isRecord(metadata)) {
        return null;
    }
    const name = stringField(metadata.name);
    const description = stringField(metadata.description);
    if (
        !name
        || !description
        || !isValidSkillName(name)
        || description.length > MAX_SKILL_DESCRIPTION_LENGTH
    ) {
        return null;
    }
    const nestedMetadata = isRecord(metadata.metadata)
        ? metadata.metadata
        : {};
    return {
        name,
        description,
        body: normalized.slice(frontmatter[0].length).trim(),
        disableModelInvocation: (
            metadata["disable-model-invocation"] === true
            || nestedMetadata["disable-model-invocation"] === true
        )
    };
}

function shouldSkipDirectory(name: string): boolean {
    return name === ".git" || name === "node_modules";
}

function stringField(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
    return escapeXml(value).replaceAll("\"", "&quot;");
}

function scopeOrder(scope: JarvixSkillScope): number {
    return scope === "user" ? 0 : 1;
}

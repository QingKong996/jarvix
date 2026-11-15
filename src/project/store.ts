import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
    createProjectInputSchema,
    jarvixProjectSchema,
    type JarvixProject
} from "../protocol/project.ts";

export const PROJECT_FORMAT_VERSION = 1;

const PROJECT_FILE_EXTENSION = ".json";
const PROJECT_FILE_MODE = 0o600;

export function projectFile(id: string, directory = defaultProjectDirectory()): string {
    return join(directory, `${id}${PROJECT_FILE_EXTENSION}`);
}

export function createProject(
    name: string,
    workingDirectories: readonly string[],
    directory = defaultProjectDirectory()
): JarvixProject {
    const input = createProjectInputSchema.parse({ name, workingDirectories });
    const project = jarvixProjectSchema.parse({
        type: "project",
        version: PROJECT_FORMAT_VERSION,
        id: randomUUID(),
        name: input.name,
        workingDirectories: normalizeWorkingDirectories(input.workingDirectories),
        createdAt: Date.now()
    });

    mkdirSync(directory, { recursive: true });
    writeFileSync(projectFile(project.id, directory), serializeProject(project), {
        encoding: "utf8",
        mode: PROJECT_FILE_MODE
    });
    return project;
}

export function loadProject(id: string, directory = defaultProjectDirectory()): JarvixProject | null {
    try {
        return parseProject(JSON.parse(readFileSync(projectFile(id, directory), "utf8")));
    } catch {
        return null;
    }
}

export function listProjects(directory = defaultProjectDirectory()): JarvixProject[] {
    let entries: string[];
    try {
        entries = readdirSync(directory);
    } catch {
        return [];
    }

    const projects: JarvixProject[] = [];
    for (const entry of entries) {
        if (!entry.endsWith(PROJECT_FILE_EXTENSION)) {
            continue;
        }
        const file = join(directory, entry);
        try {
            if (!statSync(file).isFile()) {
                continue;
            }
            const project = parseProject(JSON.parse(readFileSync(file, "utf8")));
            if (project && `${project.id}${PROJECT_FILE_EXTENSION}` === entry) {
                projects.push(project);
            }
        } catch {
            continue;
        }
    }

    return projects.sort((left, right) => right.createdAt - left.createdAt);
}

function defaultProjectDirectory(): string {
    return join(homedir(), ".jarvix", "projects");
}

function normalizeWorkingDirectories(workingDirectories: readonly string[]): string[] {
    const directories = workingDirectories
        .map((directory) => directory.trim())
        .filter((directory) => directory.length > 0)
        .map((directory) => resolve(directory));
    return [...new Set(directories)];
}

function serializeProject(project: JarvixProject): string {
    return `${JSON.stringify(project)}\n`;
}

function parseProject(value: unknown): JarvixProject | null {
    const parsed = jarvixProjectSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

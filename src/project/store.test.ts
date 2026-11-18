import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";
import {
    PROJECT_FORMAT_VERSION,
    createProject,
    listProjects,
    loadProject,
    projectFile
} from "./store.ts";

const base = mkdtempSync(join(tmpdir(), "jarvix-project-"));

afterAll(() => {
    rmSync(base, { recursive: true, force: true });
});

test("creates and loads a project with normalized working directories", () => {
    const directory = join(base, "create");
    const firstDirectory = join(base, "workspace-a");
    const secondDirectory = join(base, "workspace-b");
    const project = createProject(
        " Jarvix ",
        [firstDirectory, secondDirectory, firstDirectory],
        directory
    );

    expect(project.type).toBe("project");
    expect(project.version).toBe(PROJECT_FORMAT_VERSION);
    expect(project.name).toBe("Jarvix");
    expect(project.workingDirectories).toEqual([
        resolve(firstDirectory),
        resolve(secondDirectory)
    ]);
    expect(project.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(readFileSync(projectFile(project.id, directory), "utf8")).toBe(`${JSON.stringify(project)}\n`);
    expect(loadProject(project.id, directory)).toEqual(project);
    expect(listProjects(directory)).toEqual([project]);
});

test.each([
    "",
    ".",
    "..",
    "../outside",
    "..\\outside",
    "nested/project",
    "nested\\project",
    "invalid\u0000id",
    "CON",
    " CON "
])("projectFile rejects unsafe id %j", (id) => {
    expect(() => projectFile(id, base)).toThrow("Invalid project id");
});

test("lists only valid project files", () => {
    const directory = join(base, "list");
    const first = createProject("First", [join(base, "first")], directory);
    const second = createProject("Second", [join(base, "second")], directory);
    mkdirSync(join(directory, "decoy.json"));
    writeFileSync(join(directory, "broken.json"), "{not json", "utf8");

    expect(listProjects(directory).map((project) => project.id).sort()).toEqual([first.id, second.id].sort());
    expect(listProjects(join(base, "missing"))).toEqual([]);
});

test("rejects projects without a name or working directory", () => {
    const directory = join(base, "invalid");

    expect(() => createProject(" ", [join(base, "workspace")], directory))
        .toThrow("Project name must be non-empty");
    expect(() => createProject("Project", [], directory))
        .toThrow("Project must have at least one working directory");
});

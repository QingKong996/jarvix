import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { completePaths } from "./path-completion.ts";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("completes relative path segments with directories first", async () => {
    const root = workspace();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "main.ts"), "");
    writeFileSync(join(root, "README.md"), "");
    writeFileSync(join(root, ".env"), "");

    const result = await completePaths("", { workingDirectory: root });

    expect(result.entries.map((entry) => entry.name)).toEqual(["src", "README.md"]);
    expect(result.entries[0]).toMatchObject({
        kind: "directory",
        path: join(root, "src"),
        relativePath: "./src"
    });
});

test("filters the current segment and lists directory children after a separator", async () => {
    const root = workspace();
    mkdirSync(join(root, "src", "components"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "");
    writeFileSync(join(root, "src", "module.ts"), "");

    const filtered = await completePaths("src/m", { workingDirectory: root });
    expect(filtered.entries.map((entry) => entry.name)).toEqual(["main.ts", "module.ts"]);

    const children = await completePaths(`src${separator()}`, { workingDirectory: root });
    expect(children.entries.map((entry) => entry.name))
        .toEqual(["components", "main.ts", "module.ts"]);
});

test("completes absolute paths outside the working directory", async () => {
    const root = workspace();
    const external = workspace();
    writeFileSync(join(external, "outside.txt"), "");

    const query = join(external, "out");
    const result = await completePaths(query, { workingDirectory: root });

    expect(result.entries).toEqual([{
        path: join(external, "outside.txt"),
        relativePath: join(external, "outside.txt"),
        name: "outside.txt",
        kind: "file"
    }]);
});

test("uses ./ display for bare and root-relative queries", async () => {
    const root = workspace();
    const name = `abc-${randomUUID()}`;
    mkdirSync(join(root, name));

    const queries = [
        name,
        `./${name}`,
        `.\\${name}`,
        `/${name}`,
        `\\${name}`
    ];
    for (const query of queries) {
        const result = await completePaths(query, { workingDirectory: root });
        expect(result.entries).toContainEqual({
            path: join(root, name),
            relativePath: `./${name}`,
            name,
            kind: "directory"
        });
    }
});

test("keeps absolute display for absolute queries inside the working directory", async () => {
    const root = workspace();
    const target = join(root, "src");
    mkdirSync(target);

    const result = await completePaths(target, { workingDirectory: root });

    expect(result.entries).toContainEqual({
        path: target,
        relativePath: target,
        name: "src",
        kind: "directory"
    });
});

test("treats dot segments as directory queries", async () => {
    const parent = workspace();
    const root = join(parent, "workspace");
    mkdirSync(root);
    writeFileSync(join(root, "child.txt"), "");
    writeFileSync(join(parent, "sibling.txt"), "");

    for (const query of [".", "./", "..", "../"]) {
        const result = await completePaths(query, { workingDirectory: root });
        const names = new Set(result.entries.map((entry) => entry.name));
        if (query.startsWith("..")) {
            expect(names).toContain("workspace");
            expect(names).toContain("sibling.txt");
        } else {
            expect(names).toContain("child.txt");
            expect(names).not.toContain("sibling.txt");
        }
    }
});

test("filters hidden entries unless the current segment starts with a dot", async () => {
    const root = workspace();
    writeFileSync(join(root, ".env"), "");
    writeFileSync(join(root, ".env.local"), "");
    writeFileSync(join(root, "environment.txt"), "");

    const visible = await completePaths("en", { workingDirectory: root });
    expect(visible.entries.map((entry) => entry.name)).toEqual(["environment.txt"]);

    const hidden = await completePaths(".en", { workingDirectory: root });
    expect(hidden.entries.map((entry) => entry.name)).toEqual([
        ".env",
        ".env.local"
    ]);
});

test("returns no entries for missing directories", async () => {
    const root = workspace();

    await expect(completePaths("missing/child", {
        workingDirectory: root
    })).resolves.toEqual({ entries: [] });
    await expect(completePaths(join(root, "missing", "child"), {
        workingDirectory: root
    })).resolves.toEqual({ entries: [] });
});

test("caps completion results at the protocol limit", async () => {
    const root = workspace();
    for (let index = 0; index < 205; index += 1) {
        writeFileSync(join(root, `file-${index}.txt`), "");
    }

    const result = await completePaths("file-", { workingDirectory: root });

    expect(result.entries).toHaveLength(200);
    expect(new Set(result.entries.map((entry) => entry.name)).size).toBe(200);
    expect(result.entries.every((entry) => entry.name.startsWith("file-")))
        .toBe(true);
});

function workspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-path-completion-"));
    directories.push(directory);
    return resolve(directory);
}

function separator(): string {
    return process.platform === "win32" ? "\\" : "/";
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { authorizeSandboxRead, authorizeSandboxWrite } from "./path-access.ts";
import { createSandboxPolicy } from "./sandbox.ts";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test("read-only policies deny every write", () => {
    const directory = workspace();
    const policy = createSandboxPolicy("read-only", [directory]);

    const decision = authorizeSandboxWrite(policy, join(directory, "new.txt"));

    expect(decision).toMatchObject({
        allowed: false,
        reason: expect.stringContaining("no writable roots")
    });
});

test("project write policies allow descendants and deny paths outside them", () => {
    const directory = workspace();
    const policy = createSandboxPolicy("project-read-write", [directory]);

    expect(authorizeSandboxWrite(policy, join(directory, "nested", "new.txt")))
        .toMatchObject({ allowed: true });
    expect(authorizeSandboxWrite(policy, join(directory, "..", "outside.txt")))
        .toMatchObject({
            allowed: false,
            reason: expect.stringContaining("outside sandbox allowWrite roots")
        });
});

test("denyWrite rules take precedence over allowWrite roots", () => {
    const directory = workspace();
    const blocked = join(directory, "blocked");
    mkdirSync(blocked);
    const policy = createSandboxPolicy("auto-review", [directory]);
    policy!.filesystem.denyWrite.push(resolve(blocked));

    expect(authorizeSandboxWrite(policy, join(directory, "allowed.txt")))
        .toMatchObject({ allowed: true });
    expect(authorizeSandboxWrite(policy, join(blocked, "denied.txt")))
        .toMatchObject({
            allowed: false,
            reason: expect.stringContaining("denyWrite root")
        });
});

test("missing files are checked through their nearest existing ancestor", () => {
    const directory = workspace();
    writeFileSync(join(directory, "existing.txt"), "existing", "utf8");
    const policy = createSandboxPolicy("project-read-write", [directory]);

    expect(authorizeSandboxWrite(policy, join(directory, "missing", "deep", "file.txt")))
        .toMatchObject({ allowed: true });
});

test("full access bypasses sandbox path restrictions", () => {
    expect(authorizeSandboxWrite(null, join(tmpdir(), "anywhere.txt")))
        .toMatchObject({ allowed: true });
});

test("read access allows a more specific allowRead root", () => {
    const directory = workspace();
    const publicDirectory = join(directory, "public");
    mkdirSync(publicDirectory);
    const policy = createSandboxPolicy("read-only", [directory])!;
    policy.filesystem.denyRead.push({ path: directory, literal: true });
    policy.filesystem.allowRead = [{ path: publicDirectory, literal: true }];

    expect(authorizeSandboxRead(policy, join(publicDirectory, "photo.png")))
        .toMatchObject({ allowed: true });
    expect(authorizeSandboxRead(policy, join(directory, "private.png")))
        .toMatchObject({
            allowed: false,
            reason: expect.stringContaining("denyRead root")
        });
});

function workspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "jarvix-path-access-"));
    directories.push(directory);
    return directory;
}

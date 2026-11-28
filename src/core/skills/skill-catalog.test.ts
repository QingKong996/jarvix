import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { JarvixSkillSettings } from "../../protocol/skill.ts";
import {
    availableSkillsMessage,
    SkillCatalog,
    skillContentMessage
} from "./skill-catalog.ts";

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

test("discovers user and project skills with project precedence", () => {
    const root = tempRoot();
    const home = join(root, "home");
    const workspace = join(root, "workspace");
    writeSkill(
        join(home, ".agents", "skills", "user-skill"),
        "user-skill",
        "User skill"
    );
    writeSkill(
        join(home, ".jarvix", "skills", "native-skill"),
        "native-skill",
        "Native user skill"
    );
    writeSkill(
        join(home, ".agents", "skills", "shared"),
        "shared",
        "User shared skill"
    );
    writeSkill(
        join(workspace, ".jarvix", "skills", "project-skill"),
        "project-skill",
        "Project skill"
    );
    writeSkill(
        join(workspace, ".agents", "skills", "shared"),
        "shared",
        "Project shared skill"
    );

    const skills = new SkillCatalog({ homeDirectory: home }).discover([workspace]);

    expect(skills.map((skill) => skill.name)).toEqual([
        "native-skill",
        "user-skill",
        "project-skill",
        "shared"
    ]);
    expect(skills.find((skill) => skill.name === "shared")).toMatchObject({
        scope: "project",
        source: "agents",
        description: "Project shared skill"
    });
    expect(
        new SkillCatalog({ homeDirectory: home })
            .discover([workspace], "user")
            .map((skill) => skill.name)
    ).toEqual(["native-skill", "shared", "user-skill"]);
    expect(
        new SkillCatalog({ homeDirectory: home })
            .discover([workspace], "project")
            .map((skill) => skill.name)
    ).toEqual(["project-skill", "shared"]);
});

test("handles name mismatches, settings overrides, and manual-only skills", () => {
    const root = tempRoot();
    const home = join(root, "home");
    const mismatchDirectory = join(home, ".agents", "skills", "wrong-directory");
    const manualDirectory = join(home, ".agents", "skills", "manual-only");
    const location = writeSkill(
        mismatchDirectory,
        "actual-name",
        "Needs manual opt-in"
    );
    writeSkill(
        manualDirectory,
        "manual-only",
        "Never auto invoke",
        "disable-model-invocation: true\n"
    );
    let settings: JarvixSkillSettings = {};
    const catalog = new SkillCatalog({
        homeDirectory: home,
        settings: () => settings
    });

    const initial = catalog.discover([]);
    expect(initial.find((skill) => skill.name === "actual-name")).toMatchObject({
        nameMatchesDirectory: false,
        enabled: false,
        modelInvocable: false
    });
    expect(initial.find((skill) => skill.name === "manual-only")).toMatchObject({
        enabled: true,
        disableModelInvocation: true,
        modelInvocable: false
    });

    settings = {
        [location]: true
    };
    const enabled = catalog.discover([]);
    expect(enabled.find((skill) => skill.name === "actual-name")).toMatchObject({
        enabled: true,
        modelInvocable: true
    });

    const message = availableSkillsMessage(enabled);
    expect(message?.content).toContain("actual-name");
    expect(message?.content).not.toContain("manual-only");
    expect(message?.context).toBeUndefined();
    expect(skillContentMessage(enabled[0]!, "# Instructions")).toMatchObject({
        content: expect.stringContaining("# Instructions")
    });
    expect(catalog.read(enabled[0]!).trim()).toContain("# actual-name");
});

test("skips malformed and nonconforming skill files", () => {
    const root = tempRoot();
    const home = join(root, "home");
    writeFile(join(home, ".agents", "skills", "missing-name", "SKILL.md"), [
        "---",
        "description: Missing name",
        "---"
    ].join("\n"));
    writeFile(join(home, ".agents", "skills", "bad-yaml", "SKILL.md"), [
        "---",
        "name: bad-yaml",
        "description: [unterminated",
        "---"
    ].join("\n"));
    writeSkill(
        join(home, ".agents", "skills", "uppercase"),
        "Uppercase",
        "Invalid name"
    );
    writeSkill(
        join(home, ".agents", "skills", "double-hyphen"),
        "double--hyphen",
        "Invalid name"
    );
    writeSkill(
        join(home, ".agents", "skills", "long-description"),
        "long-description",
        "x".repeat(1_025)
    );

    expect(new SkillCatalog({ homeDirectory: home }).discover([])).toEqual([]);
});

function writeSkill(
    directory: string,
    name: string,
    description: string,
    extraFrontmatter = ""
): string {
    const location = join(directory, "SKILL.md");
    writeFile(location, [
        "---",
        `name: ${name}`,
        `description: ${description}`,
        ...extraFrontmatter.replace(/\n$/, "").split("\n").filter(Boolean),
        "---",
        "",
        `# ${name}`
    ].join("\n"));
    return resolve(location);
}

function writeFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
}

function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "jarvix-skills-"));
    roots.push(root);
    return root;
}

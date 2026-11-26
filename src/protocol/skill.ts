export type JarvixSkillScope = "user" | "project";

export type JarvixSkillSource = "jarvix" | "agents";

export type JarvixSkillListScope = JarvixSkillScope | "all";

export type JarvixSkill = {
    name: string;
    description: string;
    location: string;
    directory: string;
    directoryName: string;
    scope: JarvixSkillScope;
    source: JarvixSkillSource;
    disableModelInvocation: boolean;
    nameMatchesDirectory: boolean;
    enabled: boolean;
    modelInvocable: boolean;
};

export type JarvixSkillSettings = Record<string, boolean>;

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isValidSkillName(name: string): boolean {
    return name.length <= 64 && SKILL_NAME_PATTERN.test(name);
}

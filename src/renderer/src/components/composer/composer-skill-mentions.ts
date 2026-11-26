import type { JarvixSkill } from "../../../../protocol/skill.ts";

export const SKILL_MENTION_NODE_NAME = "skillMention";

export type SelectedSkillMention = {
    name: string;
    description: string;
};

export function skillMentionFor(skill: JarvixSkill): SelectedSkillMention {
    return {
        name: skill.name,
        description: skill.description
    };
}

export function serializedSkillMention(name: string): string {
    return `/${name}`;
}

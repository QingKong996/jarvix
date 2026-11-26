import type { TFunction } from "i18next";
import { Sparkles, Target, type LucideIcon } from "lucide-react";
import type { JarvixSkill } from "../../../../protocol/skill.ts";
import type { SlashCommand } from "./composer-commands.ts";

export type ComposerCommand = SlashCommand & {
    icon?: LucideIcon;
    hasSubmenu?: boolean;
    skill?: JarvixSkill;
};

export function composerCommands(
    t: TFunction,
    skills: readonly JarvixSkill[] = []
): ComposerCommand[] {
    const commands: ComposerCommand[] = [{
        id: "goal",
        label: t("composer.commands.goal.label"),
        description: t("composer.commands.goal.description"),
        keywords: ["goal", "objective", "target", "目标", "任务", "完成"],
        icon: Target
    }];
    const reservedIds = new Set(commands.map((command) => command.id));

    for (const skill of skills) {
        if (!skill.enabled || reservedIds.has(skill.name)) {
            continue;
        }
        reservedIds.add(skill.name);
        commands.push({
            id: skill.name,
            label: `/${skill.name}`,
            description: skill.description,
            icon: Sparkles,
            skill
        });
    }

    return commands;
}

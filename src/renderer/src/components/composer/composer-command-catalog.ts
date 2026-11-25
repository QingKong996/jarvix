import type { TFunction } from "i18next";
import { Target, type LucideIcon } from "lucide-react";
import type { SlashCommand } from "./composer-commands.ts";

export type ComposerCommand = SlashCommand & {
    icon?: LucideIcon;
    hasSubmenu?: boolean;
};

export function composerCommands(t: TFunction): ComposerCommand[] {
    return [{
        id: "goal",
        label: t("composer.commands.goal.label"),
        description: t("composer.commands.goal.description"),
        keywords: ["goal", "objective", "target", "目标", "任务", "完成"],
        icon: Target
    }];
}

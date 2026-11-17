import { useState } from "react";
import { AlertCircle, Check, Eye, FolderPen, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { PermissionMode } from "../../../../protocol/permission.ts";
import { Button } from "../ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "../ui/dropdown-menu.tsx";

type ComposerPermissionMenuProps = {
    permission: PermissionMode;
    disabled: boolean;
    saving: boolean;
    onChange(permission: PermissionMode): Promise<boolean>;
};

type PermissionOption = {
    icon: typeof Eye;
    label: string;
    description: string;
};

const PERMISSION_ORDER: readonly PermissionMode[] = [
    "read-only",
    "project-read-write",
    "full-access",
    "auto-review"
];

const PERMISSION_OPTIONS = {
    "read-only": {
        icon: Eye,
        label: "composer.permissions.options.readOnly.label",
        description: "composer.permissions.options.readOnly.description"
    },
    "project-read-write": {
        icon: FolderPen,
        label: "composer.permissions.options.projectReadWrite.label",
        description: "composer.permissions.options.projectReadWrite.description"
    },
    "full-access": {
        icon: AlertCircle,
        label: "composer.permissions.options.fullAccess.label",
        description: "composer.permissions.options.fullAccess.description"
    },
    "auto-review": {
        icon: ShieldCheck,
        label: "composer.permissions.options.autoReview.label",
        description: "composer.permissions.options.autoReview.description"
    }
} as const satisfies Record<PermissionMode, PermissionOption>;

export function ComposerPermissionMenu({
    permission,
    disabled,
    saving,
    onChange
}: ComposerPermissionMenuProps) {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState(false);
    const current = PERMISSION_OPTIONS[permission];
    const CurrentIcon = current.icon;
    const fullAccess = permission === "full-access";

    async function selectPermission(next: PermissionMode): Promise<void> {
        if (next === permission) {
            setMenuOpen(false);
            return;
        }
        if (await onChange(next)) {
            setMenuOpen(false);
        }
    }

    return (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || saving}
                    className={cn(
                        "h-8 min-w-0 max-w-36 shrink justify-start gap-1 px-2 text-xs font-normal",
                        fullAccess && "text-orange-600 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-400"
                    )}
                    title={`${t(current.label)}: ${t(current.description)}`}
                >
                    <CurrentIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{t(current.label)}</span>
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                collisionPadding={8}
                className="w-80 max-w-[calc(100vw-2rem)] p-1.5"
            >
                <div className="px-2 pt-1 pb-2 text-[13px] text-muted-foreground">
                    {t("composer.permissions.title")}
                </div>
                <DropdownMenuSeparator className="mx-0" />

                {PERMISSION_ORDER.map((value) => {
                    const option = PERMISSION_OPTIONS[value];
                    const Icon = option.icon;
                    const selected = value === permission;
                    return (
                        <DropdownMenuItem
                            key={value}
                            role="menuitemradio"
                            aria-checked={selected}
                            disabled={saving}
                            onSelect={(event) => {
                                event.preventDefault();
                                void selectPermission(value);
                            }}
                            className={cn(
                                "items-start gap-2.5 rounded-lg px-2.5 py-2.5",
                                selected && "text-orange-600 focus:text-orange-600 dark:text-orange-400 dark:focus:text-orange-400"
                            )}
                        >
                            <Icon className="mt-0.5 size-4 shrink-0" />
                            <span className="min-w-0 flex-1">
                                <span className="block text-xs font-medium">{t(option.label)}</span>
                                <span
                                    className={cn(
                                        "mt-0.5 block text-[11px] leading-4 text-muted-foreground",
                                        selected && "text-orange-600/75 dark:text-orange-400/75"
                                    )}
                                >
                                    {t(option.description)}
                                </span>
                            </span>
                            {selected ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

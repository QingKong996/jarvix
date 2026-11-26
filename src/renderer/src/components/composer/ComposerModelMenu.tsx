import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixConfig } from "../../../../protocol/config.ts";
import {
    availableReasoningLevels,
    resolveConfiguredModel,
    resolveReasoningLevel,
    type ReasoningLevel
} from "../../../../protocol/providers.ts";
import { Button } from "../ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "../ui/dropdown-menu.tsx";
import { providerGroupsFor, type ComposerModel } from "./composer-models.ts";

type ComposerModelMenuProps = {
    config: JarvixConfig | null;
    disabled: boolean;
    saving: boolean;
    onSave(config: JarvixConfig): Promise<boolean>;
};

type MenuView = "root" | "model" | "reasoning";

export function ComposerModelMenu({ config, disabled, saving, onSave }: ComposerModelMenuProps) {
    const { t } = useTranslation();
    const resolved = resolveConfiguredModel(config?.providers, config?.selectedModel);
    const selection = resolved?.selection;
    const providerGroups = providerGroupsFor(config);
    const selectedModel = selection
        ? providerGroups
            .flatMap((provider) => provider.models)
            .find((item) => item.selection.provider === selection.provider && item.selection.id === selection.id)
        : undefined;
    const model = selectedModel?.name ?? selection?.id ?? "";
    const reasoningLevels = selectedModel ? availableReasoningLevels(selectedModel) : [];
    const reasoningLevel = selectedModel ? resolveReasoningLevel(selectedModel, config?.reasoning) : undefined;
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuView, setMenuView] = useState<MenuView>("root");
    const firstMenuItemRef = useRef<HTMLDivElement>(null);
    const reasoningLabel = reasoningLevel ? t(`composer.reasoningLevels.${reasoningLevel}`) : "";
    const triggerLabel = [model, reasoningLabel].filter(Boolean).join(" ") || t("composer.model");

    useLayoutEffect(() => {
        if (menuOpen) {
            firstMenuItemRef.current?.focus();
        }
    }, [menuOpen, menuView]);

    function handleMenuOpenChange(next: boolean): void {
        setMenuOpen(next);
        if (next) {
            setMenuView("root");
        }
    }

    function showMenuView(event: Event, view: MenuView): void {
        event.preventDefault();
        setMenuView(view);
    }

    async function selectModel(next: ComposerModel): Promise<void> {
        if (!config) return;
        const reasoning = resolveReasoningLevel(next, config.reasoning);
        if (reasoning) {
            if (await onSave({ ...config, selectedModel: next.selection, reasoning })) {
                setMenuOpen(false);
            }
            return;
        }
        const { reasoning: _reasoning, ...withoutReasoning } = config;
        if (await onSave({ ...withoutReasoning, selectedModel: next.selection })) {
            setMenuOpen(false);
        }
    }

    async function selectReasoningLevel(next: ReasoningLevel): Promise<void> {
        if (config && await onSave({ ...config, reasoning: next })) {
            setMenuOpen(false);
        }
    }

    return (
        <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || !config || saving}
                    data-testid="model-menu-trigger"
                    aria-label={triggerLabel}
                    className="h-8 min-w-0 max-w-72 shrink justify-start gap-1.5 px-2.5 text-[13px] font-normal text-muted-foreground hover:text-foreground"
                    title={triggerLabel}
                >
                    <span className="min-w-0 truncate text-foreground">{model || t("composer.model")}</span>
                    {reasoningLabel ? (
                        <span className="shrink-0 text-muted-foreground">{reasoningLabel}</span>
                    ) : null}
                    <ChevronUp className="size-3.5 shrink-0 opacity-60" />
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                side="top"
                align="end"
                sideOffset={8}
                className="max-h-80 min-w-56 overflow-y-auto"
            >
                {menuView === "root" ? (
                    <>
                        <DropdownMenuItem
                            ref={firstMenuItemRef}
                            onSelect={(event) => showMenuView(event, "model")}
                        >
                            {t("composer.model")}
                            <span className="ml-auto text-muted-foreground">{model}</span>
                            <ChevronRight className="size-3.5 opacity-60" />
                        </DropdownMenuItem>

                        {reasoningLevels.length > 0 ? (
                            <DropdownMenuItem onSelect={(event) => showMenuView(event, "reasoning")}>
                                {t("composer.reasoning")}
                                <span className="ml-auto text-muted-foreground">{reasoningLabel}</span>
                                <ChevronRight className="size-3.5 opacity-60" />
                            </DropdownMenuItem>
                        ) : null}
                    </>
                ) : (
                    <>
                        <DropdownMenuItem
                            ref={firstMenuItemRef}
                            className="text-muted-foreground"
                            onSelect={(event) => showMenuView(event, "root")}
                        >
                            <ChevronLeft className="size-3.5" />
                            {menuView === "model" ? t("composer.model") : t("composer.reasoning")}
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        {menuView === "model"
                            ? providerGroups.map((provider, index) => (
                                <Fragment key={provider.id}>
                                    {index > 0 ? <DropdownMenuSeparator /> : null}
                                    <DropdownMenuLabel>{provider.name}</DropdownMenuLabel>
                                    {provider.models.map((option) => (
                                        <DropdownMenuItem
                                            key={`${option.selection.provider}/${option.selection.id}`}
                                            disabled={saving}
                                            onSelect={(event) => {
                                                event.preventDefault();
                                                void selectModel(option);
                                            }}
                                        >
                                            {option.name}
                                            {option.selection.provider === selection?.provider
                                            && option.selection.id === selection?.id
                                                ? <Check className="ml-auto size-4 text-foreground" />
                                                : null}
                                        </DropdownMenuItem>
                                    ))}
                                </Fragment>
                            ))
                            : reasoningLevels.map((level) => (
                                <DropdownMenuItem
                                    key={level}
                                    disabled={saving}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        void selectReasoningLevel(level);
                                    }}
                                >
                                    {t(`composer.reasoningLevels.${level}`)}
                                    {level === reasoningLevel ? (
                                        <Check className="ml-auto size-4 text-foreground" />
                                    ) : null}
                                </DropdownMenuItem>
                            ))}
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

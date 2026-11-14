import { Fragment, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronUp, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { JarvixConfig } from "../../../protocol/config.ts";
import {
    DEFAULT_MODEL as DEFAULT_MODEL_REF,
    availableReasoningLevels,
    resolveConfiguredModel,
    resolveReasoningLevel,
    type ModelDefinition,
    type ModelSelection,
    type ReasoningLevel
} from "../../../protocol/providers.ts";

type ComposerProps = {
    disabled: boolean;
    onSubmit: (question: string) => void;
    config: JarvixConfig | null;
    onConfigChange: (config: JarvixConfig) => Promise<void>;
};

type MenuView = "root" | "model" | "reasoning";

type ComposerModel = {
    selection: ModelSelection;
    name: string;
    reasoning: boolean;
    reasoningLevels?: ModelDefinition["reasoningLevels"];
};

type ProviderGroup = {
    id: string;
    name: string;
    models: ComposerModel[];
};

export function Composer({ disabled, onSubmit, config, onConfigChange }: ComposerProps) {
    const { t } = useTranslation();
    const [value, setValue] = useState("");
    const resolved = resolveConfiguredModel(config?.providers, config?.selectedModel);
    const selection = resolved?.selection ?? config?.selectedModel ?? DEFAULT_MODEL_REF;
    const providerGroups = providerGroupsFor(config);
    const selectedModel = providerGroups
        .flatMap((provider) => provider.models)
        .find((item) => item.selection.provider === selection.provider && item.selection.id === selection.id);
    const model = selectedModel?.name ?? (
        selection.provider === DEFAULT_MODEL_REF.provider && selection.id === DEFAULT_MODEL_REF.id
            ? "DeepSeek V4.1 Flash"
            : selection.id
    );
    const reasoningLevels = availableReasoningLevels(selectedModel);
    const reasoningLevel = resolveReasoningLevel(selectedModel, config?.reasoning);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuView, setMenuView] = useState<MenuView>("root");
    const firstMenuItemRef = useRef<HTMLDivElement>(null);

    const reasoningLabel = reasoningLevel ? t(`composer.reasoningLevels.${reasoningLevel}`) : "";

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

    async function save(next: JarvixConfig): Promise<void> {
        setSaving(true);
        setError("");
        try {
            await onConfigChange(next);
            setMenuOpen(false);
        } catch (cause) {
            setError(String(cause));
        } finally {
            setSaving(false);
        }
    }

    function selectModel(next: ComposerModel): void {
        if (!config) return;
        const reasoning = resolveReasoningLevel(next, config.reasoning);
        if (reasoning) {
            void save({ ...config, selectedModel: next.selection, reasoning });
            return;
        }
        const { reasoning: _reasoning, ...withoutReasoning } = config;
        void save({ ...withoutReasoning, selectedModel: next.selection });
    }

    function selectReasoningLevel(next: ReasoningLevel): void {
        if (config) void save({ ...config, reasoning: next });
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        const question = value.trim();
        if (!question || disabled || saving) {
            return;
        }
        setValue("");
        onSubmit(question);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) {
            return;
        }

        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
    }

    return (
        <form onSubmit={handleSubmit} className="px-14 py-3">
            <div className="flex flex-col gap-1 rounded-xl border bg-card p-1.5 shadow-sm transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                <Textarea
                    rows={1}
                    autoComplete="off"
                    autoFocus
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t("composer.placeholder")}
                    className="max-h-48 min-h-8 w-full resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
                />

                <div className="flex items-center justify-end gap-1">
                    <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={disabled || !config || saving}
                                className="h-8 gap-1 px-2 text-xs font-normal"
                            >
                                {model}
                                {reasoningLabel ? (
                                    <span className="text-muted-foreground">{reasoningLabel}</span>
                                ) : null}
                                <ChevronUp className="size-3.5 opacity-60" />
                            </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent side="top" align="end" sideOffset={8} className="max-h-80 min-w-56 overflow-y-auto">
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
                                                              selectModel(option);
                                                          }}
                                                      >
                                                          {option.name}
                                                          {option.selection.provider === selection.provider
                                                          && option.selection.id === selection.id
                                                              ? <Check className="ml-auto size-3.5" />
                                                              : null}
                                                      </DropdownMenuItem>
                                                  ))}
                                              </Fragment>
                                          ))
                                        : reasoningLevels.map((level) => (
                                              <DropdownMenuItem
                                                  key={level}
                                                  disabled={saving}
                                                  onSelect={(event) => { event.preventDefault(); selectReasoningLevel(level); }}
                                              >
                                                  {t(`composer.reasoningLevels.${level}`)}
                                                  {level === reasoningLevel ? (
                                                      <Check className="ml-auto size-3.5" />
                                                  ) : null}
                                              </DropdownMenuItem>
                                          ))}
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                        type="submit"
                        size="icon-sm"
                        aria-label={t("composer.send")}
                        disabled={disabled || saving || value.trim().length === 0}
                    >
                        <Send />
                    </Button>
                </div>
            </div>
            {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
        </form>
    );
}

function providerGroupsFor(config: JarvixConfig | null): ProviderGroup[] {
    const configured = config?.providers?.flatMap((provider) => {
        if (provider.models.length === 0) return [];
        return [{
            id: provider.id,
            name: provider.name,
            models: provider.models.map((model) => ({
                selection: { provider: provider.id, id: model.id },
                name: model.name,
                reasoning: model.reasoning,
                reasoningLevels: model.reasoningLevels
            }))
        }];
    }) ?? [];
    if (configured.length > 0) return configured;

    return [{
        id: DEFAULT_MODEL_REF.provider,
        name: "DeepSeek",
        models: [{
            selection: DEFAULT_MODEL_REF,
            name: "DeepSeek V4.1 Flash",
            reasoning: true
        }]
    }];
}

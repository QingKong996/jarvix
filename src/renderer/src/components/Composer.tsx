import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronUp, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";

type ComposerProps = {
    disabled: boolean;
    onSubmit: (question: string) => void;
};

type MenuView = "root" | "model" | "reasoning";

type ReasoningLevel = "low" | "high" | "max";

// Placeholder options until the composer is wired to the request config.
const MODELS = ["DeepSeek V4 Flash", "DeepSeek V4 Flash Vision Exp", "DeepSeek V4 Pro"] as const;

const REASONING_LEVELS: readonly ReasoningLevel[] = ["low", "high", "max"];

const DEFAULT_MODEL: string = MODELS[0];

const DEFAULT_REASONING_LEVEL: ReasoningLevel = "max";

export function Composer({ disabled, onSubmit }: ComposerProps) {
    const { t } = useTranslation();
    const [value, setValue] = useState("");
    const [model, setModel] = useState(DEFAULT_MODEL);
    const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(DEFAULT_REASONING_LEVEL);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuView, setMenuView] = useState<MenuView>("root");
    const firstMenuItemRef = useRef<HTMLDivElement>(null);

    const reasoningLabel = t(`composer.reasoningLevels.${reasoningLevel}`);

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

    function selectModel(next: string): void {
        setModel(next);
        setMenuOpen(false);
    }

    function selectReasoningLevel(next: ReasoningLevel): void {
        setReasoningLevel(next);
        setMenuOpen(false);
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        const question = value.trim();
        if (!question || disabled) {
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
                                disabled={disabled}
                                className="h-8 gap-1 px-2 text-xs font-normal"
                            >
                                {model}
                                <span className="text-muted-foreground">{reasoningLabel}</span>
                                <ChevronUp className="size-3.5 opacity-60" />
                            </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent side="top" align="end" sideOffset={8} className="min-w-52">
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

                                    <DropdownMenuItem onSelect={(event) => showMenuView(event, "reasoning")}>
                                        {t("composer.reasoning")}
                                        <span className="ml-auto text-muted-foreground">{reasoningLabel}</span>
                                        <ChevronRight className="size-3.5 opacity-60" />
                                    </DropdownMenuItem>
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
                                        ? MODELS.map((option) => (
                                              <DropdownMenuItem key={option} onSelect={() => selectModel(option)}>
                                                  {option}
                                                  {option === model ? <Check className="ml-auto size-3.5" /> : null}
                                              </DropdownMenuItem>
                                          ))
                                        : REASONING_LEVELS.map((level) => (
                                              <DropdownMenuItem
                                                  key={level}
                                                  onSelect={() => selectReasoningLevel(level)}
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
                        disabled={disabled || value.trim().length === 0}
                    >
                        <Send />
                    </Button>
                </div>
            </div>
        </form>
    );
}

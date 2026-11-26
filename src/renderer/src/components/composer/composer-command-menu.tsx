import { useEffect, useRef } from "react";
import { ChevronRight, Command } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "cn";
import { CHAT_COLUMN } from "../../layout.ts";
import { quickTransition } from "../../motion.ts";
import type { ComposerCommand } from "./composer-command-catalog.ts";

type ComposerCommandMenuProps = {
    commands: readonly ComposerCommand[];
    activeIndex: number;
    label: string;
    onActiveIndexChange(index: number): void;
    onSelect(command: ComposerCommand): void;
};

export function ComposerCommandMenu({
    commands,
    activeIndex,
    label,
    onActiveIndexChange,
    onSelect
}: ComposerCommandMenuProps) {
    const optionRefs = useRef(new Map<string, HTMLButtonElement>());
    const activeCommandId = commands[activeIndex]?.id;

    useEffect(() => {
        if (activeCommandId) {
            optionRefs.current.get(activeCommandId)?.scrollIntoView({ block: "nearest" });
        }
    }, [activeCommandId]);

    return (
        <motion.div
            id="composer-command-menu"
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: 6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={quickTransition}
            className={cn(
                CHAT_COLUMN,
                "mb-2 overflow-hidden rounded-2xl border border-border-strong bg-popover p-1.5 shadow-[0_6px_20px_rgb(0_0_0/0.07)] dark:shadow-[0_8px_24px_rgb(0_0_0/0.38)]"
            )}
        >
            <div className="max-h-[min(24rem,50vh)] overflow-y-auto">
                {commands.map((command, index) => {
                    const Icon = command.icon ?? Command;
                    const active = index === activeIndex;
                    return (
                        <button
                            key={command.id}
                            ref={(element) => {
                                if (element) {
                                    optionRefs.current.set(command.id, element);
                                } else {
                                    optionRefs.current.delete(command.id);
                                }
                            }}
                            id={`composer-command-${command.id}`}
                            type="button"
                            role="option"
                            aria-selected={active}
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => onActiveIndexChange(index)}
                            onClick={() => onSelect(command)}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors",
                                active
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-accent/60"
                            )}
                        >
                            <Icon
                                aria-hidden="true"
                                className={cn(
                                    "size-4 shrink-0",
                                    active ? "text-foreground" : "text-muted-foreground"
                                )}
                            />
                            <span className="shrink-0 text-sm font-medium">{command.label}</span>
                            <span className="min-w-0 truncate text-xs text-muted-foreground">
                                {command.description}
                            </span>
                            {command.hasSubmenu ? (
                                <ChevronRight
                                    aria-hidden="true"
                                    className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-70"
                                />
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </motion.div>
    );
}

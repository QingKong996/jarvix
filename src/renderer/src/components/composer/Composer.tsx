import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent
} from "react";
import {
    ArrowUp,
    ChevronUp,
    Folder,
    Square,
    Target,
    X
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { JarvixConfig } from "../../../../protocol/config.ts";
import type { JarvixContextUsage } from "../../../../protocol/context-usage.ts";
import type {
    JarvixPathCompletion,
    JarvixPathCompletionResult
} from "../../../../protocol/path-completion.ts";
import type {
    PermissionMode,
    PermissionRequest
} from "../../../../protocol/permission.ts";
import type { JarvixProject } from "../../../../protocol/project.ts";
import type {
    JarvixGoal,
    JarvixSessionContext
} from "../../../../protocol/session.ts";
import { CHAT_COLUMN, CONTENT_GUTTER } from "../../layout.ts";
import { ContextUsageRing } from "./ContextUsageRing.tsx";
import { ComposerCommandMenu } from "./composer-command-menu.tsx";
import {
    composerCommands,
    type ComposerCommand
} from "./composer-command-catalog.ts";
import {
    cycleCommandIndex,
    detectSlashCommand,
    filterSlashCommands,
    parseGoalCommand
} from "./composer-commands.ts";
import { ComposerPathMenu } from "./ComposerPathMenu.tsx";
import {
    completePathMentionText,
    detectPathMention,
    pathMentionFor,
    resolvePathMentions,
    type SelectedPathMention
} from "./composer-path-mentions.ts";
import { pathCompletionKeyAction } from "./composer-path-keyboard.ts";
import {
    ComposerRichInput,
    type ComposerRichInputHandle,
    type EditorSnapshot
} from "./ComposerRichInput.tsx";
import { GoalCard } from "./GoalCard.tsx";
import { ComposerModelMenu } from "./ComposerModelMenu.tsx";
import { ComposerPermissionMenu } from "./ComposerPermissionMenu.tsx";
import { PermissionRequestDialog } from "./PermissionRequestDialog.tsx";
import { SessionContextDialog } from "../sessions/SessionContextDialog.tsx";
import { quickTransition } from "../../motion.ts";

type ComposerProps = {
    disabled: boolean;
    running: boolean;
    projects: JarvixProject[];
    sessionContext: JarvixSessionContext;
    sessionPermission: PermissionMode;
    contextUsage: JarvixContextUsage | null;
    goal: JarvixGoal | null;
    permissionRequest: PermissionRequest | null;
    onSubmit: (question: string, sandboxPaths?: readonly string[]) => void;
    onGoalSubmit: (content: string, sandboxPaths?: readonly string[]) => void;
    onGoalClear: () => void;
    onStop: () => void;
    config: JarvixConfig | null;
    onConfigChange: (config: JarvixConfig) => Promise<void>;
    onContextChange: (context: JarvixSessionContext) => Promise<void>;
    onPermissionChange: (permission: PermissionMode) => Promise<void>;
    onPermissionResponse: (approved: boolean) => Promise<boolean>;
    onPathComplete: (
        query: string,
        context: JarvixSessionContext
    ) => Promise<JarvixPathCompletionResult>;
};

type PathNavigation = {
    menuKey: string;
    index: number;
    path?: string;
};

export type ComposerHandle = {
    addPathMentions(completions: readonly JarvixPathCompletion[]): void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({
    disabled,
    running,
    projects,
    sessionContext,
    sessionPermission,
    contextUsage,
    goal,
    permissionRequest,
    onSubmit,
    onGoalSubmit,
    onGoalClear,
    onStop,
    config,
    onConfigChange,
    onContextChange,
    onPermissionChange,
    onPermissionResponse,
    onPathComplete
}, ref) {
    const { t } = useTranslation();
    const [value, setValue] = useState("");
    const [goalEditing, setGoalEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [permissionSaving, setPermissionSaving] = useState(false);
    const [error, setError] = useState("");
    const [contextOpen, setContextOpen] = useState(false);
    const [inputFocused, setInputFocused] = useState(false);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const [commandNavigation, setCommandNavigation] = useState({ menuKey: "", index: 0 });
    const [pathNavigation, setPathNavigation] = useState<PathNavigation>({
        menuKey: "",
        index: 0
    });
    const [pathMentions, setPathMentions] = useState<SelectedPathMention[]>([]);
    const [pathCompletions, setPathCompletions] = useState<{
        menuKey: string;
        result: JarvixPathCompletionResult;
    }>({ menuKey: "", result: { entries: [] } });
    const richInputRef = useRef<ComposerRichInputHandle>(null);
    const selectedProject = projects.find((project) => project.id === sessionContext.projectId);
    const workingDirectoryName = sessionContext.workingDirectory
        ? sessionContext.workingDirectory.split(/[\\/]/).filter(Boolean).at(-1) ?? sessionContext.workingDirectory
        : null;
    const contextLabel = selectedProject?.name ?? workingDirectoryName ?? t("projects.temporary");
    const permissionPending = permissionRequest !== null;
    const inputDisabled = disabled || saving || permissionSaving || permissionPending;
    const commands = composerCommands(t).filter(
        (command) => !(running && command.id === "goal")
    );
    const slashTrigger = goalEditing
        ? null
        : detectSlashCommand(value, selection.start, selection.end);
    const matchingCommands = slashTrigger
        ? filterSlashCommands(commands, slashTrigger.query)
        : [];
    const commandMenuKey = slashTrigger
        ? `${slashTrigger.tokenStart}:${slashTrigger.tokenEnd}:${slashTrigger.query}`
        : "";
    const commandMenuOpen = inputFocused && !inputDisabled && matchingCommands.length > 0;
    const activeCommandIndex = !commandMenuOpen
        ? -1
        : commandNavigation.menuKey === commandMenuKey
            ? Math.min(commandNavigation.index, matchingCommands.length - 1)
            : 0;
    const activeCommand = matchingCommands[activeCommandIndex];
    const pathTrigger = detectPathMention(value, selection.start, selection.end);
    const pathQuery = pathTrigger?.query ?? "";
    const pathMenuKey = pathTrigger
        ? `${pathTrigger.tokenStart}:${pathTrigger.tokenEnd}:${pathTrigger.query}`
        : "";
    const pathCompletionResult = pathCompletions.menuKey === pathMenuKey
        ? pathCompletions.result
        : null;
    const matchingPaths = pathCompletionResult?.entries ?? [];
    const pathCompletionPending = inputFocused
        && !inputDisabled
        && pathTrigger !== null
        && pathCompletions.menuKey !== pathMenuKey;
    const pathMenuOpen = inputFocused
        && !inputDisabled
        && pathTrigger !== null
        && pathCompletionResult !== null
        && matchingPaths.length > 0;
    const activePathIndex = !pathMenuOpen
        ? -1
        : pathNavigation.menuKey === pathMenuKey
            ? pathNavigation.path
                ? Math.max(
                    0,
                    matchingPaths.findIndex(
                        (path) => path.path === pathNavigation.path
                    )
                )
                : Math.min(pathNavigation.index, matchingPaths.length - 1)
            : 0;
    const activePath = matchingPaths[activePathIndex];

    useImperativeHandle(ref, () => ({
        addPathMentions(completions) {
            if (inputDisabled || completions.length === 0) {
                return;
            }
            const existing = new Set(pathMentions.map((mention) => mention.path));
            const mentions = completions
                .filter((completion) => !existing.has(completion.path))
                .map((completion) => pathMentionFor(completion));
            if (
                mentions.length === 0
                || !richInputRef.current?.insertPathMentions(mentions)
            ) {
                return;
            }
            setPathNavigation({ menuKey: "", index: 0 });
            setPathCompletions({
                menuKey: "",
                result: { entries: [] }
            });
        }
    }), [inputDisabled, pathMentions]);

    useEffect(() => {
        if (!pathTrigger || !inputFocused || inputDisabled) {
            setPathCompletions((current) => current.menuKey === ""
                ? current
                : {
                    menuKey: "",
                    result: { entries: [] }
                });
            return;
        }
        let cancelled = false;
        const menuKey = pathMenuKey;
        const timer = window.setTimeout(() => {
            void onPathComplete(pathQuery, sessionContext)
                .then((result) => {
                    if (!cancelled) {
                        setPathCompletions({ menuKey, result });
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setPathCompletions({
                            menuKey,
                            result: { entries: [] }
                        });
                    }
                });
        }, 80);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [
        inputDisabled,
        inputFocused,
        onPathComplete,
        pathMenuKey,
        pathQuery,
        sessionContext
    ]);

    async function saveConfig(next: JarvixConfig): Promise<boolean> {
        setSaving(true);
        setError("");
        try {
            await onConfigChange(next);
            return true;
        } catch (cause) {
            setError(String(cause));
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function savePermission(next: PermissionMode): Promise<boolean> {
        setPermissionSaving(true);
        setError("");
        try {
            await onPermissionChange(next);
            return true;
        } catch {
            setError(t("composer.permissions.updateFailed"));
            return false;
        } finally {
            setPermissionSaving(false);
        }
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        if (inputDisabled) {
            return;
        }
        const text = value.trim();
        if (goalEditing) {
            const resolved = resolvePathMentions(text, pathMentions);
            if (!resolved.text || running) {
                return;
            }
            setGoalEditing(false);
            resetInput();
            onGoalSubmit(resolved.text, resolved.paths);
            return;
        }
        const goalCommand = running ? null : parseGoalCommand(value);
        if (goalCommand) {
            const resolved = resolvePathMentions(goalCommand.content, pathMentions);
            resetInput();
            if (resolved.text) {
                setGoalEditing(false);
                onGoalSubmit(resolved.text, resolved.paths);
            } else {
                setGoalEditing(true);
            }
            return;
        }
        const resolved = resolvePathMentions(text, pathMentions);
        if (!resolved.text && !goal) {
            return;
        }
        if (!resolved.text && running) {
            return;
        }
        resetInput();
        onSubmit(resolved.text, resolved.paths);
    }

    function resetInput(): void {
        setValue("");
        setSelection({ start: 0, end: 0 });
        setPathMentions([]);
        setCommandNavigation({ menuKey: "", index: 0 });
        setPathNavigation({ menuKey: "", index: 0 });
        setPathCompletions({
            menuKey: "",
            result: { entries: [] }
        });
        richInputRef.current?.clear();
    }

    function handleEditorChange(snapshot: EditorSnapshot): void {
        setValue(snapshot.value);
        setSelection(snapshot.selection);
        setPathMentions(snapshot.mentions);
    }

    function setActiveCommandIndex(index: number): void {
        setCommandNavigation({ menuKey: commandMenuKey, index });
    }

    function moveCommandSelection(delta: number): void {
        if (!commandMenuOpen) {
            return;
        }

        setActiveCommandIndex(cycleCommandIndex(
            activeCommandIndex,
            delta,
            matchingCommands.length
        ));
    }

    function setActivePathIndex(index: number): void {
        setPathNavigation({ menuKey: pathMenuKey, index });
    }

    function movePathSelection(delta: number): void {
        if (!pathMenuOpen) {
            return;
        }
        setActivePathIndex(cycleCommandIndex(
            activePathIndex,
            delta,
            matchingPaths.length
        ));
    }

    function selectPath(completion: JarvixPathCompletion): void {
        const initialMention = pathMentionFor(completion);
        const mention = pathMentions.some(
            (item) => item.token === initialMention.token
                && item.path !== initialMention.path
        )
            ? pathMentionFor(completion, true)
            : initialMention;
        if (!richInputRef.current?.insertMention(mention)) {
            return;
        }
        setPathNavigation({ menuKey: "", index: 0 });
        setPathCompletions({
            menuKey: "",
            result: { entries: [] }
        });
    }

    function completePathText(completion: JarvixPathCompletion): void {
        if (!pathTrigger) {
            return;
        }
        const { tokenStart, tokenEnd } = pathTrigger;
        const completed = completePathMentionText(
            value,
            pathTrigger,
            completion
        );

        richInputRef.current?.replaceRange(
            tokenStart,
            tokenEnd,
            completed.token
        );

        const nextTrigger = completed.trigger;
        if (!nextTrigger) {
            setPathCompletions({
                menuKey: "",
                result: { entries: [] }
            });
            return;
        }
        const nextMenuKey = [
            nextTrigger.tokenStart,
            nextTrigger.tokenEnd,
            nextTrigger.query
        ].join(":");
        setPathCompletions({
            menuKey: nextMenuKey,
            result: { entries: [completion] }
        });
        setPathNavigation({
            menuKey: nextMenuKey,
            index: 0,
            path: completion.path
        });
    }

    function selectCommand(command: ComposerCommand): void {
        if (!slashTrigger) {
            return;
        }

        if (command.id === "goal") {
            const removalEnd = value[slashTrigger.tokenEnd] === " "
                ? slashTrigger.tokenEnd + 1
                : slashTrigger.tokenEnd;
            richInputRef.current?.replaceRange(
                slashTrigger.tokenStart,
                removalEnd,
                ""
            );
            setGoalEditing(true);
            setCommandNavigation({ menuKey: "", index: 0 });
            return;
        }

        const insertion = `/${command.id} `;
        richInputRef.current?.replaceRange(
            slashTrigger.tokenStart,
            slashTrigger.tokenEnd,
            insertion
        );
        setCommandNavigation({ menuKey: "", index: 0 });
    }

    function beginGoalEdit(content: string): void {
        setGoalEditing(true);
        setCommandNavigation({ menuKey: "", index: 0 });
        richInputRef.current?.setPlainText(content);
    }

    function toggleGoalEditing(): void {
        if (goalEditing) {
            setGoalEditing(false);
            resetInput();
            return;
        }
        beginGoalEdit(goal?.content ?? "");
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        if (event.nativeEvent.isComposing) {
            return;
        }

        if (
            pathCompletionPending
            && event.key === "Enter"
            && !event.shiftKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
        ) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (pathMenuOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const action = pathCompletionKeyAction(event.key, event.shiftKey);
            if (action === "previous" || action === "next") {
                event.preventDefault();
                event.stopPropagation();
                movePathSelection(action === "next" ? 1 : -1);
                return;
            }

            if (action === "complete" && activePath) {
                event.preventDefault();
                event.stopPropagation();
                completePathText(activePath);
                return;
            }

            if (action === "confirm") {
                event.preventDefault();
                event.stopPropagation();
                if (activePath) {
                    selectPath(activePath);
                }
                return;
            }
        }

        if (commandMenuOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.key === "Tab") {
                event.preventDefault();
                event.stopPropagation();
                moveCommandSelection(event.shiftKey ? -1 : 1);
                return;
            }

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                moveCommandSelection(event.key === "ArrowDown" ? 1 : -1);
                return;
            }

            if (event.key === "Enter" && !event.shiftKey && activeCommand) {
                event.preventDefault();
                event.stopPropagation();
                selectCommand(activeCommand);
                return;
            }
        }

        if (event.key !== "Enter") {
            return;
        }

        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.closest("form")?.requestSubmit();
    }

    return (
        <>
            <div className={cn(CONTENT_GUTTER, "py-3")}>
                <AnimatePresence initial={false}>
                    {pathMenuOpen ? (
                        <ComposerPathMenu
                            paths={matchingPaths}
                            query={pathQuery}
                            activeIndex={activePathIndex}
                            label={t("composer.paths.label")}
                            onActiveIndexChange={setActivePathIndex}
                            onSelect={selectPath}
                        />
                    ) : commandMenuOpen ? (
                        <ComposerCommandMenu
                            commands={matchingCommands}
                            activeIndex={activeCommandIndex}
                            label={t("composer.commands.label")}
                            onActiveIndexChange={setActiveCommandIndex}
                            onSelect={selectCommand}
                        />
                    ) : null}
                </AnimatePresence>
                <form data-testid="composer-form" onSubmit={handleSubmit}>
                    {goal ? (
                        <div className={cn(CHAT_COLUMN, "mb-1.5")}>
                            <GoalCard
                                goal={goal}
                                running={running}
                                disabled={inputDisabled}
                                editDisabled={running}
                                onDelete={onGoalClear}
                                onPause={onStop}
                                onResume={() => onSubmit("")}
                                onEdit={() => beginGoalEdit(goal.content)}
                            />
                        </div>
                    ) : null}
                    <div className={cn(CHAT_COLUMN, "flex flex-col gap-1 rounded-xl border bg-composer p-1.5 shadow-sm")}>
                        <AnimatePresence initial={false}>
                            {permissionRequest ? (
                                <PermissionRequestDialog
                                    key={permissionRequest.id}
                                    request={permissionRequest}
                                    onRespond={onPermissionResponse}
                                />
                            ) : null}
                        </AnimatePresence>
                        <ComposerRichInput
                            ref={richInputRef}
                            disabled={inputDisabled}
                            placeholder={goalEditing
                                ? t("composer.goal.placeholder")
                                : t("composer.placeholder")}
                            ariaLabel={goalEditing
                                ? t("composer.goal.placeholder")
                                : t("composer.placeholder")}
                            ariaExpanded={commandMenuOpen || pathMenuOpen}
                            ariaControls={pathMenuOpen
                                ? "composer-path-menu"
                                : commandMenuOpen
                                    ? "composer-command-menu"
                                    : undefined}
                            ariaActiveDescendant={pathMenuOpen && activePath
                                ? `composer-path-${activePathIndex}`
                                : activeCommand
                                    ? `composer-command-${activeCommand.id}`
                                    : undefined}
                            onChange={handleEditorChange}
                            onSelectionChange={setSelection}
                            onFocus={() => setInputFocused(true)}
                            onBlur={() => setInputFocused(false)}
                            onKeyDown={handleKeyDown}
                        />

                        <div className="flex min-w-0 items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setContextOpen(true)}
                                disabled={disabled || running || saving || permissionSaving || permissionPending}
                                aria-haspopup="dialog"
                                aria-expanded={contextOpen}
                                data-testid="session-context-trigger"
                                data-project-id={sessionContext.projectId}
                                data-working-directory={sessionContext.workingDirectory}
                                className="h-8 min-w-0 max-w-[45%] shrink justify-start gap-1 px-2 text-xs font-normal"
                                title={contextLabel}
                            >
                                <Folder className="size-3.5 shrink-0" />
                                <span className="truncate">{contextLabel}</span>
                                <ChevronUp className="size-3.5 shrink-0 opacity-60" />
                            </Button>

                            <ComposerPermissionMenu
                                permission={sessionPermission}
                                disabled={disabled || permissionPending}
                                saving={saving || permissionSaving}
                                onChange={savePermission}
                            />

                            <AnimatePresence initial={false}>
                                {goalEditing ? (
                                    <motion.div
                                        key="goal-mode"
                                        initial={{ opacity: 0, scale: 0.92 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.92 }}
                                        transition={quickTransition}
                                        data-testid="composer-goal-mode"
                                        className="group inline-flex h-8 shrink-0 items-center gap-1 rounded-md text-xs font-normal text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                                    >
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            onClick={toggleGoalEditing}
                                            disabled={inputDisabled || running}
                                            aria-label={t("composer.goal.exitEdit")}
                                            title={t("composer.goal.exitEdit")}
                                            data-testid="composer-goal-exit"
                                            className="size-6 rounded-md p-0 text-current hover:bg-transparent"
                                        >
                                            <Target className="size-3.5 shrink-0 group-hover:hidden" />
                                            <X className="hidden size-3.5 shrink-0 group-hover:block" />
                                        </Button>
                                        <span className="cursor-default pr-2.5 select-none">
                                            {t("composer.goal.button")}
                                        </span>
                                    </motion.div>
                                ) : null}
                            </AnimatePresence>

                            <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
                                <ContextUsageRing usage={contextUsage} />
                                <ComposerModelMenu
                                    config={config}
                                    disabled={disabled || running || permissionPending}
                                    saving={saving || permissionSaving}
                                    onSave={saveConfig}
                                />

                                <motion.div
                                    key={running && !goalEditing && value.trim().length === 0 ? "stop" : "send"}
                                    initial={{ opacity: 0, scale: 0.86 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={quickTransition}
                                    className="shrink-0"
                                >
                                    {running && !goalEditing && value.trim().length === 0 ? (
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            className="shrink-0 p-0 dark:bg-[#E6EDF3] dark:text-[#0D1117] dark:hover:bg-[#E6EDF3]/90"
                                            aria-label={t("composer.stop")}
                                            title={t("composer.stop")}
                                            onClick={onStop}
                                            data-testid="composer-stop"
                                        >
                                            <Square aria-hidden="true" className="size-3 fill-current" />
                                        </Button>
                                    ) : (
                                        <Button
                                            type="submit"
                                            size="icon-sm"
                                            className="shrink-0 bg-[#1F6FEB] p-0 text-white hover:bg-[#1F6FEB]/90"
                                            aria-label={t("composer.send")}
                                            disabled={inputDisabled || (
                                                goalEditing
                                                    ? running || value.trim().length === 0
                                                    : value.trim().length === 0 && goal === null
                                            )}
                                            data-testid="composer-send"
                                        >
                                            <ArrowUp aria-hidden="true" className="size-4" />
                                        </Button>
                                    )}
                                </motion.div>
                            </div>
                        </div>
                    </div>
                    <AnimatePresence initial={false}>
                        {error ? (
                            <motion.p
                                role="alert"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={quickTransition}
                                className={cn(CHAT_COLUMN, "mt-1 overflow-hidden text-xs text-destructive")}
                            >
                                {error}
                            </motion.p>
                        ) : null}
                    </AnimatePresence>
                </form>
            </div>

            <SessionContextDialog
                open={contextOpen}
                projects={projects}
                context={sessionContext}
                onOpenChange={setContextOpen}
                onSelect={onContextChange}
            />
        </>
    );
});

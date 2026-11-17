import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, ChevronUp, Folder, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { JarvixConfig } from "../../../../protocol/config.ts";
import type { PermissionMode } from "../../../../protocol/permission.ts";
import type { JarvixProject } from "../../../../protocol/project.ts";
import type { JarvixSessionContext } from "../../../../protocol/session.ts";
import { CHAT_COLUMN, CONTENT_GUTTER } from "../../layout.ts";
import { ComposerModelMenu } from "./ComposerModelMenu.tsx";
import { ComposerPermissionMenu } from "./ComposerPermissionMenu.tsx";
import { SessionContextDialog } from "../sessions/SessionContextDialog.tsx";

type ComposerProps = {
    disabled: boolean;
    running: boolean;
    projects: JarvixProject[];
    sessionContext: JarvixSessionContext;
    sessionPermission: PermissionMode;
    onSubmit: (question: string) => void;
    onStop: () => void;
    config: JarvixConfig | null;
    onConfigChange: (config: JarvixConfig) => Promise<void>;
    onContextChange: (context: JarvixSessionContext) => Promise<void>;
    onPermissionChange: (permission: PermissionMode) => Promise<void>;
};

export function Composer({
    disabled,
    running,
    projects,
    sessionContext,
    sessionPermission,
    onSubmit,
    onStop,
    config,
    onConfigChange,
    onContextChange,
    onPermissionChange
}: ComposerProps) {
    const { t } = useTranslation();
    const [value, setValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [permissionSaving, setPermissionSaving] = useState(false);
    const [error, setError] = useState("");
    const [contextOpen, setContextOpen] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const selectedProject = projects.find((project) => project.id === sessionContext.projectId);
    const workingDirectoryName = sessionContext.workingDirectory
        ? sessionContext.workingDirectory.split(/[\\/]/).filter(Boolean).at(-1) ?? sessionContext.workingDirectory
        : null;
    const contextLabel = selectedProject?.name ?? workingDirectoryName ?? t("projects.temporary");

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
        const question = value.trim();
        if (!question || disabled || saving || permissionSaving) {
            return;
        }
        setValue("");
        onSubmit(question);
        textareaRef.current?.focus();
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
        <>
            <div className={cn(CONTENT_GUTTER, "py-3")}>
                <form onSubmit={handleSubmit}>
                    <div className={cn(CHAT_COLUMN, "flex flex-col gap-1 rounded-xl border bg-composer p-1.5 shadow-sm")}>
                        <Textarea
                            ref={textareaRef}
                            rows={1}
                            autoComplete="off"
                            autoFocus
                            value={value}
                            onChange={(event) => setValue(event.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={disabled || saving || permissionSaving}
                            placeholder={t("composer.placeholder")}
                            className="max-h-48 min-h-8 w-full resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
                        />

                        <div className="flex min-w-0 items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setContextOpen(true)}
                                disabled={disabled || running || saving || permissionSaving}
                                aria-haspopup="dialog"
                                aria-expanded={contextOpen}
                                className="h-8 min-w-0 max-w-[45%] shrink justify-start gap-1 px-2 text-xs font-normal"
                                title={contextLabel}
                            >
                                <Folder className="size-3.5 shrink-0" />
                                <span className="truncate">{contextLabel}</span>
                                <ChevronUp className="size-3.5 shrink-0 opacity-60" />
                            </Button>

                            <ComposerPermissionMenu
                                permission={sessionPermission}
                                disabled={disabled}
                                saving={saving || permissionSaving}
                                onChange={savePermission}
                            />

                            <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
                                <ComposerModelMenu
                                    config={config}
                                    disabled={disabled || running}
                                    saving={saving || permissionSaving}
                                    onSave={saveConfig}
                                />

                                {running && value.trim().length === 0 ? (
                                    <Button
                                        type="button"
                                        size="icon-sm"
                                        className="shrink-0 p-0 dark:bg-[#E6EDF3] dark:text-[#0D1117] dark:hover:bg-[#E6EDF3]/90"
                                        aria-label={t("composer.stop")}
                                        title={t("composer.stop")}
                                        onClick={onStop}
                                    >
                                        <Square aria-hidden="true" className="size-3 fill-current" />
                                    </Button>
                                ) : (
                                    <Button
                                        type="submit"
                                        size="icon-sm"
                                        className="shrink-0 bg-[#1F6FEB] p-0 text-white hover:bg-[#1F6FEB]/90"
                                        aria-label={t("composer.send")}
                                        disabled={disabled || saving || permissionSaving || value.trim().length === 0}
                                    >
                                        <ArrowUp aria-hidden="true" className="size-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                    {error ? (
                        <p role="alert" className={cn(CHAT_COLUMN, "mt-1 text-xs text-destructive")}>
                            {error}
                        </p>
                    ) : null}
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
}

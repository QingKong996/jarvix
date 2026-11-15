import { useEffect, useState } from "react";
import { Check, Folder, FolderOpen, Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixProject } from "../../../protocol/project.ts";
import type { JarvixSessionContext } from "../../../protocol/session.ts";
import { Button } from "./ui/button.tsx";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "./ui/dialog.tsx";

type SessionContextDialogProps = {
    open: boolean;
    projects: JarvixProject[];
    context: JarvixSessionContext;
    onOpenChange(open: boolean): void;
    onSelect(context: JarvixSessionContext): Promise<void>;
};

const bridge = window.jarvix;

export function SessionContextDialog({
    open,
    projects,
    context,
    onOpenChange,
    onSelect
}: SessionContextDialogProps) {
    const { t } = useTranslation();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (open) {
            setError("");
        }
    }, [open]);

    async function apply(next: JarvixSessionContext): Promise<void> {
        if (saving) {
            return;
        }
        setSaving(true);
        setError("");
        try {
            await onSelect(next);
            onOpenChange(false);
        } catch {
            setError(t("composer.contextDialog.updateFailed"));
        } finally {
            setSaving(false);
        }
    }

    async function chooseDirectory(): Promise<void> {
        if (!bridge || saving) {
            return;
        }
        try {
            const directory = await bridge.pickWorkingDirectory();
            if (directory) {
                await apply({ workingDirectory: directory });
            }
        } catch {
            setError(t("composer.contextDialog.chooseDirectoryFailed"));
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t("composer.contextDialog.title")}</DialogTitle>
                    <DialogDescription>{t("composer.contextDialog.description")}</DialogDescription>
                </DialogHeader>

                <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                    <button
                        type="button"
                        onClick={() => void apply({})}
                        disabled={saving}
                        className={contextOptionClass(!context.projectId && !context.workingDirectory)}
                    >
                        <Inbox className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{t("projects.temporary")}</span>
                        {!context.projectId && !context.workingDirectory ? <Check className="size-4" /> : null}
                    </button>

                    {projects.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">{t("projects.empty")}</p>
                    ) : (
                        projects.map((project) => (
                            <button
                                key={project.id}
                                type="button"
                                onClick={() => void apply({ projectId: project.id })}
                                disabled={saving}
                                className={contextOptionClass(context.projectId === project.id)}
                                title={project.workingDirectories.join("\n")}
                            >
                                <Folder className="size-4 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{project.name}</span>
                                    <span className="block truncate text-xs font-normal text-muted-foreground">
                                        {project.workingDirectories.join(", ")}
                                    </span>
                                </span>
                                {context.projectId === project.id ? <Check className="size-4" /> : null}
                            </button>
                        ))
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 border-t pt-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium">{t("composer.contextDialog.customDirectory")}</p>
                        {context.workingDirectory ? (
                            <p className="truncate text-xs text-muted-foreground" title={context.workingDirectory}>
                                {context.workingDirectory}
                            </p>
                        ) : null}
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void chooseDirectory()}
                        disabled={saving}
                    >
                        <FolderOpen />
                        {t("composer.contextDialog.chooseDirectory")}
                    </Button>
                </div>

                {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </DialogContent>
        </Dialog>
    );
}

function contextOptionClass(active: boolean): string {
    return `flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
    }`;
}

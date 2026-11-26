import { useEffect, useState, type FormEvent } from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixProject } from "../../../../protocol/project.ts";
import { DialogFooter } from "../common/DialogFooter.tsx";
import { FormField } from "../common/FormField.tsx";
import { Button } from "../ui/button.tsx";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "../ui/dialog.tsx";
import { Input } from "../ui/input.tsx";

type CreateProjectDialogProps = {
    open: boolean;
    onOpenChange(open: boolean): void;
    onCreate(name: string, workingDirectories: string[]): Promise<JarvixProject | null>;
};

const bridge = window.jarvix;

export function CreateProjectDialog({ open, onOpenChange, onCreate }: CreateProjectDialogProps) {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [workingDirectories, setWorkingDirectories] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (open) {
            setName("");
            setWorkingDirectories([]);
            setError("");
        }
    }, [open]);

    async function chooseDirectories(): Promise<void> {
        if (!bridge || saving) {
            return;
        }
        try {
            const selected = await bridge.pickWorkingDirectories();
            setWorkingDirectories((current) => [...new Set([...current, ...selected])]);
            setError("");
        } catch {
            setError(t("projects.chooseDirectoryFailed"));
        }
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (saving || name.trim().length === 0 || workingDirectories.length === 0) {
            return;
        }

        setSaving(true);
        setError("");
        try {
            const project = await onCreate(name.trim(), workingDirectories);
            if (project) {
                onOpenChange(false);
            } else {
                setError(t("projects.createFailed"));
            }
        } catch {
            setError(t("projects.createFailed"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent data-testid="create-project-dialog" className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t("projects.createTitle")}</DialogTitle>
                    <DialogDescription>{t("projects.workingDirectoriesDescription")}</DialogDescription>
                </DialogHeader>

                <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
                    <FormField label={t("projects.name")}>
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={t("projects.namePlaceholder")}
                            disabled={saving}
                            data-testid="project-name"
                        />
                    </FormField>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-foreground">{t("projects.workingDirectories")}</span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void chooseDirectories()}
                                disabled={saving}
                                data-testid="project-add-directories"
                            >
                                <FolderOpen />
                                {t("projects.addDirectories")}
                            </Button>
                        </div>

                        {workingDirectories.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-border bg-surface-subtle/60 px-3 py-4 text-center text-xs text-muted-foreground">
                                {t("projects.noDirectories")}
                            </p>
                        ) : (
                            <ul className="flex max-h-44 flex-col gap-1.5 overflow-y-auto">
                                {workingDirectories.map((directory) => (
                                    <li
                                        key={directory}
                                        className="flex items-center gap-2 rounded-lg border border-border/75 bg-surface-subtle px-3 py-1.5"
                                    >
                                        <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={directory}>
                                            {directory}
                                        </span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={t("projects.removeDirectory")}
                                            onClick={() => setWorkingDirectories((current) => (
                                                current.filter((item) => item !== directory)
                                            ))}
                                            disabled={saving}
                                            className="text-muted-foreground hover:text-foreground"
                                        >
                                            <X />
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <DialogFooter error={error}>
                        <DialogClose asChild>
                            <Button type="button" variant="outline" disabled={saving}>
                                {t("projects.cancel")}
                            </Button>
                        </DialogClose>
                        <Button
                            type="submit"
                            disabled={saving || name.trim().length === 0 || workingDirectories.length === 0}
                            data-testid="project-create"
                        >
                            <Plus />
                            {t("projects.create")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

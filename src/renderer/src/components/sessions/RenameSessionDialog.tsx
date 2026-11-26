import { useEffect, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    SESSION_NAME_MAX_LENGTH,
    type JarvixSessionSummary
} from "../../../../protocol/session.ts";
import { DialogFooter } from "../common/DialogFooter.tsx";
import { FormField } from "../common/FormField.tsx";
import { Button } from "../ui/button.tsx";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle
} from "../ui/dialog.tsx";
import { Input } from "../ui/input.tsx";

type RenameSessionDialogProps = {
    session: JarvixSessionSummary | null;
    onOpenChange(open: boolean): void;
    onRename(sessionId: string, name: string): Promise<boolean>;
};

export function RenameSessionDialog({
    session,
    onOpenChange,
    onRename
}: RenameSessionDialogProps) {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setName(session?.name ?? "");
        setError("");
    }, [session?.id, session?.name]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        const normalized = name.trim();
        if (!session || saving || normalized.length === 0) {
            return;
        }

        setSaving(true);
        setError("");
        try {
            if (await onRename(session.id, normalized)) {
                onOpenChange(false);
            } else {
                setError(t("sessions.renameFailed"));
            }
        } catch {
            setError(t("sessions.renameFailed"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={session !== null} onOpenChange={onOpenChange}>
            <DialogContent data-testid="rename-session-dialog">
                <DialogHeader>
                    <DialogTitle>{t("sessions.renameTitle")}</DialogTitle>
                </DialogHeader>

                <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
                    <FormField label={t("sessions.name")}>
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={t("sessions.namePlaceholder")}
                            maxLength={SESSION_NAME_MAX_LENGTH}
                            disabled={saving}
                            data-testid="rename-session-name"
                        />
                    </FormField>

                    <DialogFooter error={error}>
                        <DialogClose asChild>
                            <Button type="button" variant="outline" disabled={saving}>
                                {t("sessions.cancel")}
                            </Button>
                        </DialogClose>
                        <Button
                            type="submit"
                            disabled={saving || name.trim().length === 0}
                            data-testid="rename-session-submit"
                        >
                            <Save />
                            {t("sessions.save")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

import { useEffect, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    SESSION_NAME_MAX_LENGTH,
    type JarvixSessionSummary
} from "../../../protocol/session.ts";
import { Button } from "./ui/button.tsx";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";

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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("sessions.renameTitle")}</DialogTitle>
                </DialogHeader>

                <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
                    <label className="flex flex-col gap-2 text-sm font-medium">
                        {t("sessions.name")}
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={t("sessions.namePlaceholder")}
                            maxLength={SESSION_NAME_MAX_LENGTH}
                            disabled={saving}
                        />
                    </label>

                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

                    <div className="flex justify-end gap-2">
                        <DialogClose asChild>
                            <Button type="button" variant="ghost" disabled={saving}>
                                {t("sessions.cancel")}
                            </Button>
                        </DialogClose>
                        <Button type="submit" disabled={saving || name.trim().length === 0}>
                            <Save />
                            {t("sessions.save")}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

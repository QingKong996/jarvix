import { useEffect, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixSessionSummary } from "../../../protocol/session.ts";
import { DialogFooter } from "./DialogFooter.tsx";
import { Button } from "./ui/button.tsx";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "./ui/dialog.tsx";

type DeleteSessionDialogProps = {
    session: JarvixSessionSummary | null;
    onOpenChange(open: boolean): void;
    onDelete(sessionId: string): Promise<boolean>;
};

export function DeleteSessionDialog({
    session,
    onOpenChange,
    onDelete
}: DeleteSessionDialogProps) {
    const { t } = useTranslation();
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setError("");
    }, [session?.id]);

    async function handleDelete(): Promise<void> {
        if (!session || deleting) {
            return;
        }
        setDeleting(true);
        setError("");
        try {
            if (await onDelete(session.id)) {
                onOpenChange(false);
            } else {
                setError(t("sessions.deleteFailed"));
            }
        } catch {
            setError(t("sessions.deleteFailed"));
        } finally {
            setDeleting(false);
        }
    }

    return (
        <Dialog
            open={session !== null}
            onOpenChange={(open) => {
                if (!deleting) {
                    onOpenChange(open);
                }
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("sessions.deleteTitle")}</DialogTitle>
                    <DialogDescription>
                        {t("sessions.deleteDescription", { name: session?.name ?? "" })}
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter error={error}>
                    <DialogClose asChild>
                        <Button type="button" variant="ghost" disabled={deleting}>
                            {t("sessions.cancel")}
                        </Button>
                    </DialogClose>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={deleting}
                        onClick={() => void handleDelete()}
                    >
                        {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                        {deleting ? t("sessions.deleting") : t("sessions.deleteConfirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

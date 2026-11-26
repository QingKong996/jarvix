import { useEffect, useState } from "react";
import { LoaderCircle, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { PermissionRequest } from "../../../../protocol/permission.ts";
import { PermissionResourceList } from "../permissions/PermissionResourceList.tsx";
import { Button } from "../ui/button.tsx";
import { smoothTransition } from "../../motion.ts";

type PermissionRequestDialogProps = {
    request: PermissionRequest;
    onRespond: (approved: boolean) => Promise<boolean>;
};

export function PermissionRequestDialog({
    request,
    onRespond
}: PermissionRequestDialogProps) {
    const { t } = useTranslation();
    const [submitting, setSubmitting] = useState<"approve" | "cancel" | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        setSubmitting(null);
        setError("");
    }, [request.id]);

    async function respond(approved: boolean): Promise<void> {
        if (submitting) {
            return;
        }
        setSubmitting(approved ? "approve" : "cancel");
        setError("");
        try {
            if (!await onRespond(approved)) {
                setError(t("permissionRequest.respondFailed"));
            }
        } catch {
            setError(t("permissionRequest.respondFailed"));
        } finally {
            setSubmitting(null);
        }
    }

    return (
        <motion.section
            role="dialog"
            aria-modal="false"
            aria-labelledby={`permission-request-${request.id}`}
            data-slot="permission-request-dialog"
            initial={{ opacity: 0, height: 0, y: 8 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={smoothTransition}
            className="mb-1 flex flex-col gap-3 overflow-hidden rounded-xl border border-border/80 bg-background p-3.5"
        >
            <div className="flex items-start gap-2">
                <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="min-w-0">
                    <h3
                        id={`permission-request-${request.id}`}
                        className="text-[13px] font-medium text-foreground"
                    >
                        {t("permissionRequest.title")}
                    </h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {t("permissionRequest.description")}
                    </p>
                </div>
            </div>

            <PermissionResourceList
                domains={request.domains}
                directories={request.directories}
            />

            {error ? (
                <p role="alert" className="text-xs text-destructive">{error}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting !== null}
                    onClick={() => void respond(false)}
                >
                    {submitting === "cancel"
                        ? <LoaderCircle className="animate-spin" />
                        : <X />}
                    {t("permissionRequest.cancel")}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="default"
                    disabled={submitting !== null}
                    onClick={() => void respond(true)}
                >
                    {submitting === "approve"
                        ? <LoaderCircle className="animate-spin" />
                        : <ShieldCheck />}
                    {t("permissionRequest.approve")}
                </Button>
            </div>
        </motion.section>
    );
}

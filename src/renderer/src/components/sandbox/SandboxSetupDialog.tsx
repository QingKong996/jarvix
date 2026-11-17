import { useEffect, useState } from "react";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DialogFooter } from "../common/DialogFooter.tsx";
import { Button } from "../ui/button.tsx";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "../ui/dialog.tsx";

const bridge = window.jarvix;

export function SandboxSetupDialog() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!bridge) {
            return;
        }

        let active = true;
        void bridge.getSandboxStatus()
            .then((status) => {
                if (active && !status.ready) {
                    setOpen(true);
                }
            })
            .catch(() => undefined);
        const unsubscribe = bridge.onSandboxSetupRequired(() => {
            setError("");
            setOpen(true);
        });
        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    function handleOpenChange(next: boolean): void {
        if (installing) {
            return;
        }
        if (next) {
            setOpen(true);
            return;
        }
        setOpen(false);
        setError("");
        void bridge?.dismissSandboxSetup().catch(() => undefined);
    }

    async function handleInstall(): Promise<void> {
        if (!bridge || installing) {
            return;
        }

        setInstalling(true);
        setError("");
        try {
            const result = await bridge.installSandbox();
            if (result.status === "installed") {
                setOpen(false);
                return;
            }
            if (result.status === "cancelled") {
                setError(t("sandbox.setup.cancelledMessage"));
                return;
            }
            setError([
                t("sandbox.setup.failedMessage"),
                ...result.errors
            ].join("\n\n"));
        } catch (installError) {
            setError([
                t("sandbox.setup.failedMessage"),
                installError instanceof Error ? installError.message : String(installError)
            ].join("\n\n"));
        } finally {
            setInstalling(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                showCloseButton={!installing}
                aria-busy={installing}
                onOpenAutoFocus={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => {
                    if (installing) event.preventDefault();
                }}
                onInteractOutside={(event) => {
                    if (installing) event.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="size-5 text-amber-600" />
                        {t("sandbox.setup.title")}
                    </DialogTitle>
                    <DialogDescription>{t("sandbox.setup.message")}</DialogDescription>
                </DialogHeader>

                {error ? (
                    <p
                        role="alert"
                        className="max-h-32 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs whitespace-pre-wrap text-destructive"
                    >
                        {error}
                    </p>
                ) : null}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={installing}
                        onClick={() => handleOpenChange(false)}
                    >
                        {t("sandbox.setup.dismiss")}
                    </Button>
                    <Button
                        type="button"
                        disabled={installing}
                        className="bg-[#1F6FEB] text-white hover:bg-[#1F6FEB]/90"
                        onClick={() => void handleInstall()}
                    >
                        {installing ? <LoaderCircle className="animate-spin" /> : <ShieldAlert />}
                        {installing ? t("sandbox.setup.installing") : t("sandbox.setup.install")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

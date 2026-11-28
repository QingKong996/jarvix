import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelCost } from "../../../../protocol/providers.ts";
import { DialogFooter } from "../common/DialogFooter.tsx";
import { ModelPricingFields } from "../common/ModelPricingFields.tsx";
import { Button } from "../ui/button.tsx";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "../ui/dialog.tsx";

type UsagePricingDialogProps = {
    open: boolean;
    provider: string;
    model: string;
    cost: ModelCost;
    onOpenChange: (open: boolean) => void;
    onSave: (cost: ModelCost) => Promise<void>;
};

export function UsagePricingDialog({
    open,
    provider,
    model,
    cost,
    onOpenChange,
    onSave
}: UsagePricingDialogProps) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(cost);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setDraft(cost);
            setError(null);
        }
    }, [cost, open]);

    async function save(): Promise<void> {
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            await onSave(draft);
            onOpenChange(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                aria-describedby={undefined}
                showCloseButton={!saving}
                className="gap-0 overflow-hidden p-0 sm:max-w-md"
            >
                <DialogHeader className="flex h-14 justify-center border-b border-border px-6">
                    <DialogTitle>{t("rightSidebar.usage.editPrice")}</DialogTitle>
                    <DialogDescription className="truncate text-xs">
                        {provider} / {model}
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto p-6">
                    <ModelPricingFields
                        cost={draft}
                        disabled={saving}
                        onChange={setDraft}
                    />
                </div>
                <DialogFooter
                    error={error}
                    className="gap-2.5 border-t border-border bg-sidebar/50 px-6 py-3.5"
                >
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                    >
                        {t("settings.cancel")}
                    </Button>
                    <Button type="button" disabled={saving} onClick={() => void save()}>
                        {saving ? <LoaderCircle className="animate-spin" /> : null}
                        {t("settings.save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

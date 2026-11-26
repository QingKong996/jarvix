import { useId, type FormEvent } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelDefinition } from "../../../../../protocol/providers.ts";
import { DialogFooter } from "../../common/DialogFooter.tsx";
import { FormField } from "../../common/FormField.tsx";
import { Button } from "../../ui/button.tsx";
import { Input } from "../../ui/input.tsx";

type ModelConfigPanelProps = {
    model: ModelDefinition;
    originalId?: string;
    error: string;
    disabled: boolean;
    onChange: (patch: Partial<ModelDefinition>) => void;
    onClose: () => void;
    onSave: () => void;
};

export function containNestedFormSubmit(
    event: Pick<FormEvent<HTMLFormElement>, "preventDefault" | "stopPropagation">
): void {
    event.preventDefault();
    event.stopPropagation();
}

export function ModelConfigPanel({
    model,
    originalId,
    error,
    disabled,
    onChange,
    onClose,
    onSave
}: ModelConfigPanelProps) {
    const { t } = useTranslation();
    const titleId = useId();

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        containNestedFormSubmit(event);
        onSave();
    }

    return (
        <section aria-labelledby={titleId} className="flex h-full min-h-0 flex-col">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-6">
                <h3 id={titleId} className="text-base font-semibold tracking-tight">
                    {originalId === undefined ? t("settings.providers.addModel") : t("settings.providers.modelSettings")}
                </h3>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("ui.dialog.close")}
                    onClick={onClose}
                    className="text-muted-foreground hover:text-foreground"
                >
                    <X />
                </Button>
            </div>
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6 text-sm">
                    <FormField label={t("settings.providers.modelName")}>
                        <Input
                            required
                            autoFocus
                            value={model.name}
                            disabled={disabled}
                            onChange={(event) => onChange({ name: event.target.value })}
                        />
                    </FormField>
                    <FormField label={t("settings.providers.modelId")}>
                        <Input
                            required
                            value={model.id}
                            disabled={disabled}
                            onChange={(event) => onChange({ id: event.target.value })}
                        />
                    </FormField>
                    <div className="grid grid-cols-2 gap-3">
                        <FormField label={t("settings.providers.contextWindow")}>
                            <Input
                                type="number"
                                min={1}
                                step={1}
                                required
                                value={model.contextWindow}
                                disabled={disabled}
                                onChange={(event) => onChange({ contextWindow: Number(event.target.value) })}
                            />
                        </FormField>
                        <FormField label={t("settings.providers.maxTokens")}>
                            <Input
                                type="number"
                                min={1}
                                step={1}
                                required
                                value={model.maxTokens}
                                disabled={disabled}
                                onChange={(event) => onChange({ maxTokens: Number(event.target.value) })}
                            />
                        </FormField>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
                        <input
                            type="checkbox"
                            checked={model.reasoning}
                            disabled={disabled}
                            onChange={(event) => onChange({ reasoning: event.target.checked })}
                            className="size-4 accent-primary"
                        />
                        {t("settings.providers.reasoning")}
                    </label>
                </div>
                <DialogFooter error={error} className="border-t border-border bg-sidebar/50 px-6 py-3.5">
                    <Button type="button" variant="outline" onClick={onClose}>{t("settings.cancel")}</Button>
                    <Button type="submit" disabled={disabled}>
                        {t("settings.providers.applyModel")}
                    </Button>
                </DialogFooter>
            </form>
        </section>
    );
}

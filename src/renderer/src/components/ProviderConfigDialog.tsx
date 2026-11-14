import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import {
    DEFAULT_MODEL,
    PROVIDER_PROTOCOLS,
    modelDefinitionSchema,
    providerConfigSchema,
    type ModelDefinition,
    type ModelSelection,
    type ProviderConfig
} from "../../../protocol/providers.ts";

type ProviderConfigDialogProps = {
    provider: ProviderConfig;
    selectedModel?: ModelSelection;
    disabled: boolean;
    onClose: () => void;
    onSave: (provider: ProviderConfig, selection?: ModelSelection) => void;
};

export function ProviderConfigDialog({ provider, selectedModel, disabled, onClose, onSave }: ProviderConfigDialogProps) {
    const { t } = useTranslation();
    const formId = useId();
    const [draft, setDraft] = useState(provider);
    const [selection, setSelection] = useState(selectedModel);
    const [modelId, setModelId] = useState("");
    const [query, setQuery] = useState("");
    const [revealed, setRevealed] = useState(false);
    const [error, setError] = useState("");
    const selected = selection ?? DEFAULT_MODEL;
    const activeModel = selected.provider === draft.id ? draft.models.find((model) => model.id === selected.id) : undefined;
    const search = query.trim().toLowerCase();
    const visibleModels = draft.models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(search));

    function update(patch: Partial<ProviderConfig>): void {
        setDraft((current) => ({ ...current, ...patch }));
        setError("");
    }

    function updateModel(model: ModelDefinition, patch: Partial<ModelDefinition>): void {
        update({ models: draft.models.map((item) => item.id === model.id ? { ...item, ...patch } : item) });
    }

    function addModel(): void {
        const id = modelId.trim();
        if (!id || draft.models.some((model) => model.id === id)) return;
        update({ models: [...draft.models, modelDefinitionSchema.parse({ id, name: id })] });
        setModelId("");
    }

    function removeModel(model: ModelDefinition): void {
        update({ models: draft.models.filter((item) => item.id !== model.id) });
        if (selection?.provider === draft.id && selection.id === model.id) setSelection(undefined);
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        const parsed = providerConfigSchema.safeParse(draft);
        if (!parsed.success) {
            setError(t("settings.providers.invalidConfig"));
            return;
        }
        const current = selection ?? DEFAULT_MODEL;
        if (current.provider === draft.id && !draft.models.some((model) => model.id === current.id)) {
            setError(t("settings.providers.selectModel"));
            return;
        }
        onSave(parsed.data, selection);
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent aria-describedby={undefined} className="gap-0 overflow-hidden p-0 sm:max-w-xl">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle className="flex items-center gap-3">
                        <ProviderIcon id={draft.id} name={draft.name} />
                        {provider.name}
                    </DialogTitle>
                </DialogHeader>

                <form id={formId} onSubmit={handleSubmit} className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto p-6 text-sm">
                    <Field label={t("settings.providers.name")}>
                        <Input value={draft.name} required disabled={disabled} onChange={(event) => update({ name: event.target.value })} />
                    </Field>
                    <div className="flex items-center justify-between gap-4">
                        <span className="font-medium">{t("settings.providers.protocol")}</span>
                        <Select value={draft.protocol} disabled={disabled} onValueChange={(value) => {
                            const protocol = PROVIDER_PROTOCOLS.find((item) => item === value);
                            if (protocol) update({ protocol });
                        }}>
                            <SelectTrigger className="w-64 max-w-[75%]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PROVIDER_PROTOCOLS.map((protocol) => <SelectItem key={protocol} value={protocol}>{protocol}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <Field label="Base URL">
                        <Input required value={draft.baseUrl} disabled={disabled} onChange={(event) => update({ baseUrl: event.target.value })} />
                    </Field>
                    <Field label={t("settings.providers.apiKey")}>
                        <div className="relative">
                            <Input
                                type={revealed ? "text" : "password"}
                                autoComplete="off"
                                value={draft.apiKey ?? ""}
                                placeholder={draft.env.join(" / ")}
                                disabled={disabled}
                                onChange={(event) => update({ apiKey: event.target.value })}
                                className="pr-10"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                disabled={disabled}
                                aria-label={t(revealed ? "settings.model.hideKey" : "settings.model.revealKey")}
                                onClick={() => setRevealed(!revealed)}
                                className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
                            >
                                {revealed ? <EyeOff /> : <Eye />}
                            </Button>
                        </div>
                    </Field>

                    <fieldset className="flex min-w-0 flex-col gap-3 border-t pt-4">
                        <legend className="pr-2 font-medium">{t("settings.providers.models")}</legend>
                        <Input
                            aria-label={t("settings.providers.search")}
                            placeholder={t("settings.providers.search")}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                        <div className="max-h-44 overflow-y-auto rounded-md border">
                            {visibleModels.map((model) => (
                                <div key={model.id} className="flex items-center gap-2 px-3 py-2 hover:bg-accent">
                                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                        <input
                                            type="radio"
                                            name={`${formId}-selected-model`}
                                            disabled={disabled}
                                            checked={selected.provider === draft.id && selected.id === model.id}
                                            onChange={() => { setSelection({ provider: draft.id, id: model.id }); setError(""); }}
                                        />
                                        <span className="truncate" title={model.id}>{model.name}</span>
                                    </label>
                                    <Button type="button" size="icon-xs" variant="ghost" disabled={disabled} aria-label={t("settings.providers.removeModel")} onClick={() => removeModel(model)}>
                                        <X />
                                    </Button>
                                </div>
                            ))}
                            {visibleModels.length === 0 ? <p className="px-3 py-3 text-muted-foreground">{t("settings.providers.noModels")}</p> : null}
                        </div>
                        <div className="flex gap-2">
                            <Input value={modelId} disabled={disabled} placeholder={t("settings.providers.modelId")} aria-label={t("settings.providers.modelId")} onChange={(event) => setModelId(event.target.value)} />
                            <Button type="button" variant="outline" disabled={disabled || !modelId.trim() || draft.models.some((model) => model.id === modelId.trim())} onClick={addModel}>
                                <Plus />
                                {t("settings.providers.addModel")}
                            </Button>
                        </div>
                    </fieldset>

                    {activeModel ? (
                        <div className="flex flex-col gap-3 rounded-md border p-3">
                            <Field label={t("settings.providers.modelName")}>
                                <Input value={activeModel.name} required disabled={disabled} onChange={(event) => updateModel(activeModel, { name: event.target.value })} />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label={t("settings.providers.contextWindow")}>
                                    <Input type="number" min={1} step={1} required value={activeModel.contextWindow} disabled={disabled} onChange={(event) => updateModel(activeModel, { contextWindow: Number(event.target.value) })} />
                                </Field>
                                <Field label={t("settings.providers.maxTokens")}>
                                    <Input type="number" min={1} step={1} required value={activeModel.maxTokens} disabled={disabled} onChange={(event) => updateModel(activeModel, { maxTokens: Number(event.target.value) })} />
                                </Field>
                            </div>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={activeModel.reasoning} disabled={disabled} onChange={(event) => updateModel(activeModel, { reasoning: event.target.checked })} />
                                {t("settings.providers.reasoning")}
                            </label>
                        </div>
                    ) : null}
                </form>

                <div className="flex items-center justify-end gap-3 border-t px-6 py-3">
                    {error ? <p role="alert" className="mr-auto text-xs text-destructive">{error}</p> : null}
                    <Button type="button" variant="outline" onClick={onClose}>{t("settings.cancel")}</Button>
                    <Button type="submit" form={formId} disabled={disabled}>{t("settings.save")}</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <label className="flex flex-col gap-2"><span className="font-medium">{label}</span>{children}</label>;
}

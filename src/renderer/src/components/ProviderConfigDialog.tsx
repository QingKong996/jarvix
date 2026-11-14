import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, Minus, Plus, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import {
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

type ModelEditorState = {
    model: ModelDefinition;
    originalId?: string;
};

export function ProviderConfigDialog({ provider, selectedModel, disabled, onClose, onSave }: ProviderConfigDialogProps) {
    const { t } = useTranslation();
    const formId = useId();
    const [draft, setDraft] = useState(provider);
    const [selection, setSelection] = useState(selectedModel);
    const [editingModel, setEditingModel] = useState<ModelEditorState>();
    const [modelDraft, setModelDraft] = useState<ModelDefinition>();
    const [modelError, setModelError] = useState("");
    const [pendingModel, setPendingModel] = useState<ModelEditorState>();
    const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
    const [modelEditorVersion, setModelEditorVersion] = useState(0);
    const [modelPanelOpen, setModelPanelOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [revealed, setRevealed] = useState(false);
    const [syncingModels, setSyncingModels] = useState(false);
    const [error, setError] = useState("");
    const search = query.trim().toLowerCase();
    const visibleModels = draft.models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(search));
    const modelDirty = editingModel !== undefined &&
        modelDraft !== undefined &&
        JSON.stringify(editingModel.model) !== JSON.stringify(modelDraft);

    useEffect(() => {
        if (modelPanelOpen || !editingModel) return;
        const timeout = window.setTimeout(() => {
            setEditingModel(undefined);
            setModelDraft(undefined);
        }, 320);
        return () => window.clearTimeout(timeout);
    }, [editingModel, modelPanelOpen]);

    function update(patch: Partial<ProviderConfig>): void {
        setDraft((current) => ({ ...current, ...patch }));
        setError("");
    }

    function activateModelPanel(model: ModelEditorState): void {
        setModelEditorVersion((version) => version + 1);
        setEditingModel(model);
        setModelDraft(model.model);
        setModelError("");
        setModelPanelOpen(true);
    }

    function openModelPanel(model: ModelEditorState): void {
        if (modelPanelOpen && editingModel?.originalId === model.originalId) return;
        if (modelPanelOpen && modelDirty) {
            setPendingModel(model);
            setSwitchDialogOpen(true);
            return;
        }
        activateModelPanel(model);
    }

    function closeModelPanel(): void {
        setModelPanelOpen(false);
    }

    function closeSwitchDialog(): void {
        setSwitchDialogOpen(false);
        setPendingModel(undefined);
    }

    function addModel(): void {
        const defaults = modelDefinitionSchema.parse({ id: "_", name: "_" });
        openModelPanel({ model: { ...defaults, id: "", name: "" } });
    }

    function updateModelDraft(patch: Partial<ModelDefinition>): void {
        setModelDraft((current) => current ? { ...current, ...patch } : current);
        setModelError("");
    }

    function applyModelDraft(): boolean {
        if (!editingModel || !modelDraft) return false;
        const next = { ...modelDraft, id: modelDraft.id.trim(), name: modelDraft.name.trim() };
        const parsed = modelDefinitionSchema.safeParse(next);
        if (!parsed.success) {
            setModelError(t("settings.providers.invalidModel"));
            return false;
        }
        if (draft.models.some((candidate) =>
            candidate.id === parsed.data.id && candidate.id !== editingModel.originalId
        )) {
            setModelError(t("settings.providers.duplicateModelId"));
            return false;
        }
        const model = parsed.data;
        const models = editingModel.originalId === undefined
            ? [...draft.models, model]
            : draft.models.map((item) => item.id === editingModel.originalId ? model : item);
        update({ models });
        if (selection?.provider === draft.id && selection.id === editingModel.originalId) {
            setSelection({ provider: draft.id, id: model.id });
        }
        return true;
    }

    function saveModel(): void {
        if (applyModelDraft()) closeModelPanel();
    }

    function saveAndSwitch(): void {
        const next = pendingModel;
        const saved = applyModelDraft();
        closeSwitchDialog();
        if (saved && next) activateModelPanel(next);
    }

    function discardAndSwitch(): void {
        const next = pendingModel;
        closeSwitchDialog();
        if (next) activateModelPanel(next);
    }

    function removeModel(model: ModelDefinition): void {
        update({ models: draft.models.filter((item) => item.id !== model.id) });
        if (selection?.provider === draft.id && selection.id === model.id) setSelection(undefined);
        if (editingModel?.originalId === model.id) closeModelPanel();
    }

    async function syncModels(): Promise<void> {
        if (!window.jarvix || syncingModels) return;
        setSyncingModels(true);
        setError("");
        try {
            const remoteModels = await window.jarvix.syncProviderModels({
                baseUrl: draft.baseUrl,
                apiKey: draft.apiKey,
                env: draft.env
            });
            if (remoteModels.length === 0) {
                setError(t("settings.providers.syncEmpty"));
                return;
            }
            const existing = new Map(draft.models.map((model) => [model.id, model]));
            const models = remoteModels.map((model) => existing.get(model.id) ?? model);
            update({ models });
            if (selection?.provider === draft.id && !models.some((model) => model.id === selection.id)) {
                setSelection(undefined);
            }
        } catch {
            setError(t("settings.providers.syncFailed"));
        } finally {
            setSyncingModels(false);
        }
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        event.stopPropagation();
        if (disabled || syncingModels || modelPanelOpen) return;
        const parsed = providerConfigSchema.safeParse(draft);
        if (!parsed.success) {
            setError(t("settings.providers.invalidConfig"));
            return;
        }
        onSave(parsed.data, selection);
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                aria-describedby={undefined}
                showCloseButton={!modelPanelOpen}
                onEscapeKeyDown={(event) => {
                    if (switchDialogOpen) {
                        event.preventDefault();
                        return;
                    }
                    if (!modelPanelOpen) return;
                    event.preventDefault();
                    closeModelPanel();
                }}
                onPointerDownOutside={(event) => {
                    if (switchDialogOpen) {
                        event.preventDefault();
                        return;
                    }
                    if (!modelPanelOpen) return;
                    event.preventDefault();
                    closeModelPanel();
                }}
                className="gap-0 overflow-hidden p-0"
                style={{
                    maxWidth: modelPanelOpen
                        ? "min(56rem, calc(100% - 2rem))"
                        : "min(36rem, calc(100% - 2rem))",
                    transition: "max-width 300ms cubic-bezier(0.22, 1, 0.36, 1)"
                }}
            >
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle className="flex items-center gap-3">
                        <ProviderIcon id={draft.id} name={draft.name} />
                        {provider.name}
                    </DialogTitle>
                </DialogHeader>

                <div className="relative min-w-0 overflow-hidden">
                    <div className={`flex min-w-0 flex-col transition-[margin-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        modelPanelOpen ? "mr-96" : "mr-0"
                    }`}>
                        <form id={formId} onSubmit={handleSubmit} className="flex max-h-[clamp(18rem,62dvh,32rem)] flex-col gap-4 overflow-y-auto p-6 text-sm">
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
                                <div className="flex items-center justify-between gap-3">
                                    <Button type="button" variant="outline" disabled={disabled || syncingModels || modelPanelOpen} onClick={addModel}>
                                        <Plus />
                                        {t("settings.providers.addModel")}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={disabled || syncingModels || modelPanelOpen}
                                        aria-busy={syncingModels}
                                        onClick={() => void syncModels()}
                                    >
                                        <RefreshCw className={syncingModels ? "animate-spin" : undefined} />
                                        {t(syncingModels ? "settings.providers.syncingModels" : "settings.providers.syncModels")}
                                    </Button>
                                </div>
                                <Input
                                    aria-label={t("settings.providers.search")}
                                    placeholder={t("settings.providers.search")}
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                />
                                <ul className="min-h-28 max-h-44 overflow-y-auto rounded-md border [scrollbar-width:thin]">
                                    {visibleModels.length > 0 ? visibleModels.map((model) => (
                                        <ModelListItem
                                            key={model.id}
                                            model={model}
                                            active={modelPanelOpen && editingModel?.originalId === model.id}
                                            disabled={disabled || syncingModels}
                                            removeDisabled={disabled || syncingModels || modelPanelOpen}
                                            onSelect={() => openModelPanel({ model, originalId: model.id })}
                                            onRemove={() => removeModel(model)}
                                        />
                                    )) : (
                                        <li role="status" className="flex min-h-28 items-center justify-center px-4 text-center text-muted-foreground">
                                            {t("settings.providers.noModels")}
                                        </li>
                                    )}
                                </ul>
                            </fieldset>
                        </form>

                        <div className="flex items-center justify-end gap-3 border-t px-6 py-3">
                            {error ? <p role="alert" className="mr-auto text-xs text-destructive">{error}</p> : null}
                            <Button type="button" variant="outline" onClick={onClose}>{t("settings.cancel")}</Button>
                            <Button type="submit" form={formId} disabled={disabled || syncingModels || modelPanelOpen}>{t("settings.save")}</Button>
                        </div>
                    </div>

                    <aside
                        inert={!modelPanelOpen}
                        className={`absolute inset-y-0 right-0 w-96 bg-card transition-[opacity,transform,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                            modelPanelOpen
                                ? "translate-x-0 border-l opacity-100"
                                : "pointer-events-none translate-x-full border-l-0 opacity-0"
                        }`}
                    >
                        {editingModel && modelDraft ? (
                            <ModelConfigPage
                                key={`${editingModel.originalId ?? "new"}-${editingModel.model.id}-${modelEditorVersion}`}
                                model={modelDraft}
                                originalId={editingModel.originalId}
                                error={modelError}
                                disabled={disabled}
                                onChange={updateModelDraft}
                                onClose={closeModelPanel}
                                onSave={saveModel}
                            />
                        ) : null}
                    </aside>
                </div>
            </DialogContent>

            <Dialog open={switchDialogOpen} onOpenChange={(open) => { if (!open) closeSwitchDialog(); }}>
                <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
                    <DialogHeader className="border-b px-6 py-4">
                        <DialogTitle>{t("settings.providers.unsavedModelTitle")}</DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="px-6 py-5">
                        {t("settings.providers.unsavedModelDescription", { name: pendingModel?.model.name ?? "" })}
                    </DialogDescription>
                    <div className="flex items-center justify-end gap-3 border-t px-6 py-3">
                        <Button type="button" variant="outline" onClick={discardAndSwitch}>
                            {t("settings.providers.discardChanges")}
                        </Button>
                        <Button type="button" onClick={saveAndSwitch}>
                            {t("settings.save")}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}

type ModelListItemProps = {
    model: ModelDefinition;
    active: boolean;
    disabled: boolean;
    removeDisabled: boolean;
    onSelect: () => void;
    onRemove: () => void;
};

function ModelListItem({ model, active, disabled, removeDisabled, onSelect, onRemove }: ModelListItemProps) {
    const { t } = useTranslation();

    return (
        <li
            data-state={active ? "open" : "closed"}
            className="group flex items-center gap-1 rounded-md px-1 py-1 transition-colors data-[state=closed]:hover:bg-accent data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
            <button
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={onSelect}
                className="min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            >
                <span className="block truncate" title={model.id}>{model.name}</span>
            </button>
            <Button
                type="button"
                size="icon-xs"
                variant="secondary"
                disabled={removeDisabled}
                aria-label={t("settings.providers.removeModel")}
                onClick={onRemove}
                className="mr-1 border border-border bg-muted/40 hover:bg-muted/60"
            >
                <Minus />
            </Button>
        </li>
    );
}

type ModelConfigPageProps = {
    model: ModelDefinition;
    originalId?: string;
    error: string;
    disabled: boolean;
    onChange: (patch: Partial<ModelDefinition>) => void;
    onClose: () => void;
    onSave: () => void;
};

function ModelConfigPage({ model, originalId, error, disabled, onChange, onClose, onSave }: ModelConfigPageProps) {
    const { t } = useTranslation();
    const titleId = useId();

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        onSave();
    }

    return (
        <section aria-labelledby={titleId} className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
                <h3 id={titleId} className="text-base font-semibold">
                    {originalId === undefined ? t("settings.providers.addModel") : t("settings.providers.modelSettings")}
                </h3>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("ui.dialog.close")}
                    onClick={onClose}
                >
                    <X />
                </Button>
            </div>
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 text-sm">
                    <Field label={t("settings.providers.modelName")}>
                        <Input
                            required
                            autoFocus
                            value={model.name}
                            disabled={disabled}
                            onChange={(event) => onChange({ name: event.target.value })}
                        />
                    </Field>
                    <Field label={t("settings.providers.modelId")}>
                        <Input
                            required
                            value={model.id}
                            disabled={disabled}
                            onChange={(event) => onChange({ id: event.target.value })}
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={t("settings.providers.contextWindow")}>
                            <Input
                                type="number"
                                min={1}
                                step={1}
                                required
                                value={model.contextWindow}
                                disabled={disabled}
                                onChange={(event) => onChange({ contextWindow: Number(event.target.value) })}
                            />
                        </Field>
                        <Field label={t("settings.providers.maxTokens")}>
                            <Input
                                type="number"
                                min={1}
                                step={1}
                                required
                                value={model.maxTokens}
                                disabled={disabled}
                                onChange={(event) => onChange({ maxTokens: Number(event.target.value) })}
                            />
                        </Field>
                    </div>
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={model.reasoning}
                            disabled={disabled}
                            onChange={(event) => onChange({ reasoning: event.target.checked })}
                        />
                        {t("settings.providers.reasoning")}
                    </label>
                </div>
                <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
                    {error ? <p role="alert" className="mr-auto text-xs text-destructive">{error}</p> : null}
                    <Button type="button" variant="outline" onClick={onClose}>{t("settings.cancel")}</Button>
                    <Button type="submit" disabled={disabled}>
                        {t("settings.providers.applyModel")}
                    </Button>
                </div>
            </form>
        </section>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <label className="flex flex-col gap-2"><span className="font-medium">{label}</span>{children}</label>;
}

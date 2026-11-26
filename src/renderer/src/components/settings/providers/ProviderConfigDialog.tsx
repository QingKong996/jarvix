import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { animate, motion } from "motion/react";
import {
    modelDefinitionSchema,
    providerConfigSchema,
    type ModelDefinition,
    type ModelSelection,
    type ProviderConfig
} from "../../../../../protocol/providers.ts";
import { DialogFooter } from "../../common/DialogFooter.tsx";
import { ModelConfigPanel } from "./ModelConfigPanel.tsx";
import { ProviderConfigForm } from "./ProviderConfigForm.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { mergeSyncedModels } from "./model-merge.ts";
import { Button } from "../../ui/button.tsx";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "../../ui/dialog.tsx";
import { panelTransition, smoothTransition } from "../../../motion.ts";
import { useMediaQuery } from "../../../use-media-query.ts";

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
    const contentRef = useRef<HTMLDivElement>(null);
    const initialDialogWidth = useRef(modelPanelOpen ? "56rem" : "36rem");
    const wideViewport = useMediaQuery("(min-width: 640px)");
    const modelDirty = editingModel !== undefined &&
        modelDraft !== undefined &&
        JSON.stringify(editingModel.model) !== JSON.stringify(modelDraft);

    useEffect(() => {
        const element = contentRef.current;
        if (!element) return;
        const controls = animate(element, {
            "--dialog-width": modelPanelOpen ? "56rem" : "36rem"
        }, smoothTransition);
        return () => controls.stop();
    }, [modelPanelOpen]);

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
        if (applyModelDraft()) setModelPanelOpen(false);
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
        if (editingModel?.originalId === model.id) setModelPanelOpen(false);
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
            const models = mergeSyncedModels(draft.models, remoteModels);
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
                    setModelPanelOpen(false);
                }}
                onPointerDownOutside={(event) => {
                    if (switchDialogOpen) {
                        event.preventDefault();
                        return;
                    }
                    if (!modelPanelOpen) return;
                    event.preventDefault();
                    setModelPanelOpen(false);
                }}
                className="gap-0 overflow-hidden p-0"
                style={{
                    "--dialog-width": initialDialogWidth.current,
                    maxWidth: "min(var(--dialog-width), calc(100% - 2rem))"
                } as CSSProperties}
                contentRef={contentRef}
            >
                <DialogHeader className="flex h-14 justify-center border-b border-border px-6">
                    <DialogTitle className="flex items-center gap-2.5">
                        <ProviderIcon id={draft.id} name={draft.name} />
                        {provider.name}
                    </DialogTitle>
                </DialogHeader>

                <div className="relative min-w-0 overflow-hidden">
                    <motion.div
                        animate={{ marginRight: wideViewport && modelPanelOpen ? 384 : 0 }}
                        transition={panelTransition}
                        className="flex min-w-0 flex-col"
                    >
                        <ProviderConfigForm
                            formId={formId}
                            draft={draft}
                            disabled={disabled}
                            syncingModels={syncingModels}
                            modelPanelOpen={modelPanelOpen}
                            editingModelId={editingModel?.originalId}
                            query={query}
                            revealed={revealed}
                            onQueryChange={setQuery}
                            onRevealChange={setRevealed}
                            onUpdate={update}
                            onAddModel={addModel}
                            onSyncModels={() => void syncModels()}
                            onOpenModel={(model) => openModelPanel({ model, originalId: model.id })}
                            onRemoveModel={removeModel}
                            onSubmit={handleSubmit}
                        />

                        <DialogFooter error={error} className="gap-2.5 border-t border-border bg-sidebar/50 px-6 py-3.5">
                            <Button type="button" variant="outline" onClick={onClose}>{t("settings.cancel")}</Button>
                            <Button type="submit" form={formId} disabled={disabled || syncingModels || modelPanelOpen}>
                                {t("settings.save")}
                            </Button>
                        </DialogFooter>
                    </motion.div>

                    <motion.aside
                        inert={!modelPanelOpen}
                        aria-hidden={!modelPanelOpen}
                        initial={false}
                        animate={{
                            x: modelPanelOpen ? 0 : "100%",
                            opacity: modelPanelOpen ? 1 : 0
                        }}
                        transition={panelTransition}
                        onAnimationComplete={() => {
                            if (modelPanelOpen) return;
                            setEditingModel(undefined);
                            setModelDraft(undefined);
                        }}
                        className={`absolute inset-y-0 right-0 w-full border-l border-border bg-card sm:w-96 ${
                            modelPanelOpen ? "pointer-events-auto" : "pointer-events-none"
                        }`}
                    >
                        {editingModel && modelDraft ? (
                            <ModelConfigPanel
                                key={`${editingModel.originalId ?? "new"}-${editingModel.model.id}-${modelEditorVersion}`}
                                model={modelDraft}
                                originalId={editingModel.originalId}
                                error={modelError}
                                disabled={disabled}
                                onChange={updateModelDraft}
                                onClose={() => setModelPanelOpen(false)}
                                onSave={saveModel}
                            />
                        ) : null}
                    </motion.aside>
                </div>
            </DialogContent>

            <Dialog open={switchDialogOpen} onOpenChange={(open) => { if (!open) closeSwitchDialog(); }}>
                <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
                    <DialogHeader className="flex h-14 justify-center border-b border-border px-6">
                        <DialogTitle>{t("settings.providers.unsavedModelTitle")}</DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="px-6 py-5">
                        {t("settings.providers.unsavedModelDescription", { name: pendingModel?.model.name ?? "" })}
                    </DialogDescription>
                    <DialogFooter className="gap-2.5 border-t border-border bg-sidebar/50 px-6 py-3.5">
                        <Button type="button" variant="outline" onClick={discardAndSwitch}>
                            {t("settings.providers.discardChanges")}
                        </Button>
                        <Button type="button" onClick={saveAndSwitch}>
                            {t("settings.save")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}

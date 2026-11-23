import { Eye, EyeOff, Minus, Plus, RefreshCw } from "lucide-react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
    PROVIDER_PROTOCOLS,
    type ModelDefinition,
    type ProviderConfig
} from "../../../../../protocol/providers.ts";
import { FormField } from "../../common/FormField.tsx";
import { Button } from "../../ui/button.tsx";
import { Input } from "../../ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select.tsx";

type ProviderConfigFormProps = {
    formId: string;
    draft: ProviderConfig;
    disabled: boolean;
    syncingModels: boolean;
    modelPanelOpen: boolean;
    editingModelId?: string;
    query: string;
    revealed: boolean;
    onQueryChange(value: string): void;
    onRevealChange(revealed: boolean): void;
    onUpdate(patch: Partial<ProviderConfig>): void;
    onAddModel(): void;
    onSyncModels(): void;
    onOpenModel(model: ModelDefinition): void;
    onRemoveModel(model: ModelDefinition): void;
    onSubmit(event: FormEvent<HTMLFormElement>): void;
};

export function ProviderConfigForm({
    formId,
    draft,
    disabled,
    syncingModels,
    modelPanelOpen,
    editingModelId,
    query,
    revealed,
    onQueryChange,
    onRevealChange,
    onUpdate,
    onAddModel,
    onSyncModels,
    onOpenModel,
    onRemoveModel,
    onSubmit
}: ProviderConfigFormProps) {
    const { t } = useTranslation();
    const search = query.trim().toLowerCase();
    const visibleModels = draft.models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(search));
    const fieldsDisabled = disabled || modelPanelOpen || syncingModels;

    return (
        <form
            id={formId}
            onSubmit={onSubmit}
            className="flex max-h-[clamp(18rem,62dvh,32rem)] flex-col gap-4 overflow-y-auto p-6 text-sm"
        >
            <FormField label={t("settings.providers.name")}>
                <Input
                    value={draft.name}
                    required
                    aria-label={t("settings.providers.name")}
                    disabled={fieldsDisabled}
                    onChange={(event) => onUpdate({ name: event.target.value })}
                />
            </FormField>

            <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{t("settings.providers.protocol")}</span>
                <Select
                    value={draft.protocol}
                    disabled={fieldsDisabled}
                    onValueChange={(value) => {
                        const protocol = PROVIDER_PROTOCOLS.find((item) => item === value);
                        if (protocol) onUpdate({ protocol });
                    }}
                >
                    <SelectTrigger
                        aria-label={t("settings.providers.protocol")}
                        className="w-64 max-w-[75%]"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {PROVIDER_PROTOCOLS.map((protocol) => (
                            <SelectItem key={protocol} value={protocol}>{protocol}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <FormField label="Base URL">
                <Input
                    required
                    value={draft.baseUrl}
                    aria-label="Base URL"
                    disabled={fieldsDisabled}
                    onChange={(event) => onUpdate({ baseUrl: event.target.value })}
                    data-testid="provider-base-url"
                />
            </FormField>

            <FormField label={t("settings.providers.apiKey")}>
                <div className="relative">
                    <Input
                        type={revealed ? "text" : "password"}
                        autoComplete="off"
                        value={draft.apiKey ?? ""}
                        aria-label={t("settings.providers.apiKey")}
                        placeholder={draft.env.join(" / ")}
                        disabled={fieldsDisabled}
                        onChange={(event) => onUpdate({ apiKey: event.target.value })}
                        className="pr-10"
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={fieldsDisabled}
                        aria-label={t(revealed ? "settings.providers.hideKey" : "settings.providers.revealKey")}
                        onClick={() => onRevealChange(!revealed)}
                        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
                    >
                        {revealed ? <EyeOff /> : <Eye />}
                    </Button>
                </div>
            </FormField>

            <fieldset className="flex min-w-0 flex-col gap-3 border-t pt-4">
                <legend className="pr-2 font-medium">{t("settings.providers.models")}</legend>
                <div className="flex items-center justify-between gap-3">
                    <Button type="button" variant="outline" disabled={disabled || syncingModels || modelPanelOpen} onClick={onAddModel}>
                        <Plus />
                        {t("settings.providers.addModel")}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={disabled || syncingModels || modelPanelOpen}
                        aria-busy={syncingModels}
                        onClick={onSyncModels}
                    >
                        <RefreshCw className={syncingModels ? "animate-spin" : undefined} />
                        {t(syncingModels ? "settings.providers.syncingModels" : "settings.providers.syncModels")}
                    </Button>
                </div>
                <Input
                    aria-label={t("settings.providers.search")}
                    placeholder={t("settings.providers.search")}
                    value={query}
                    disabled={modelPanelOpen}
                    onChange={(event) => onQueryChange(event.target.value)}
                />
                <ul className="min-h-28 max-h-44 overflow-y-auto rounded-md border [scrollbar-width:thin]">
                    {visibleModels.length > 0 ? visibleModels.map((model) => (
                        <ModelListItem
                            key={model.id}
                            model={model}
                            active={modelPanelOpen && editingModelId === model.id}
                            disabled={disabled || syncingModels}
                            removeDisabled={disabled || syncingModels || modelPanelOpen}
                            onSelect={() => onOpenModel(model)}
                            onRemove={() => onRemoveModel(model)}
                        />
                    )) : (
                        <li role="status" className="flex min-h-28 items-center justify-center px-4 text-center text-muted-foreground">
                            {t("settings.providers.noModels")}
                        </li>
                    )}
                </ul>
            </fieldset>
        </form>
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

import { useEffect, useState } from "react";
import { ChevronDown, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import { ProviderConfigDialog } from "./ProviderConfigDialog.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import {
    DEFAULT_MODEL,
    type ModelCatalog,
    type ProviderCatalogEntry,
    type ProviderConfig,
    type ModelSelection
} from "../../../protocol/providers.ts";

type ProviderSettingsProps = {
    providers: ProviderConfig[];
    selectedModel?: ModelSelection;
    legacyApiKey?: string;
    disabled: boolean;
    onChange: (providers: ProviderConfig[], selection?: ModelSelection) => void;
};

export function ProviderSettings({ providers, selectedModel, legacyApiKey, disabled, onChange }: ProviderSettingsProps) {
    const { t } = useTranslation();
    const [catalog, setCatalog] = useState<ModelCatalog>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState<ProviderConfig>();

    useEffect(() => {
        let active = true;
        setLoading(true);
        void window.jarvix?.getModelCatalog().then((next) => {
            if (active) setCatalog(next);
        }).catch((cause: unknown) => {
            if (active) setError(String(cause));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, []);

    async function refresh(): Promise<void> {
        setLoading(true);
        setError("");
        try {
            setCatalog(await window.jarvix!.getModelCatalog(true));
        } catch (cause) {
            setError(String(cause));
        } finally {
            setLoading(false);
        }
    }

    function edit(provider: ProviderConfig): void {
        setEditing({
            ...provider,
            apiKey: provider.apiKey ?? (provider.id === DEFAULT_MODEL.provider ? legacyApiKey : undefined)
        });
    }

    function addFromCatalog(provider: ProviderCatalogEntry): void {
        setEditing({
            ...provider,
            protocol: provider.protocol ?? "openai-completions",
            baseUrl: provider.baseUrl ?? ""
        });
    }

    function save(provider: ProviderConfig, selection?: ModelSelection): void {
        const exists = providers.some((item) => item.id === provider.id);
        const next = exists
            ? providers.map((item) => item.id === provider.id ? provider : item)
            : [...providers, provider];
        onChange(next, selection);
        setEditing(undefined);
    }

    function remove(provider: ProviderConfig): void {
        onChange(
            providers.filter((item) => item.id !== provider.id),
            selectedModel?.provider === provider.id ? undefined : selectedModel
        );
    }

    const search = query.trim().toLowerCase();
    const available = catalog?.providers.filter((provider) => `${provider.name} ${provider.id}`.toLowerCase().includes(search));

    return (
        <div className="@container flex flex-col gap-6 text-sm">
            <section aria-labelledby="configured-providers-title" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    <h3 id="configured-providers-title" className="font-medium">{t("settings.providers.configured")}</h3>
                    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setEditing({
                        id: `custom:${crypto.randomUUID()}`,
                        name: t("settings.providers.custom"),
                        protocol: "openai-completions",
                        baseUrl: "http://localhost:8080/v1",
                        env: [],
                        models: []
                    })}>
                        <Plus />
                        {t("settings.providers.add")}
                    </Button>
                </div>
                {providers.length > 0 ? (
                    <ul className="divide-y rounded-md border">
                        {providers.map((provider) => (
                            <li key={provider.id} className="flex items-center gap-3 px-3 py-2.5">
                                <ProviderIcon id={provider.id} name={provider.name} />
                                <span className="min-w-0 flex-1 truncate" title={provider.name}>{provider.name}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={disabled}
                                    aria-label={t("settings.providers.editNamed", { name: provider.name })}
                                    onClick={() => edit(provider)}
                                >
                                    <Pencil />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={disabled}
                                    aria-label={t("settings.providers.removeNamed", { name: provider.name })}
                                    onClick={() => remove(provider)}
                                    className="text-muted-foreground hover:text-destructive"
                                >
                                    <Trash2 />
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="rounded-md border border-dashed px-3 py-4 text-muted-foreground">{t("settings.providers.empty")}</p>
                )}
            </section>

            <Collapsible defaultOpen className="flex flex-col gap-3 border-t pt-5">
                <div className="flex items-center justify-between gap-3">
                    <CollapsibleTrigger className="group flex items-center gap-2 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
                        {t("settings.providers.available")}
                    </CollapsibleTrigger>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled || loading}
                        aria-label={t("settings.providers.refresh")}
                        onClick={() => void refresh()}
                    >
                        <RefreshCw className={loading ? "animate-spin" : undefined} />
                    </Button>
                </div>
                <CollapsibleContent className="flex flex-col gap-3">
                    <Input
                        aria-label={t("settings.providers.searchProviders")}
                        placeholder={t("settings.providers.searchProviders")}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    {catalog?.stale ? (
                        <p className="text-xs text-muted-foreground">{t("settings.providers.stale", { date: new Date(catalog.fetchedAt).toLocaleString() })}</p>
                    ) : null}
                    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
                    {loading && !catalog ? <p role="status" className="text-muted-foreground">{t("settings.providers.loading")}</p> : null}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 @min-[34rem]:grid-cols-3">
                        {available?.map((provider) => {
                            const configured = providers.find((item) => item.id === provider.id);
                            return (
                                <button
                                    key={provider.id}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => configured ? edit(configured) : addFromCatalog(provider)}
                                    title={provider.name}
                                    className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                >
                                    <ProviderIcon id={provider.id} name={provider.name} />
                                    <span className="truncate">{provider.name}</span>
                                    {configured ? <span aria-label={t("settings.providers.added")} className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                </button>
                            );
                        })}
                    </div>
                    {available?.length === 0 ? <p className="text-muted-foreground">{t("settings.providers.noResults")}</p> : null}
                </CollapsibleContent>
            </Collapsible>

            {editing ? (
                <ProviderConfigDialog
                    provider={editing}
                    selectedModel={selectedModel}
                    disabled={disabled}
                    onClose={() => setEditing(undefined)}
                    onSave={save}
                />
            ) : null}
        </div>
    );
}

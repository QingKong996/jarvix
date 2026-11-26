import { useEffect, useState } from "react";
import { ChevronDown, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/button.tsx";
import { Input } from "../../ui/input.tsx";
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from "../../ui/collapsible.tsx";
import { ProviderConfigDialog } from "./ProviderConfigDialog.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import {
    type ModelCatalog,
    type ProviderCatalogEntry,
    type ProviderConfig,
    type ModelSelection
} from "../../../../../protocol/providers.ts";
import { quickTransition } from "../../../motion.ts";

type ProviderSettingsProps = {
    providers: ProviderConfig[];
    selectedModel?: ModelSelection;
    disabled: boolean;
    onChange: (providers: ProviderConfig[], selection?: ModelSelection) => void;
};

type ProviderEditorState = {
    provider: ProviderConfig;
    originalId?: string;
};

export function ProviderSettings({ providers, selectedModel, disabled, onChange }: ProviderSettingsProps) {
    const { t } = useTranslation();
    const [catalog, setCatalog] = useState<ModelCatalog>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [editor, setEditor] = useState<ProviderEditorState>();
    const [catalogOpen, setCatalogOpen] = useState(true);

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
        setEditor({
            provider,
            originalId: provider.id
        });
    }

    function addFromCatalog(provider: ProviderCatalogEntry): void {
        setEditor({
            provider: {
                ...provider,
                id: createProviderInstanceId(provider.id, providers),
                protocol: provider.protocol ?? "openai-completions",
                baseUrl: provider.baseUrl ?? ""
            }
        });
    }

    function save(provider: ProviderConfig, selection?: ModelSelection): void {
        const next = applyProviderSave(providers, editor?.originalId, provider);
        onChange(next, selection);
        setEditor(undefined);
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
                    <h3 id="configured-providers-title" className="font-medium text-foreground">{t("settings.providers.configured")}</h3>
                    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setEditor({
                        provider: {
                            id: `custom:${crypto.randomUUID()}`,
                            name: t("settings.providers.custom"),
                            protocol: "openai-completions",
                            baseUrl: "http://localhost:8080/v1",
                            env: [],
                            models: []
                        }
                    })}>
                        <Plus />
                        {t("settings.providers.custom")}
                    </Button>
                </div>
                {providers.length > 0 ? (
                    <ul className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-background">
                        {providers.map((provider) => (
                            <li key={provider.id} className="flex items-center gap-3 px-3.5 py-2.5">
                                <ProviderIcon id={provider.id} name={provider.name} />
                                <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={provider.name}>{provider.name}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={disabled}
                                    aria-label={t("settings.providers.editNamed", { name: provider.name })}
                                    onClick={() => edit(provider)}
                                    className="text-muted-foreground hover:text-foreground"
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
                    <p className="rounded-xl border border-dashed border-border bg-surface-subtle/60 px-3 py-5 text-center text-xs text-muted-foreground">{t("settings.providers.empty")}</p>
                )}
            </section>

            <Collapsible
                open={catalogOpen}
                onOpenChange={setCatalogOpen}
                className="flex flex-col gap-3 border-t border-border pt-4"
            >
                <div className="flex items-center justify-between gap-3">
                    <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                        <motion.span
                            aria-hidden="true"
                            animate={{ rotate: catalogOpen ? 0 : -90 }}
                            transition={quickTransition}
                            className="inline-flex shrink-0 text-muted-foreground"
                        >
                            <ChevronDown className="size-4" />
                        </motion.span>
                        {t("settings.providers.available")}
                    </CollapsibleTrigger>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled || loading}
                        aria-label={t("settings.providers.refresh")}
                        onClick={() => void refresh()}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className={loading ? "animate-spin" : undefined} />
                    </Button>
                </div>
                <AnimatedCollapsibleContent className="flex flex-col gap-3">
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
                    {loading && !catalog ? <p role="status" className="text-xs text-muted-foreground">{t("settings.providers.loading")}</p> : null}
                    <div className="grid grid-cols-2 gap-1.5 @min-[34rem]:grid-cols-3">
                        {available?.map((provider) => (
                            <button
                                key={provider.id}
                                type="button"
                                disabled={disabled}
                                onClick={() => addFromCatalog(provider)}
                                title={provider.name}
                                className="flex min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm outline-none transition-colors duration-150 hover:border-border/80 hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50"
                            >
                                <ProviderIcon id={provider.id} name={provider.name} />
                                <span className="truncate">{provider.name}</span>
                            </button>
                        ))}
                    </div>
                    {available?.length === 0 ? <p className="text-xs text-muted-foreground">{t("settings.providers.noResults")}</p> : null}
                </AnimatedCollapsibleContent>
            </Collapsible>

            {editor ? (
                <ProviderConfigDialog
                    provider={editor.provider}
                    selectedModel={selectedModel}
                    disabled={disabled}
                    onClose={() => setEditor(undefined)}
                    onSave={save}
                />
            ) : null}
        </div>
    );
}

export function applyProviderSave(
    providers: readonly ProviderConfig[],
    originalId: string | undefined,
    provider: ProviderConfig
): ProviderConfig[] {
    if (originalId === undefined) return [...providers, provider];
    return providers.map((item) => item.id === originalId ? provider : item);
}

export function createProviderInstanceId(baseId: string, providers: readonly ProviderConfig[]): string {
    const ids = new Set(providers.map((provider) => provider.id));
    let candidate = baseId;
    let suffix = 2;
    while (ids.has(candidate)) {
        candidate = `${baseId}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}

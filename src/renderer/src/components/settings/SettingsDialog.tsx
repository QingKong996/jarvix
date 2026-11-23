import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Archive, Cpu, LoaderCircle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    DEFAULT_THEME,
    type JarvixConfig,
    type Language,
    type Theme
} from "../../../../protocol/config.ts";
import type { ModelSelection, ProviderConfig } from "../../../../protocol/providers.ts";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import { DialogFooter } from "../common/DialogFooter.tsx";
import { NavigationItem } from "../common/NavigationItem.tsx";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog.tsx";
import { ArchivedSettings } from "./ArchivedSettings.tsx";
import { GeneralSettings } from "./GeneralSettings.tsx";
import { ProviderSettings } from "./providers/ProviderSettings.tsx";

type SettingsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    config: JarvixConfig | null;
    onSaved: (config: JarvixConfig) => void;
    archivedSessions: JarvixSessionSummary[];
    onUnarchiveSession: (sessionId: string) => Promise<boolean>;
};

type SettingsSection = "model" | "archived" | "general";

const bridge = window.jarvix;

function activeLanguage(i18nLanguage: string): Language {
    return i18nLanguage === "en" ? "en" : "zh";
}

function parseCompactionThreshold(value: string): number | undefined | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function SettingsDialog({
    open,
    onOpenChange,
    config,
    onSaved,
    archivedSessions,
    onUnarchiveSession
}: SettingsDialogProps) {
    const { t, i18n } = useTranslation();
    const [section, setSection] = useState<SettingsSection>("model");
    const [providers, setProviders] = useState<ProviderConfig[]>(config?.providers ?? []);
    const [selectedModel, setSelectedModel] = useState<ModelSelection | undefined>(config?.selectedModel);
    const [language, setLanguage] = useState<Language>(activeLanguage(i18n.language));
    const [theme, setTheme] = useState<Theme>(config?.theme ?? DEFAULT_THEME);
    const [compactionThreshold, setCompactionThreshold] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setError(null);
            return;
        }
        setProviders(config?.providers ?? []);
        setSelectedModel(config?.selectedModel);
        setLanguage(config?.language ?? activeLanguage(i18n.language));
        setTheme(config?.theme ?? DEFAULT_THEME);
        setCompactionThreshold(
            config?.contextCompactionThreshold?.toString() ?? ""
        );
    }, [open, config, i18n.language]);

    async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!bridge || !config || saving) {
            return;
        }
        const threshold = parseCompactionThreshold(compactionThreshold);
        if (threshold === null) {
            setError(t("settings.general.compactionThresholdInvalid"));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const { contextCompactionThreshold: _currentThreshold, ...baseConfig } = config;
            const next = await bridge.setConfig({
                ...baseConfig,
                language,
                theme,
                providers,
                selectedModel,
                ...(threshold !== undefined
                    ? { contextCompactionThreshold: threshold }
                    : {})
            });
            onSaved(next);
            setLanguage(next.language ?? language);
            setTheme(next.theme ?? DEFAULT_THEME);
            setCompactionThreshold(
                next.contextCompactionThreshold?.toString() ?? ""
            );
            await i18n.changeLanguage(next.language ?? language);
            onOpenChange(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    const disabled = !bridge || !config || saving;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                aria-describedby={undefined}
                data-testid="settings-dialog"
                className="h-[clamp(28rem,72dvh,46rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl"
            >
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>{t("settings.title")}</DialogTitle>
                </DialogHeader>

                <form id="settings-form" onSubmit={handleSave} className="flex h-full min-h-0 min-w-0">
                    <nav
                        aria-label={t("settings.title")}
                        className="flex w-44 shrink-0 flex-col gap-1 border-r bg-secondary/20 p-3"
                    >
                        <SettingsSectionButton
                            active={section === "model"}
                            icon={<Cpu />}
                            label={t("settings.sections.model")}
                            onClick={() => setSection("model")}
                            testId="settings-section-model"
                        />
                        <SettingsSectionButton
                            active={section === "general"}
                            icon={<Settings2 />}
                            label={t("settings.sections.general")}
                            onClick={() => setSection("general")}
                            testId="settings-section-general"
                        />
                        <SettingsSectionButton
                            active={section === "archived"}
                            icon={<Archive />}
                            label={t("settings.sections.archived")}
                            onClick={() => setSection("archived")}
                            testId="settings-section-archived"
                        />
                    </nav>

                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
                        <div className={section === "model" ? undefined : "hidden"}>
                            <ProviderSettings
                                providers={providers}
                                selectedModel={selectedModel}
                                disabled={disabled}
                                onChange={(next, selection) => {
                                    setProviders(next);
                                    setSelectedModel(selection);
                                    setError(null);
                                }}
                            />
                        </div>
                        <div className={section === "general" ? undefined : "hidden"}>
                            <GeneralSettings
                                language={language}
                                theme={theme}
                                compactionThreshold={compactionThreshold}
                                disabled={disabled}
                                onLanguageChange={(next) => {
                                    setLanguage(next);
                                    setError(null);
                                }}
                                onThemeChange={(next) => {
                                    setTheme(next);
                                    setError(null);
                                }}
                                onCompactionThresholdChange={(next) => {
                                    setCompactionThreshold(next);
                                    setError(null);
                                }}
                            />
                        </div>
                        <div className={section === "archived" ? undefined : "hidden"}>
                            <ArchivedSettings
                                sessions={archivedSessions}
                                disabled={!bridge || saving}
                                onRestore={onUnarchiveSession}
                            />
                        </div>
                    </div>
                </form>

                <DialogFooter error={error} className="gap-3 border-t px-6 py-3">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                        data-testid="settings-cancel"
                    >
                        {t("settings.cancel")}
                    </Button>
                    <Button type="submit" form="settings-form" disabled={disabled} data-testid="settings-save">
                        {saving ? <LoaderCircle className="animate-spin" /> : null}
                        {t("settings.save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

type SettingsSectionButtonProps = {
    active: boolean;
    icon: ReactNode;
    label: string;
    onClick: () => void;
    testId: string;
};

function SettingsSectionButton({ active, icon, label, onClick, testId }: SettingsSectionButtonProps) {
    return (
        <NavigationItem
            active={active}
            aria-current={active ? "page" : undefined}
            onClick={onClick}
            icon={icon}
            data-testid={testId}
        >
            {label}
        </NavigationItem>
    );
}

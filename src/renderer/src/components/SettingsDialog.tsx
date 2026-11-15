import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Archive, ArchiveRestore, Cpu, LoaderCircle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProviderSettings } from "./ProviderSettings.tsx";
import type { ProviderConfig, ModelSelection } from "../../../protocol/providers.ts";
import type { JarvixSessionSummary } from "../../../protocol/session.ts";
import {
    DEFAULT_THEME,
    SUPPORTED_LANGUAGES,
    SUPPORTED_THEMES,
    type JarvixConfig,
    type Language,
    type Theme
} from "../../../protocol/config.ts";

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

const LANGUAGE_LABELS: Record<Language, string> = {
    zh: "中文",
    en: "English"
};

function isLanguage(value: string): value is Language {
    return SUPPORTED_LANGUAGES.some((language) => language === value);
}

function isTheme(value: string): value is Theme {
    return SUPPORTED_THEMES.some((theme) => theme === value);
}

function activeLanguage(i18nLanguage: string): Language {
    return i18nLanguage === "en" ? "en" : "zh";
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
    }, [open, config, i18n.language]);

    function handleLanguageChange(value: Language): void {
        setLanguage(value);
        setError(null);
    }

    function handleThemeChange(value: Theme): void {
        setTheme(value);
        setError(null);
    }

    async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!bridge || !config || saving) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const next = await bridge.setConfig({ ...config, language, theme, providers, selectedModel });
            onSaved(next);
            setLanguage(next.language ?? language);
            setTheme(next.theme ?? DEFAULT_THEME);
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
                className="h-[clamp(28rem,72dvh,46rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl"
            >
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>{t("settings.title")}</DialogTitle>
                </DialogHeader>

                <form id="settings-form" onSubmit={handleSave} className="flex h-full min-h-0 min-w-0">
                    <nav className="flex w-44 shrink-0 flex-col gap-1 border-r bg-secondary/20 p-3">
                        <SettingsSectionButton
                            active={section === "model"}
                            icon={<Cpu />}
                            label={t("settings.sections.model")}
                            onClick={() => setSection("model")}
                        />
                        <SettingsSectionButton
                            active={section === "general"}
                            icon={<Settings2 />}
                            label={t("settings.sections.general")}
                            onClick={() => setSection("general")}
                        />
                        <SettingsSectionButton
                            active={section === "archived"}
                            icon={<Archive />}
                            label={t("settings.sections.archived")}
                            onClick={() => setSection("archived")}
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
                                disabled={disabled}
                                onLanguageChange={handleLanguageChange}
                                onThemeChange={handleThemeChange}
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

                <div className="flex items-center justify-end gap-3 border-t px-6 py-3">
                    {error ? <span className="text-xs text-destructive">{error}</span> : null}
                    <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
                        {t("settings.cancel")}
                    </Button>
                    <Button type="submit" form="settings-form" disabled={disabled}>
                        {saving ? <LoaderCircle className="animate-spin" /> : null}
                        {t("settings.save")}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

type ArchivedSettingsProps = {
    sessions: JarvixSessionSummary[];
    disabled: boolean;
    onRestore: (sessionId: string) => Promise<boolean>;
};

function ArchivedSettings({ sessions, disabled, onRestore }: ArchivedSettingsProps) {
    const { t, i18n } = useTranslation();
    const [restoringId, setRestoringId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function restore(sessionId: string): Promise<void> {
        if (disabled || restoringId) {
            return;
        }
        setRestoringId(sessionId);
        setError(null);
        try {
            if (!await onRestore(sessionId)) {
                setError(t("settings.archived.restoreFailed"));
            }
        } catch {
            setError(t("settings.archived.restoreFailed"));
        } finally {
            setRestoringId(null);
        }
    }

    return (
        <section aria-labelledby="archived-sessions-title" className="flex flex-col gap-3 text-sm">
            <div>
                <h3 id="archived-sessions-title" className="font-medium">
                    {t("settings.archived.title")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                    {t("settings.archived.description")}
                </p>
            </div>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            {sessions.length > 0 ? (
                <ul className="divide-y rounded-md border">
                    {sessions.map((session) => (
                        <li key={session.id} className="flex items-center gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="truncate" title={session.name}>{session.name}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {t("settings.archived.archivedAt", {
                                        date: new Date(session.archivedAt ?? session.updatedAt)
                                            .toLocaleString(i18n.language)
                                    })}
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={disabled || restoringId !== null}
                                onClick={() => void restore(session.id)}
                            >
                                {restoringId === session.id
                                    ? <LoaderCircle className="animate-spin" />
                                    : <ArchiveRestore />}
                                {restoringId === session.id
                                    ? t("settings.archived.restoring")
                                    : t("settings.archived.restore")}
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
                    {t("settings.archived.empty")}
                </div>
            )}
        </section>
    );
}

type SettingsSectionButtonProps = {
    active: boolean;
    icon: ReactNode;
    label: string;
    onClick: () => void;
};

function SettingsSectionButton({ active, icon, label, onClick }: SettingsSectionButtonProps) {
    return (
        <button
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={onClick}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0 ${
                active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
        >
            {icon}
            {label}
        </button>
    );
}

type GeneralSettingsProps = {
    language: Language;
    theme: Theme;
    disabled: boolean;
    onLanguageChange: (language: Language) => void;
    onThemeChange: (theme: Theme) => void;
};

function GeneralSettings({ language, theme, disabled, onLanguageChange, onThemeChange }: GeneralSettingsProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-between gap-4">
                <label htmlFor="settings-language" className="font-medium">
                    {t("settings.general.language")}
                </label>
                <Select
                    value={language}
                    disabled={disabled}
                    onValueChange={(value) => {
                        if (isLanguage(value)) {
                            onLanguageChange(value);
                        }
                    }}
                >
                    <SelectTrigger id="settings-language" className="w-44">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {SUPPORTED_LANGUAGES.map((item) => (
                            <SelectItem key={item} value={item}>
                                {LANGUAGE_LABELS[item]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-center justify-between gap-4">
                <label htmlFor="settings-theme" className="font-medium">
                    {t("settings.general.theme")}
                </label>
                <Select
                    value={theme}
                    disabled={disabled}
                    onValueChange={(value) => {
                        if (isTheme(value)) {
                            onThemeChange(value);
                        }
                    }}
                >
                    <SelectTrigger id="settings-theme" className="w-44">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {SUPPORTED_THEMES.map((item) => (
                            <SelectItem key={item} value={item}>
                                {t(`settings.general.themes.${item}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}

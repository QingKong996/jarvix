import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Cpu, Eye, EyeOff, LoaderCircle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_LANGUAGES, type JarvixConfig, type Language } from "../../../protocol/config.ts";

type SettingsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    config: JarvixConfig | null;
    onSaved: (config: JarvixConfig) => void;
};

type SettingsSection = "model" | "general";

const bridge = window.jarvix;

const LANGUAGE_LABELS: Record<Language, string> = {
    zh: "中文",
    en: "English"
};

function isLanguage(value: string): value is Language {
    return SUPPORTED_LANGUAGES.some((language) => language === value);
}

function activeLanguage(i18nLanguage: string): Language {
    return i18nLanguage === "en" ? "en" : "zh";
}

export function SettingsDialog({ open, onOpenChange, config, onSaved }: SettingsDialogProps) {
    const { t, i18n } = useTranslation();
    const [section, setSection] = useState<SettingsSection>("model");
    const [apiKey, setApiKey] = useState(config?.apiKey ?? "");
    const [language, setLanguage] = useState<Language>(activeLanguage(i18n.language));
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setSaved(false);
            setError(null);
            return;
        }
        setApiKey(config?.apiKey ?? "");
        setLanguage(config?.language ?? activeLanguage(i18n.language));
    }, [open, config, i18n.language]);

    function markDirty(): void {
        setSaved(false);
        setError(null);
    }

    async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!bridge || !config || saving) {
            return;
        }
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const next = await bridge.setConfig({ ...config, apiKey, language });
            onSaved(next);
            setApiKey(next.apiKey ?? "");
            setLanguage(next.language ?? language);
            await i18n.changeLanguage(next.language ?? language);
            setSaved(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    const disabled = !bridge || !config || saving;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent closeLabel={t("common.close")} className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>{t("settings.title")}</DialogTitle>
                </DialogHeader>

                <form id="settings-form" onSubmit={handleSave} className="flex min-h-[380px]">
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
                    </nav>

                    <div className="min-w-0 flex-1 overflow-y-auto p-6">
                        <div className={section === "model" ? undefined : "hidden"}>
                            <ModelSettings
                                apiKey={apiKey}
                                disabled={disabled}
                                onChange={(value) => {
                                    setApiKey(value);
                                    markDirty();
                                }}
                            />
                        </div>
                        <div className={section === "general" ? undefined : "hidden"}>
                            <GeneralSettings
                                language={language}
                                disabled={disabled}
                                onChange={(value) => {
                                    setLanguage(value);
                                    markDirty();
                                }}
                            />
                        </div>
                    </div>
                </form>

                <div className="flex items-center justify-end gap-3 border-t px-6 py-3">
                    {saved ? <span className="text-xs text-muted-foreground">{t("settings.saved")}</span> : null}
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

type ModelSettingsProps = {
    apiKey: string;
    disabled: boolean;
    onChange: (value: string) => void;
};

function ModelSettings({ apiKey, disabled, onChange }: ModelSettingsProps) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = useState(false);

    return (
        <div className="flex flex-col gap-2 text-sm">
            <label htmlFor="settings-api-key" className="font-medium">
                {t("settings.model.apiKey")}
            </label>
            <div className="relative">
                <Input
                    id="settings-api-key"
                    type={revealed ? "text" : "password"}
                    autoComplete="off"
                    placeholder="sk-..."
                    value={apiKey}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.value)}
                    className="pr-10"
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={revealed ? t("settings.model.hideKey") : t("settings.model.revealKey")}
                    onClick={() => setRevealed((current) => !current)}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
                >
                    {revealed ? <EyeOff /> : <Eye />}
                </Button>
            </div>
        </div>
    );
}

type GeneralSettingsProps = {
    language: Language;
    disabled: boolean;
    onChange: (language: Language) => void;
};

function GeneralSettings({ language, disabled, onChange }: GeneralSettingsProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-2 text-sm">
            <label htmlFor="settings-language" className="font-medium">
                {t("settings.general.language")}
            </label>
            <Select
                value={language}
                disabled={disabled}
                onValueChange={(value) => {
                    if (isLanguage(value)) {
                        onChange(value);
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
    );
}

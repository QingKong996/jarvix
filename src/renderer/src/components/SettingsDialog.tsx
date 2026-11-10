import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Cpu, Eye, EyeOff, LoaderCircle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

type SettingsPanelProps = {
    config: JarvixConfig | null;
    onSaved: (config: JarvixConfig) => void;
};

const bridge = window.jarvix;

const LANGUAGE_LABELS: Record<Language, string> = {
    zh: "中文",
    en: "English"
};

function isLanguage(value: string): value is Language {
    return SUPPORTED_LANGUAGES.some((language) => language === value);
}

export function SettingsDialog({ open, onOpenChange, config, onSaved }: SettingsDialogProps) {
    const { t } = useTranslation();
    const [section, setSection] = useState<SettingsSection>("model");

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>{t("settings.title")}</DialogTitle>
                </DialogHeader>

                <div className="flex min-h-[380px]">
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
                            <ModelSettings config={config} onSaved={onSaved} />
                        </div>
                        <div className={section === "general" ? undefined : "hidden"}>
                            <GeneralSettings config={config} onSaved={onSaved} />
                        </div>
                    </div>
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

function ModelSettings({ config, onSaved }: SettingsPanelProps) {
    const { t } = useTranslation();
    const [value, setValue] = useState(config?.apiKey ?? "");
    const [revealed, setRevealed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setValue(config?.apiKey ?? "");
    }, [config?.apiKey]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!bridge || !config || saving) {
            return;
        }
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const next = await bridge.setConfig({ ...config, apiKey: value });
            onSaved(next);
            setValue(next.apiKey ?? "");
            setSaved(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                            setSaved(false);
                            setError(null);
                        }}
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

            <div className="flex items-center justify-end gap-3">
                {saved ? <span className="text-xs text-muted-foreground">{t("settings.model.saved")}</span> : null}
                {error ? <span className="text-xs text-destructive">{error}</span> : null}
                <Button type="submit" disabled={!bridge || !config || saving}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
                    {t("settings.model.save")}
                </Button>
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                        {t("settings.model.cancel")}
                    </Button>
                </DialogClose>
            </div>
        </form>
    );
}

function GeneralSettings({ config, onSaved }: SettingsPanelProps) {
    const { t, i18n } = useTranslation();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const activeLanguage: Language = config?.language ?? (i18n.language === "en" ? "en" : "zh");

    async function selectLanguage(language: Language): Promise<void> {
        if (!bridge || !config || saving || config.language === language) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const next = await bridge.setConfig({ ...config, language });
            onSaved(next);
            await i18n.changeLanguage(language);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="flex flex-col gap-2 text-sm">
            <label htmlFor="settings-language" className="font-medium">
                {t("settings.general.language")}
            </label>
            <Select
                value={activeLanguage}
                disabled={!bridge || !config || saving}
                onValueChange={(value) => {
                    if (isLanguage(value)) {
                        void selectLanguage(value);
                    }
                }}
            >
                <SelectTrigger id="settings-language" className="w-44">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {SUPPORTED_LANGUAGES.map((language) => (
                        <SelectItem key={language} value={language}>
                            {LANGUAGE_LABELS[language]}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
    );
}

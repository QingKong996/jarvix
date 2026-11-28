import { useTranslation } from "react-i18next";
import {
    SUPPORTED_LANGUAGES,
    SUPPORTED_THEMES,
    type Language,
    type Theme
} from "../../../../protocol/config.ts";
import { Input } from "../ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";

type GeneralSettingsProps = {
    language: Language;
    theme: Theme;
    conciseTranscript: boolean;
    compactionThreshold: string;
    disabled: boolean;
    onLanguageChange: (language: Language) => void;
    onThemeChange: (theme: Theme) => void;
    onConciseTranscriptChange: (concise: boolean) => void;
    onCompactionThresholdChange: (value: string) => void;
};

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

export function GeneralSettings({
    language,
    theme,
    conciseTranscript,
    compactionThreshold,
    disabled,
    onLanguageChange,
    onThemeChange,
    onConciseTranscriptChange,
    onCompactionThresholdChange
}: GeneralSettingsProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col divide-y divide-border text-sm">
            <div className="flex items-center justify-between gap-4 pb-4">
                <label htmlFor="settings-language" className="font-medium text-foreground">
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

            <div className="flex items-center justify-between gap-4 py-4">
                <label htmlFor="settings-theme" className="font-medium text-foreground">
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

            <div className="flex items-start justify-between gap-4 py-4">
                <div className="flex flex-col gap-1">
                    <label htmlFor="settings-transcript-flow" className="font-medium text-foreground">
                        {t("settings.general.transcriptFlow")}
                    </label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("settings.general.transcriptFlowDescription")}
                    </p>
                </div>
                <Select
                    value={conciseTranscript ? "concise" : "complete"}
                    disabled={disabled}
                    onValueChange={(value) => onConciseTranscriptChange(
                        value === "concise"
                    )}
                >
                    <SelectTrigger id="settings-transcript-flow" className="w-44 shrink-0">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="complete">
                            {t("settings.general.transcriptFlows.complete")}
                        </SelectItem>
                        <SelectItem value="concise">
                            {t("settings.general.transcriptFlows.concise")}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-start justify-between gap-4 pt-4">
                <div className="flex flex-col gap-1">
                    <label htmlFor="settings-compaction-threshold" className="font-medium text-foreground">
                        {t("settings.general.compactionThreshold")}
                    </label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("settings.general.compactionThresholdDescription")}
                    </p>
                </div>
                <Input
                    id="settings-compaction-threshold"
                    type="number"
                    min={1}
                    step={1024}
                    value={compactionThreshold}
                    placeholder={t("settings.general.compactionThresholdPlaceholder")}
                    disabled={disabled}
                    className="w-44 shrink-0"
                    onChange={(event) => onCompactionThresholdChange(event.target.value)}
                />
            </div>
        </div>
    );
}

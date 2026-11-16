import { useTranslation } from "react-i18next";
import {
    SUPPORTED_LANGUAGES,
    SUPPORTED_THEMES,
    type Language,
    type Theme
} from "../../../../protocol/config.ts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";

type GeneralSettingsProps = {
    language: Language;
    theme: Theme;
    disabled: boolean;
    onLanguageChange: (language: Language) => void;
    onThemeChange: (theme: Theme) => void;
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
    disabled,
    onLanguageChange,
    onThemeChange
}: GeneralSettingsProps) {
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

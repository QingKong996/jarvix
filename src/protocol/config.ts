export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const SUPPORTED_THEMES = ["dark", "light"] as const;

export type Theme = (typeof SUPPORTED_THEMES)[number];

export const DEFAULT_THEME: Theme = "dark";

/** Config data object shared across IPC, the core runtime and the main-process store. */
export type JarvixConfig = {
    apiKey?: string;
    language?: Language;
    theme?: Theme;
};

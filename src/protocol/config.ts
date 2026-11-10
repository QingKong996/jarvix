export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Config data object shared across IPC, the core runtime and the main-process store. */
export type JarvixConfig = {
    apiKey?: string;
    language?: Language;
};

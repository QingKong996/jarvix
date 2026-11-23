export type LogDetails = Record<string, unknown>;

export interface JarvixLogger {
    debug(message: string, details?: LogDetails): void;
    info(message: string, details?: LogDetails): void;
    warn(message: string, details?: LogDetails): void;
    error(message: string, error?: unknown, details?: LogDetails): void;
}

export const noopLogger: JarvixLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
};

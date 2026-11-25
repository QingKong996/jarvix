import { z } from "zod";

export const PATH_COMPLETION_LIMIT = 200;
export const PATH_COMPLETION_QUERY_MAX_LENGTH = 4096;

export const pathCompletionQuerySchema = z
    .string()
    .max(PATH_COMPLETION_QUERY_MAX_LENGTH);

export type JarvixPathKind = "file" | "directory";

export type JarvixPathCompletion = {
    /** Absolute path used for sandbox grants and the model prompt. */
    path: string;
    /** `./`-prefixed path for relative queries, or an absolute path. */
    relativePath: string;
    name: string;
    kind: JarvixPathKind;
};

export type JarvixPathCompletionResult = {
    entries: JarvixPathCompletion[];
};

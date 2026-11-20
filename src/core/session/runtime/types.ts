import type { LlmAdapter } from "../../../llm/index.ts";
import type { JarvixConfig } from "../../../protocol/config.ts";
import type { JarvixEvent } from "../../../protocol/event.ts";

export type SessionRuntime = {
    llm: LlmAdapter;
    config: JarvixConfig;
    workingDirectories?: readonly string[];
    emit(event: JarvixEvent): void;
};

import { createPiAdapter } from "./pi.ts";
import type { LlmAdapter } from "../core/llm/adapter.ts";
import type { ProviderConfig } from "../protocol/providers.ts";

/** Creates the LLM adapter used by the app. pi-ai is the only backend for now. */
export function createLlm(providers?: () => readonly ProviderConfig[] | undefined): LlmAdapter {
    return createPiAdapter({ providers });
}

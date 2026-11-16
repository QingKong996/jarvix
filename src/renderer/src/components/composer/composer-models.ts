import type { JarvixConfig } from "../../../../protocol/config.ts";
import type {
    ModelDefinition,
    ModelSelection
} from "../../../../protocol/providers.ts";

export type ComposerModel = {
    selection: ModelSelection;
    name: string;
    reasoning: boolean;
    reasoningLevels?: ModelDefinition["reasoningLevels"];
};

export type ProviderGroup = {
    id: string;
    name: string;
    models: ComposerModel[];
};

export function providerGroupsFor(config: JarvixConfig | null): ProviderGroup[] {
    return config?.providers?.flatMap((provider) => {
        if (provider.models.length === 0) return [];
        return [{
            id: provider.id,
            name: provider.name,
            models: provider.models.map((model) => ({
                selection: { provider: provider.id, id: model.id },
                name: model.name,
                reasoning: model.reasoning,
                reasoningLevels: model.reasoningLevels
            }))
        }];
    }) ?? [];
}

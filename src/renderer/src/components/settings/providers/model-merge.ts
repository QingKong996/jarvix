import type { ModelDefinition } from "../../../../../protocol/providers.ts";

/**
 * Merge provider metadata without treating an incomplete remote catalog as
 * authorization to delete locally configured models. Existing definitions win
 * so sync never discards user overrides for IDs that are still advertised.
 */
export function mergeSyncedModels(
    current: readonly ModelDefinition[],
    remote: readonly ModelDefinition[]
): ModelDefinition[] {
    const known = new Set(current.map((model) => model.id));
    const additions: ModelDefinition[] = [];
    for (const model of remote) {
        if (known.has(model.id)) {
            continue;
        }
        known.add(model.id);
        additions.push(model);
    }
    return additions.length === 0 ? [...current] : [...current, ...additions];
}

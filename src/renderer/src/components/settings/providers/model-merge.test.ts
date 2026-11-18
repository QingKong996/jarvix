import { expect, test } from "vitest";
import { modelDefinitionSchema } from "../../../../../protocol/providers.ts";
import { mergeSyncedModels } from "./model-merge.ts";

const localOnly = modelDefinitionSchema.parse({
    id: "local-alias",
    name: "Local alias",
    contextWindow: 16_384,
    maxTokens: 2_048
});
const shared = modelDefinitionSchema.parse({
    id: "shared-model",
    name: "Shared local name",
    contextWindow: 32_768,
    maxTokens: 4_096
});

test("keeps locally configured models that the provider does not advertise", () => {
    const remoteShared = modelDefinitionSchema.parse({
        id: "shared-model",
        name: "Remote name"
    });
    const remoteNew = modelDefinitionSchema.parse({
        id: "new-model",
        name: "New remote model"
    });

    expect(mergeSyncedModels(
        [localOnly, shared],
        [remoteShared, remoteNew]
    )).toEqual([
        localOnly,
        shared,
        remoteNew
    ]);
});

test("does not duplicate a model returned more than once", () => {
    const remote = modelDefinitionSchema.parse({
        id: "new-model",
        name: "New remote model"
    });

    expect(mergeSyncedModels([], [remote, remote])).toEqual([remote]);
});

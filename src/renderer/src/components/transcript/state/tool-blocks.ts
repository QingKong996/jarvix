import type {
    CommittedBlock,
    CommittedTurn,
    TranscriptState
} from "./types.ts";

type ToolBlockLocation = {
    turnIndex: number;
    blockIndex: number;
};

const toolBlockIndexes = new WeakMap<
    CommittedTurn[],
    ReadonlyMap<string, readonly ToolBlockLocation[]>
>();

export function updateToolBlock(
    state: TranscriptState,
    toolCallId: string,
    update: (block: Extract<CommittedBlock, { type: "tool" }>) => Extract<CommittedBlock, { type: "tool" }>
): TranscriptState {
    const index = toolBlockIndex(state.committed);
    const locations = index.get(toolCallId);
    if (!locations) {
        return state;
    }

    const indexesByTurn = new Map<number, number[]>();
    for (const location of locations) {
        const blockIndexes = indexesByTurn.get(location.turnIndex);
        if (blockIndexes) {
            blockIndexes.push(location.blockIndex);
        } else {
            indexesByTurn.set(location.turnIndex, [location.blockIndex]);
        }
    }

    const committed = [...state.committed];
    for (const [turnIndex, blockIndexes] of indexesByTurn) {
        const turn = committed[turnIndex]!;
        const blocks = [...turn.blocks];
        for (const blockIndex of blockIndexes) {
            const block = blocks[blockIndex]!;
            if (block.type === "tool") {
                blocks[blockIndex] = update(block);
            }
        }
        committed[turnIndex] = { ...turn, blocks };
    }
    toolBlockIndexes.set(committed, index);
    return { ...state, committed };
}

function toolBlockIndex(
    committed: CommittedTurn[]
): ReadonlyMap<string, readonly ToolBlockLocation[]> {
    const cached = toolBlockIndexes.get(committed);
    if (cached) {
        return cached;
    }
    const index = new Map<string, ToolBlockLocation[]>();
    for (const [turnIndex, turn] of committed.entries()) {
        for (const [blockIndex, block] of turn.blocks.entries()) {
            if (block.type !== "tool") {
                continue;
            }
            const locations = index.get(block.toolCallId);
            if (locations) {
                locations.push({ turnIndex, blockIndex });
            } else {
                index.set(block.toolCallId, [{ turnIndex, blockIndex }]);
            }
        }
    }
    toolBlockIndexes.set(committed, index);
    return index;
}

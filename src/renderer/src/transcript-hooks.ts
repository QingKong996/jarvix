import { useSyncExternalStore } from "react";
import {
    getCommitted,
    getLive,
    subscribeCommitted,
    subscribeLive
} from "./transcript-store.ts";
import type { CommittedTurn, LiveTurn } from "./types.ts";

/** Committed history: changes once per finalized turn (and once per user send). */
export function useCommitted(): CommittedTurn[] {
    return useSyncExternalStore(subscribeCommitted, getCommitted);
}

/** Live tail: changes on every merged stream batch. */
export function useLive(): LiveTurn | null {
    return useSyncExternalStore(subscribeLive, getLive);
}

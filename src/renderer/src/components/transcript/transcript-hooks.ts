import { useSyncExternalStore } from "react";
import {
    getCommitted,
    getInjected,
    getLive,
    subscribeCommitted,
    subscribeInjected,
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

/** User prompts displayed immediately while the active round is still finishing. */
export function useInjected(): CommittedTurn[] {
    return useSyncExternalStore(subscribeInjected, getInjected);
}

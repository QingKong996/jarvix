import { type JarvixEvent, type JarvixListener } from "../portocol/event"    





export class TUIRelayer {
    private listeners = new Set<JarvixListener>();

    readonly listener = (event: JarvixEvent) => {
         this.dispatch(event);
    };

    subscribe(listener: JarvixListener){
        this.listeners.add(listener);
        return (() => {
            this.listeners.delete(listener);
        })
    }

    dispatch(event: JarvixEvent){
        for(const listener of this.listeners){
            listener(event);
        }
    }
}

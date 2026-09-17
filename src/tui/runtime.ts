import { Jarvix } from "../core";



let jarvix : Jarvix | null;


export function setJarvix(instance: Jarvix){
    jarvix = instance;
}

export function getJarvix(): Jarvix{
    if(!jarvix){
        throw new Error("TUI runtime has not been initiazed.")
    }
    return jarvix;
}

import type { Transition } from "motion/react";

export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const quickTransition = {
    duration: 0.16,
    ease: EASE_OUT
} satisfies Transition;

export const smoothTransition = {
    duration: 0.24,
    ease: EASE_OUT
} satisfies Transition;

export const panelTransition = {
    type: "spring",
    stiffness: 380,
    damping: 40,
    mass: 0.9
} satisfies Transition;

export const layoutSpring = {
    type: "spring",
    stiffness: 420,
    damping: 36,
    mass: 0.8
} satisfies Transition;

import { atom } from "jotai";

/**
 * Keep an OS link authoritative while the home page finishes loading the session.
 * Leaving home clears the intent so a later Home visit uses its normal destination.
 */
export const nativeHomeRedirectAtom = atom<string | null>(null);

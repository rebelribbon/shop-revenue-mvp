"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Client forms can arrive through streamed navigation before their JavaScript.
// Keep the thumb-bar enhancer out until React has hydrated this action scope.
export function useActionHydration() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}

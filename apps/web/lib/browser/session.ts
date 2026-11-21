"use client";
// The unlocked owner lives only in this tab's memory. Reloading or locking drops it; the phrase stays encrypted in
// IndexedDB until the passphrase is typed again.
import { useSyncExternalStore } from "react";
import type { Owner } from "./account";

let current: Owner | null = null;
const listeners = new Set<() => void>();

export function setOwner(o: Owner | null) {
  current = o;
  listeners.forEach((l) => l());
}

export function useOwner(): Owner | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => current,
    () => null,
  );
}

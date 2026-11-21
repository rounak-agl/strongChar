// What the owner keeps locally for each job it posted from this browser: the holdout rows (they never leave this
// device) and the spec, so the finished model can be scored here. Stored in IndexedDB next to the encrypted phrase.
import type { Spec } from "./prepare";

const DB = "strongchar-jobs";
const STORE = "jobs";

export type LocalJob = {
  jobId: number; owner: string; specHash: string; spec: Spec; createTx: string; created: string;
  holdoutX: Float32Array; holdoutY: BigInt64Array | Float32Array;
};

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "jobId" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveJob(j: LocalJob): Promise<void> {
  const d = await db();
  await new Promise<void>((res, rej) => {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(j);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function getJob(jobId: number): Promise<LocalJob | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(STORE, "readonly").objectStore(STORE).get(jobId);
    r.onsuccess = () => res(r.result as LocalJob | undefined);
    r.onerror = () => rej(r.error);
  });
}

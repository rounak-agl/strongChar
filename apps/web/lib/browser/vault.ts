// The browser account's recovery phrase, encrypted at rest. QoreX can't hold QoreSeal keys (MEMORY Q16), so this page
// holds them: PBKDF2-SHA-256 (600,000 rounds) stretches the passphrase into an AES-256-GCM key, and only the
// ciphertext, salt and IV are kept in IndexedDB. The phrase never leaves the browser and is never sent anywhere.
const DB = "strongchar";
const STORE = "vault";
const KEY = "owner";
const ROUNDS = 600_000;

export type Sealed = { v: 1; address: string; salt: string; iv: string; ct: string; created: string };

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = run(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function keyFrom(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ROUNDS }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Encrypt the phrase with the passphrase. The address is bound as AAD so a blob can't be swapped between accounts. */
export async function lock(mnemonic: string, passphrase: string, address: string): Promise<Sealed> {
  if (passphrase.length < 10) throw new Error("Use a passphrase of at least 10 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(address) },
    await keyFrom(passphrase, salt), enc.encode(mnemonic)));
  return { v: 1, address, salt: b64(salt), iv: b64(iv), ct: b64(ct), created: new Date().toISOString() };
}

export async function unlock(s: Sealed, passphrase: string): Promise<string> {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv) as BufferSource, additionalData: enc.encode(s.address) },
      await keyFrom(passphrase, unb64(s.salt)), unb64(s.ct) as BufferSource);
    return dec.decode(pt);
  } catch {
    throw new Error("Wrong passphrase.");
  }
}

export const save = (s: Sealed) => tx("readwrite", (st) => st.put(s, KEY));
export const load = () => tx<Sealed | undefined>("readonly", (st) => st.get(KEY));
export const forget = () => tx("readwrite", (st) => st.delete(KEY));

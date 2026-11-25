// Saved drawings, captures and settings, kept in this browser's IndexedDB.
// Every call resolves; when storage is unavailable (private browsing,
// blocked site data) reads come back undefined and writes are dropped.

const DB = "tracepad";
const STORE = "kv";

let opened;
function open() {
  opened ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

async function run(mode, action) {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const get = (key) => run("readonly", (s) => s.get(key));
export const set = (key, value) => run("readwrite", (s) => s.put(value, key));
export const remove = (key) => run("readwrite", (s) => s.delete(key));

export const keys = {
  settings: "settings",
  last: "last-video",
  claudeKey: "claude-key",
  ink: (id) => `ink:${id}`,
  captures: (id) => `captures:${id}`,
};

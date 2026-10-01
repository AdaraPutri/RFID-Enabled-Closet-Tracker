// Firebase web config lives in this browser's localStorage only.
// It is never written into the repo.

export const CONFIG_STORAGE_KEY = 'closetronic_firebase_config';

const EMPTY_CONFIG = `{
  "apiKey": "",
  "authDomain": "",
  "projectId": "",
  "storageBucket": "",
  "messagingSenderId": "",
  "appId": ""
}`;

export function emptyConfigTemplate() {
  return EMPTY_CONFIG;
}

export function getSavedConfig(storage = localStorage) {
  try {
    const raw = storage.getItem(CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveConfig(configObj, storage = localStorage) {
  storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configObj));
}

// Firebase's console shows the config as a raw JS object (unquoted keys),
// usually embedded in a bigger snippet with "import { ... } from ..." lines
// above it — those have their own curly braces, so we can't just grab
// "first { to last }". Instead, walk through every "{" in the pasted text,
// extract the balanced block starting there, and keep the first one that
// evaluates to an object containing an apiKey field.
export function parseFirebaseConfigInput(rawInput) {
  try {
    const direct = JSON.parse(rawInput);
    if (direct && direct.apiKey) return direct;
  } catch (e) { /* fall through */ }

  for (let i = 0; i < rawInput.length; i++) {
    if (rawInput[i] !== '{') continue;
    let depth = 0, end = -1;
    for (let j = i; j < rawInput.length; j++) {
      if (rawInput[j] === '{') depth++;
      if (rawInput[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) continue;
    const block = rawInput.slice(i, end + 1);
    try {
      const obj = new Function('return (' + block + ')')();
      if (obj && typeof obj === 'object' && obj.apiKey) return obj;
    } catch (e) { /* try the next { and keep looking */ }
  }
  return null;
}

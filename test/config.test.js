import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_STORAGE_KEY,
  getSavedConfig,
  saveConfig,
  parseFirebaseConfigInput
} from '../js/config.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value))
  };
}

test('config round-trips through storage', () => {
  const storage = memoryStorage();
  const config = { apiKey: 'abc', projectId: 'closetronic' };
  saveConfig(config, storage);
  assert.deepEqual(getSavedConfig(storage), config);
  assert.equal(storage.getItem(CONFIG_STORAGE_KEY) != null, true);
});

test('broken storage JSON is treated as missing', () => {
  const storage = memoryStorage();
  storage.setItem(CONFIG_STORAGE_KEY, '{not json');
  assert.equal(getSavedConfig(storage), null);
});

test('accepts a JSON config', () => {
  const parsed = parseFirebaseConfigInput(JSON.stringify({
    apiKey: 'key-1',
    projectId: 'closetronic'
  }));
  assert.equal(parsed.apiKey, 'key-1');
  assert.equal(parsed.projectId, 'closetronic');
});

test('finds the config object inside a Firebase snippet', () => {
  const pasted = `
    import { initializeApp } from "firebase/app";
    const firebaseConfig = {
      apiKey: "key-2",
      authDomain: "closetronic.firebaseapp.com",
      projectId: "closetronic",
      storageBucket: "closetronic.appspot.com",
      messagingSenderId: "123",
      appId: "1:123:web:abc"
    };
  `;
  const parsed = parseFirebaseConfigInput(pasted);
  assert.equal(parsed.apiKey, 'key-2');
  assert.equal(parsed.projectId, 'closetronic');
});

test('rejects text that has no apiKey', () => {
  assert.equal(parseFirebaseConfigInput('hello { projectId: "x" }'), null);
  assert.equal(parseFirebaseConfigInput('not a config'), null);
});

// --- 1. DIRECT EXPORTS (Objects/Maps/Arrays) ---
// These can be imported anywhere and mutated via methods (.set, .push, etc.)
export const GLOBAL_STATE = {
  dataVA: [],
  dependencyMap: new Map()
};

// Inside src/reactivity.js
export const updateQueue = new Set(); // Switch from [] to Set

export function queueUpdate(effect) {
  updateQueue.add(effect); // Automatically dedupes!
  
  if (!ctx.microtaskPending) {
    ctx.microtaskPending = true;
    queueMicrotask(() => {
      updateQueue.forEach(effect => effect());
      updateQueue.clear(); // Flush clean
      ctx.microtaskPending = false;
    });
  }
}

export const components = new Map();
export const nuggets = new Map();
export const reactiveCache = new Map();

export const stylesheet = {
  el: typeof document !== 'undefined' ? document.createElement("style") : null,
  isAppended: false
};

export const sharedTemplate = typeof document !== 'undefined' ? document.createElement('template') : null;

// LRU Cache class
export class LRUCache {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this._map = new Map();
  }
  
  get(key) {
    if (!this._map.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this._map.get(key);
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }
  
  set(key, value) {
    // If key already exists, delete it first so the new insert goes to the end
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this.maxSize) {
      // Evict the least recently used (first item in the map)
      const oldestKey = this._map.keys().next().value;
      this._map.delete(oldestKey);
    }
    this._map.set(key, value);
  }
  
  has(key) {
    return this._map.has(key);
  }
  
  delete(key) {
    return this._map.delete(key);
  }
  
  clear() {
    this._map.clear();
  }
  
  get size() {
    return this._map.size;
  }
}

// Extracts the string between two delimiters in a given string.
export function stringBetween(str, f, s, lastIndex) {
  const indx1 = str.indexOf(f);
  if (indx1 === -1) return "";
  const indx2 = !lastIndex ? str.indexOf(s, indx1 + f.length) : str.lastIndexOf(s);
  if (indx2 === -1) return "";
  return str.slice(indx1 + f.length, indx2);
}


// --- 2. THE MUTABLE CONTEXT WRAPPER ---
// For primitives and variables that get completely overwritten/reassigned
export const ctx = {
  counterVA: 0,
  nuggetCounter: 0,
  routerObj: {},
  currentComponent: null,
  navigateFunc: () => {},
  
  // Dependency tracking primitives
  currentTemplate: "",
  currentDepArr: [],
  globalCurrentDepArr: [],
  
  microtaskPending: false
};
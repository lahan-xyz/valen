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


export const components = new Map();
export const widgets = new Map();
export const reactiveCache = new Map();

export const stylesheet = {
  el: typeof document !== 'undefined' ? document.createElement("style") : null,
  isAppended: false
};

export const sharedTemplate = typeof document !== 'undefined' ? document.createElement('template') : null;


// Extracts the string between two delimiters in a given string.
export function stringBetween(str, f, s, lastIndex) {
  const indx1 = str.indexOf(f);
  if (indx1 === -1) return "";
  const indx2 = !lastIndex ? str.indexOf(s, indx1 + f.length) : str.lastIndexOf(s);
  if (indx2 === -1) return "";
  return str.slice(indx1 + f.length, indx2);
}

export function removeFromReactiveCache(nodeList) {
  for (const child of nodeList) {
    const id = child.valen_id;
    if (id && reactiveCache.has(id)) {
      reactiveCache.delete(id);
    }
  }
}

export const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

const camelReg = /([A-Z])+/g;
// Build KNOWN_STYLE_PROPS in one pass
export const SVG_SPECIFIC = new Set([
  'alignmentBaseline', 'baselineShift', 'bufferedRendering', 'colorInterpolation',
  'colorInterpolationFilters', 'colorRendering', 'cx', 'cy', 'd', 'dominantBaseline',
  'fill', 'fillOpacity', 'fillRule', 'floodColor', 'floodOpacity', 'lightingColor',
  'marker', 'markerEnd', 'markerMid', 'markerStart', 'maskType', 'paintOrder', 'points',
  'r', 'rx', 'ry', 'shapeRendering', 'stopColor', 'stopOpacity', 'stroke',
  'strokeDasharray', 'strokeDashoffset', 'strokeLinecap', 'strokeLinejoin',
  'strokeMiterlimit', 'strokeOpacity', 'strokeWidth', 'textAnchor', 'textRendering',
  'vectorEffect', 'x', 'y', 'x1', 'y1', 'x2', 'y2'
]);

const NORMALIZED_EVENTS = new Set([
  'pointerdown', 'pointerup', 'pointermove',
  'pointerover', 'pointerout',
  'click', 'input', 'submit', 'change', 'keydown'
]);

export const KNOWN_STYLE_PROPS = new Map();

{
  const style = sharedTemplate.style;
  
  for (const k in style) {
    if (SVG_SPECIFIC.has(k)) continue;
    
    const len = k.length;
    let key = '';
    let val = '';
    for (let i = 0; i < len; i++) {
      const c = k.charCodeAt(i);
      if (c >= 65 && c <= 90) { // A–Z
        const lower = String.fromCharCode(c | 32); // fast toLowerCase for ASCII
        key += lower;
        val += '-' + lower;
      } else {
        key += k[i];
        val += k[i];
      }
    }
    KNOWN_STYLE_PROPS.set(key, val);
  }
}


// --- 2. THE MUTABLE CONTEXT WRAPPER ---
// For primitives and variables that get completely overwritten/reassigned
export const ctx = {
  counterVA: 0,
  evtCounter: 0,
  routerObj: {},
  currentComponent: null,
  navigateFunc: () => {},
  
  // Dependency tracking primitives
  currentTemplate: "",
  currentDepArr: [],
  globalCurrentDepArr: [],
  
  microtaskPending: false
};
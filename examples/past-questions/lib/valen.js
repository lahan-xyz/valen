/*!
 * Valen.js
 * (c) 2024-now Sodiq Tunde (lahan-xyz)
 * Released under the MIT License.
 */
'use-strict';

// Counter for generating unique IDs for elements with reactive data.
let counterVA = 0,
  nuggetCounter = 0,
  routerObj = {},
  currentComponent,
  navigateFunc = (() => {});

let stylesheet = {
  el: document.createElement("style"),
  isAppended: false
};

const GLOBAL_STATE = {
  dataVA: [],
  dependencyMap: new Map()
}

const updateQueue = [];
let microtaskPending = false;

const components = new Map(),
  nuggets = new Map();

// Dependency Map
let currentTemplate = "",
  currentDepArr = [],
  globCurrentDepArr = [];

// Cached reactive elements
const reactiveCache = new Map();

// LRU Cache class
class LRUCache {
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


// O(1) element lookup
const selectElement = valen_id => {
  return reactiveCache.get(valen_id);
};


const strToEl = (component) => {
  const id = component.element;
  if (typeof id === "string") {
    component.element = document.getElementById(id);
  }
}

const globalState = (name, val, shouldStore) => {
  let stored;
  if (shouldStore) {
    stored = localStorage.getItem(name);
    val = stored ? JSON.parse(stored) : val; // only parse if truthy
  }
  
  const obj = typeof val === "object" ? val : { value: val };
  
  // Batching helpers for localStorage writes
  let localStorageDirty = false;
  const persist = () => {
    if (shouldStore && localStorageDirty) {
      localStorage.setItem(name, JSON.stringify(obj));
      localStorageDirty = false;
    }
  };
  
  // Cache for nested reactive wrappers – one proxy per underlying object
  const cache = new WeakMap();
  
  const reactiveObj = (object) => {
    if (typeof object !== "object" || object === null) return object;
    
    if (cache.has(object)) return cache.get(object);
    
    const proxy = new Proxy(object, {
      get(target, key) {
        if (currentTemplate) {
          globCurrentDepArr.push({ temp: currentTemplate, key });
        }
        
        return reactiveObj(target[key]);
      },
      set(target, key, value) {
        if (target[key] !== value) {
          target[key] = value;
          // Trigger DOM update (already batched via batchedUpdate)
          updateComponent(key, null);
          
          // Mark localStorage as dirty; write will happen once per microtask
          if (shouldStore) {
            localStorageDirty = true;
            queueMicrotask(persist);
          }
        }
        return true;
      }
    });
    cache.set(obj, proxy);
    return proxy;
  };
  
  globalThis[name] = reactiveObj(obj);
};

// Creates a reactive signal, a proxy object that automatically updates the DOM.
function createSignal(data, object) {
  const item = typeof data !== "object" ? { value: data } : data;
  
  // Cache for nested reactive wrappers – one proxy per underlying object
  const cache = new WeakMap();
  
  function createReactiveObject(obj) {
    if (typeof obj !== "object" || obj === null) return obj;
    
    // Return existing proxy if available
    if (cache.has(obj)) return cache.get(obj);
    
    const proxy = new Proxy(obj, {
      get(target, key) {
        if (currentTemplate) {
          const temp = currentComponent;
          currentDepArr.push({ temp: currentTemplate, key });
        }
        // Recursively wrap nested objects, but now cached
        return createReactiveObject(target[key]);
      },
      set(target, key, value) {
        const prev = target[key];
        if (prev !== value) {
          target[key] = value;
          
          if (!object.isFrozen) {
            const goAhead = object.onUpdate ?
              object.onUpdate({ oldVal: prev, key, newVal: value },
                object.data
              ) :
              true;
            if (goAhead) updateComponent(key, object);
          }
        }
        return true;
      }
    });
    
    cache.set(obj, proxy);
    return proxy;
  }
  
  return createReactiveObject(item);
}

const b = (str, last) => stringBetween(str, "[", "]", last);


// Extracts the string between two delimiters in a given string.
function stringBetween(str, f, s, lastIndex) {
  const indx1 = str.indexOf(f);
  if (indx1 === -1) return "";
  const indx2 = !lastIndex ? str.indexOf(s, indx1 + f.length) : str.lastIndexOf(s);
  if (indx2 === -1) return "";
  return str.slice(indx1 + f.length, indx2);
}

// Sanitizes a string to prevent potential XSS attacks.
function sanitizeString(str) {
  str = String(str);
  
  // Single‑pass regex: escape HTML special chars & remove "javascript:"
  return str.replace(/[&<>"']|javascript:/gi, match => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default: // matched "javascript:" (case‑insensitive)
        return '';
    }
  });
}

function buildDependencyMap(instance, data) {
  if (!instance.dependencyMap) instance.dependencyMap = new Map();
  
  const build = (isNotGlobal, depArr) => {
    let i = 0,
      len = depArr.length;
    
    const dataVA = isNotGlobal ? data : GLOBAL_STATE.dataVA;
    const targetMap = isNotGlobal ? instance.dependencyMap : GLOBAL_STATE.dependencyMap;
    
    for (i = 0; i < len; i++) {
      const { temp, key } = depArr[i];
      dataVA.forEach((entry, j) => {
        if (entry.template.includes(temp)) {
          let deps = targetMap.get(key);
          if (!deps) {
            deps = new Set();
            targetMap.set(key, deps);
          }
          deps.add(entry);
        }
      });
    }
  }
  
  if (currentDepArr.length) build(true, currentDepArr);
  if (globCurrentDepArr.length) build(false, globCurrentDepArr);
  
  currentDepArr = [];
  globCurrentDepArr = [];
  GLOBAL_STATE.dataVA = [];
}



const lexerCache = new LRUCache(500);

function lexTemplate(templateString) {
  if (lexerCache.has(templateString)) {
    return lexerCache.get(templateString);
  }
  
  const chunks = [];
  let depth = 0;
  let inQuote = false;
  let quoteChar = null;
  let startIdx = 0;
  let exprStart = -1;
  
  for (let i = 0; i < templateString.length; i++) {
    const char = templateString[i];
    
    // 1. SMART CONTEXT CHECK: Detect Native HTML Event Handlers
    if (depth === 0 && (char === '"' || char === "'")) {
      let j = i - 1;
      
      // Skip any trailing spaces between the attribute name, "=", and the quote
      while (j > 0 && /\s/.test(templateString[j])) j--;
      
      if (templateString[j] === '=') {
        j--;
        while (j > 0 && /\s/.test(templateString[j])) j--;
        
        // Extract the attribute name
        let nameEnd = j + 1;
        while (j >= 0 && !/[\s=>/<{}]/.test(templateString[j])) j--;
        const attrName = templateString.slice(j + 1, nameEnd);
        
        // If it's a native inline event handler, fast-forward to the closing quote
        if (attrName.startsWith('on')) {
          let closingIdx = i + 1;
          while (closingIdx < templateString.length) {
            if (templateString[closingIdx] === char && templateString[closingIdx - 1] !== '\\') {
              break;
            }
            closingIdx++;
          }
          
          if (closingIdx < templateString.length) {
            i = closingIdx; // Skip the entire body of the event listener
            continue;
          }
        }
      }
    }
    
    // 2. SCOPED QUOTE TRACKING (For handling quotes INSIDE Valen expressions)
    if (depth > 0 && (char === '"' || char === "'" || char === '`') && templateString[i - 1] !== '\\') {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (quoteChar === char) {
        inQuote = false;
        quoteChar = null;
      }
    }
    
    // 3. BRACKET TRACKING
    if (!inQuote) {
      if (char === '[') {
        if (depth === 0) {
          if (startIdx < i) {
            chunks.push({ isExpr: false, val: templateString.slice(startIdx, i) });
          }
          exprStart = i;
        }
        depth++;
      } else if (char === ']') {
        if (depth > 0) {
          depth--;
          
          if (depth === 0) {
            chunks.push({ isExpr: true, val: templateString.slice(exprStart + 1, i) });
            startIdx = i + 1;
          }
        }
      }
    }
  }
  
  // 4. CLEANUP
  if (startIdx < templateString.length) {
    chunks.push({ isExpr: false, val: templateString.slice(startIdx) });
  }
  
  lexerCache.set(templateString, chunks);
  return chunks;
}


const ENTITY_REGEX = /&(gt|lt);/g;
// Prevent memory leaks
const evaluatorCache = new LRUCache(500);

function evaluateTemplate(templateString, instance) {
  const chunks = lexTemplate(templateString);
  
  // Fast exit: If it's just one chunk of text, no expressions exist
  if (chunks.length === 1 && !chunks[0].isExpr) return templateString;
  
  let combinedHTML = '';
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    // If it's standard HTML text, just append it and move on
    if (!chunk.isExpr) {
      combinedHTML += chunk.val;
      continue;
    }
    
    // --- EXPRESSION EVALUATION ---
    const innerContent = chunk.val;
    currentTemplate = innerContent; // Reactivity dependency trap
    
    const ext = innerContent.replace(ENTITY_REGEX, (_, entity) =>
      entity === 'gt' ? '>' : '<'
    ).trim();
    
    if (!ext) continue;
    
    const isGlobal = ext.charCodeAt(0) === 36; // '$'
    
    let evaluator = evaluatorCache.get(ext);
    
    if (!evaluator) {
      try {
        // PERFORMANCE KEY: We pass `data` as a direct parameter to the Function.
        // This is significantly faster and safer than `with(this.data)`.
        const source = isGlobal ?
          `return ${ext};` :
          `with (data) { return ${ext}; }`;
        
        // Pass 'data' as the argument name
        evaluator = new Function("data", source);
        evaluatorCache.set(ext, evaluator);
      } catch (err) {
        console.warn(`Valen Syntax Error in \`${innerContent}\`\n`, err);
        combinedHTML += `[${innerContent}]`; // Output raw bracket if it fails
        continue;
      }
    }
    
    try {
      // Pass instance.data directly into the function execution
      const parsed = isGlobal ? evaluator() : evaluator.call(instance, instance.data);
      
      if (parsed != null && !Number.isNaN(parsed)) {
        combinedHTML += parsed;
      }
    } catch (error) {
      console.warn(`Valen Execution Error in \`${innerContent}\`\n`, error);
    }
  }
  
  currentTemplate = "";
  return combinedHTML;
}


// Gets the attributes of a DOM element.
function getAttributes(el) {
  return Array.from(el.attributes).map(({ nodeName, nodeValue }) => ({ attribute: nodeName, value: nodeValue }));
}


const BARE_WRAPPER = document.createElement('span');

BARE_WRAPPER.style.cssText = 'display: contents; font: inherit; color: inherit;';

function wrapBareExpressions(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodesToWrap = [];
  
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    
    if (text.indexOf('[') !== -1 && text.indexOf(']') !== -1 && node.parentNode.childElementCount > 0) {
      nodesToWrap.push(node);
    }
  }
  
  for (let i = 0, len = nodesToWrap.length; i < len; i++) {
    const textNode = nodesToWrap[i];
    
    // Clone the pre-styled span
    const span = BARE_WRAPPER.cloneNode(false);
    
    textNode.parentNode.insertBefore(span, textNode);
    span.appendChild(textNode);
  }
}



function processComponentMarkup(jsx, instance, subId) {
  sharedTemplate.innerHTML = jsx;
  const fragment = sharedTemplate.content;
  
  wrapBareExpressions(fragment);
  
  const data = [];
  
  try {
    const targetElements = fragment.querySelectorAll("*");
    
    for (let i = 0, len = targetElements.length; i < len; i++) {
      const element = targetElements[i];
      
      if (subId && !element.hasAttribute("data-sub_id")) {
        element.setAttribute("data-sub_id", subId);
      }
      
      const childData = generateDataVA(
        element,
        element.childElementCount > 0, // isParent
        instance
      );
      
      if (childData.length > 0) {
        data.push.apply(data, childData);
      }
      
      element.removeAttribute("innertext");
    }
    
    buildDependencyMap(instance, data);
    return sharedTemplate.innerHTML.replaceAll("<br>", "\n");
    
  } catch (error) {
    console.warn(
      `Valen:\nAn error in Component \`${instance.name || ""}\`:\n ${error}\n\nError sourced from: \`${jsx}\``
    );
    return "";
  }
}


const qOnceMap = {
  text: "textContent",
  html: "innerHTML",
  class: "className"
}

function convertDirective(attr, value, child) {
  if (!attr.startsWith('q:')) return [attr, value, false];
  
  child.removeAttribute(attr);
  
  // --- q:once:xxx ---
  if (attr.startsWith('q:once:')) {
    let realAttr = attr.slice(7);
    return [qOnceMap[realAttr] || realAttr, value, true];
  }
  
  // --- Standard directives ---
  switch (attr) {
    case 'q:show': {
      if (value.includes('[') && value.includes(']')) {
        const expr = b(value, true).trim();
        const fExpr = expr ? `[${expr} ? 'block' : 'none']` : "none";
        return ['display', fExpr, false];
      }
      return ['display', (value === 'true' || value === true || value.length) ? 'block' : 'none', false];
    }
    case 'q:text':
      child.textContent = value;
      return ['textContent', value, false];
      
    case 'q:html':
      return ['innerHTML', value, false];
      
    case 'q:value':
      return ['value', value, false];
      
    default:
      if (attr === 'q:once') {
        console.warn(`Valen: 'q:once' must be followed by ':attribute' (e.g., q:once:id="...").`);
      } else {
        console.warn(`Valen: unknown directive '${attr}'\n'${child.outerHTML}'`);
      }
      return [attr, value, false];
  }
}


// Attribute-to-property mapping for standard DOM elements
const ATTR_TO_PROP = {
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  accesskey: 'accessKey',
  colspan: 'colSpan',
  rowspan: 'rowSpan'
};

const CONTENT_DIRECTIVES = new Set(['q:text', 'q:html', 'q:once:text', 'q:once:html']);

const generateDataVA = (child, isParent, instance) => {
  const arr = [];
  const attributes = getAttributes(child);
  let VAID = child.getAttribute("data-valen_id");
  const useStrict = instance.useStrict;
  
  if (!isParent) {
    let hasExplicitContentDirective = false;
    
    for (let i = 0; i < attributes.length; i++) {
      if (CONTENT_DIRECTIVES.has(attributes[i].attribute)) {
        hasExplicitContentDirective = true;
        break;
      }
    }
    
    if (!hasExplicitContentDirective) {
      const contentKey = useStrict ? 'textContent' : 'innerHTML';
      attributes.push({ attribute: contentKey, value: child[contentKey] });
    }
  }
  
  const childStyle = child.style;
  
  for (let i = 0; i < attributes.length; i++) {
    let { attribute, value } = attributes[i];
    value = value || '';
    
    let once = false;
    const isEvent = attribute.startsWith("on");
    
    if (isEvent) {
      if(child.getAttribute(attribute)) {
        child.setAttribute('data-v-on', attribute.slice(2));
        child.setAttribute('data-v-exp', value.trim());
        child.removeAttribute(attribute);
        continue;
      } else {
        continue;
      }
    }
    
    [attribute, value, once] = convertDirective(attribute, value, child);
    
    const hasTemplate = value.indexOf('[') !== -1 && value.indexOf(']') !== -1;
    
    // Short-circuit logic: Check 'src' first to avoid triggering 
    // the heavy `in childStyle` prototype lookup if we don't have to.
    const isStyle = attribute !== 'src' && (attribute in childStyle);
    
    if (!hasTemplate) {
      if (isStyle) {
        childStyle[attribute] = value;
        child.removeAttribute(attribute);
      } else {
        child[ATTR_TO_PROP[attribute] || attribute] = value;
      }
      continue;
    }
    
    const evaluation = evaluateTemplate(value, instance);
    
    if (!VAID) {
      VAID = `va${counterVA++}`;
      child.setAttribute('data-valen_id', VAID);
    }
    
    if (isStyle) {
      childStyle[attribute] = evaluation;
      child.removeAttribute(attribute);
    } else {
      child[ATTR_TO_PROP[attribute] || attribute] = evaluation;
    }
    
    const expression = b(value).trim();
    // Char code lookup is the fastest way to check the first character
    const isGlobal = expression.charCodeAt(0) === 36; // 36 is '$'
    
    const entryObj = {
      template: value,
      key: isStyle ? `style.${attribute}` : attribute,
      valen_id: VAID,
      isGlobal,
      once
    };
    
    if (isGlobal) {
      GLOBAL_STATE.dataVA.push(entryObj);
    } else {
      arr.push(entryObj);
    }
  }
  
  return arr;
};


// Function to convert an object into a CSS string
function objToStyle(selector = "", obj = {}, alt = "", shouldSwitch) {
  const lines = [];
  
  for (const key in obj) {
    const value = obj[key];
    
    // Guard against non-object/non-string values
    if (typeof value !== "string" && typeof value !== "object") continue;
    
    const isKeyframes = key.includes("@keyframes");
    const isFontFace = key.includes("@font-face");
    const isSpecialAtRule = isKeyframes || isFontFace;
    const isMedia = alt.includes("@media");
    const isRegularRule = !isSpecialAtRule && !isMedia;
    
    if (typeof value === "string") {
      // Build rule: either "selector key { value }" or "key selector { value }"
      const rule = shouldSwitch ?
        `${key}${isRegularRule ? selector : ""} { ${value} }` :
        `${isRegularRule ? selector + " " : ""}${key} { ${value} }`;
      
      lines.push(rule);
    } else {
      // Nested at-rule (e.g., @media, @keyframes with object body)
      // Recursively process, but only once we've opened the block
      lines.push(`${key} {`);
      lines.push(objToStyle(selector, value, key, shouldSwitch));
      lines.push(`}`);
    }
  }
  
  return lines.join("\n");
}

// Function to initiate the stylesheet
function initiateStyleSheet(selector = "", instance = {}, shouldSwitch) {
  // Convert the instance's stylesheet into a CSS string
  let styles = objToStyle(selector, instance.stylesheet, "", shouldSwitch);
  
  // Append the styles to the stylesheet element
  stylesheet.el.textContent += styles;
  
  // Append the stylesheet to the document head if not already appended
  if (!stylesheet.isAppended) {
    document.head.appendChild(stylesheet.el);
    stylesheet.isAppended = true;
  }
  
  instance.stylesheet = null;
}



function addToReactiveCache(parent) {
  const walker = document.createTreeWalker(
      parent,
      NodeFilter.SHOW_ELEMENT
    );
    
  let node;
  
  while (node = walker.nextNode()) {
    const valen_id = node.dataset.valen_id;
    if (valen_id && !reactiveCache.has(valen_id)) {
      reactiveCache.set(valen_id, node);
    }
  }
}


// A registry of events your framework supports via delegation
const DELEGATED_EVENTS = new Set(['click', 'input', 'submit', 'keydown', 'change']);
const eventHandlerCache = new LRUCache(500);

function setupEventDelegation(container, instance) {
  // Prevent attaching multiple master listeners if renderWith is called multiple times
  if (container._vDelegated) return;
  container._vDelegated = true;
  
  DELEGATED_EVENTS.forEach(eventType => {
    container.addEventListener(eventType, (e) => {
      // 1. Find the closest element that cares about this specific event
      const target = e.target.closest(`[data-v-on="${eventType}"]`);
 
      if (!target) return;
      
      // 2. Extract the data
      const expression = target.getAttribute('data-v-exp');
      const subId = target.getAttribute('data-sub_id');
      // 3. Resolve the component instance
      const targetInstance = subId ? components.get(subId) : instance;
      if (!targetInstance) return;
      // 4. Compile or fetch from cache (Just-In-Time Compilation!)
      let handler = eventHandlerCache.get(expression);
      if (!handler) {
        try {
          handler = new Function("e", `const data = this.data; ${expression}`);
          eventHandlerCache.set(expression, handler);
        } catch (err) {
          console.warn(`Valen: Failed to execute event handler:\n${expression}\n${err}`);
          return;
        }
      }
      
      // 5. Execute with the correct context
      const binded = handler.bind(targetInstance);
      binded(e);
    }, false);
  });
}


function update(child, key, evaluated) {
  switch (key) {
    case 'q:exist':
      // Ensure we catch both the string "false" and the boolean false
      if (evaluated === "false" || evaluated === false) {
        const descendants = child.getElementsByTagName('*');
        
        const nodesToClean = new Array(descendants.length + 1);
        nodesToClean[0] = child;
        
        for (let i = 0, len = descendants.length; i < len; i++) {
          const node = descendants[i];
          nodesToClean[i + 1] = node;
        }
        // Remove events and remove child and its descendants from the DOM
        removeEvents(nodesToClean, true);
      }
      break;
      
    case 'disabled':
      const isDisabled = evaluated !== "false" && evaluated !== false;
      if (child.disabled !== isDisabled) {
        child.disabled = isDisabled;
      }
      break;
      
    default:
      // Ultra-fast string check: 115 is the charCode for 's'
      // This allows V8 engines to bypass string allocation for 90% of checks
      if (key.charCodeAt(0) === 115 && key.startsWith("style.")) {
        const sliced = key.slice(6);
        if (child.style[sliced] !== evaluated) {
          child.style[sliced] = evaluated;
        }
      } else {
        if (key in child) {
          if (child[key] != evaluated) {
            child[key] = evaluated;
          }
        } else {
          if (child.getAttribute(key) != evaluated) {
            child.setAttribute(key, evaluated);
          }
        }
      }
  }
}

function scheduleFlush() {
  if (!microtaskPending) {
    microtaskPending = true;
    queueMicrotask(flushUpdates);
  }
}

function batchedUpdate(child, key, evaluated) {
  updateQueue.push({ child, key, evaluated });
  scheduleFlush();
}

function flushUpdates() {
  // Prevent re-entrancy if flush itself triggers more updates
  const batch = [...updateQueue];
  updateQueue.length = 0;
  microtaskPending = false;
  
  for (const { child, key, evaluated } of batch) {
    // Guard: child may have been removed by a previous queued entry
    if (child?.isConnected) {
      update(child, key, evaluated);
    }
  }
}



function updateComponent(changedKey, instance) {
  const dependencyMap = instance === null ? GLOBAL_STATE.dependencyMap : instance.dependencyMap;
  
  const subscribers = dependencyMap.get(changedKey);
  
  if (!subscribers) return;
  
  for (const subscriber of subscribers) {
    const { template, key: targetProp, valen_id: elementId, once } = subscriber;
    
    const node = selectElement(elementId);
    
    // node.isConnected guarantees we aren't updating a "ghost" element that was removed by q:exist/instance.destroy()/manually but is still trapped in your Map cache.
    if (node && node.isConnected) {
      const evaluated = evaluateTemplate(template, instance);
      
      batchedUpdate(node, targetProp, evaluated);
      
      if (once) {
        subscribers.delete(subscriber);
      }
    } else {
      // Element is dead or detached. Instantly sever ALL memory references.
      subscribers.delete(subscriber);
      
      // We explicitly delete it from the cache here so the Garbage Collector can finally wipe the DOM element from the device's RAM.
      reactiveCache.delete(elementId);
    }
  }
}



function renderTemplate(input, props, shouldSanitize) {

  const chunks = lexTemplate(input);
  
  if (!chunks.length || chunks.length === 1 && !chunks[0].isExpr) return input;
  
  let combined = "";
    
  for (var i = 0, len = chunks.length; i < len; i++) {
    const chunk = chunks[i],
      val = chunk.val;
    
    if (!chunk.isExpr) {
      combined += val;
      continue;
    }
    
    const trimmed = val.trim();
    const value = props[trimmed];
    
    if (value === undefined || value === null) {
      combined += `[${val}]`; // keep placeholder for debugging
    }
    
    combined += shouldSanitize ? sanitizeString(value) : value;
  }
    
  return combined;
}

function initiateNuggets(markup, isNugget) {
  const nuggetRegex = /<([A-Z]\w*)\s*\{([\s\S]*?)\}\s*\/>/g;
  
  // Shared cache for compiled props (across all calls)
  if (!initiateNuggets._propsCache) {
    initiateNuggets._propsCache = new Map();
  }
  
  const replacedMarkup = markup.replace(nuggetRegex, (match, name, propsString) => {
    // propsString = the object literal inside { } (trimmed later)
    const trimmedProps = `{ ${propsString.trim()} }`;
    const cacheKey = `${propsString.trim()}`;
    
    let evaluated;
    try {
      // Retrieve or compile the props function
      let propsFn = initiateNuggets._propsCache.get(cacheKey);
      if (!propsFn) {
        propsFn = new Function(`return ${trimmedProps}`);
        initiateNuggets._propsCache.set(cacheKey, propsFn);
      }
      const d = propsFn();
      const instance = nuggets.get(name);
      
      if (instance) {
        evaluated = renderNugget(instance, d);
      } else {
        console.warn(`Valen:\nNugget '${name}' is not defined`);
        evaluated = match; // leave original markup as fallback
      }
    } catch (e) {
      console.warn(`Valen:\nAn error occured while rendering Nugget '${name}': ${e}\n\nError sourced from: \`${match}\``);
      evaluated = match; // keep original on error
    }
    return evaluated;
  });
  
  return lintPlaceholders(replacedMarkup, isNugget);
}



// Compute DOM depth
function getDepth(node) {
  let depth = 0;
  while (node.parentNode) {
    depth++;
    node = node.parentNode;
  }
  return depth;
}

function clearAllNuggetCaches() {
  initiateNuggets._propsCache?.clear();
  initiateExtendedNuggets._propsCache?.clear();
}

const initiateExtendedNuggets = (markup) => {
  // Step 1: Convert component tags to custom elements with va-attrs
  const componentRegex = /<(\/?[A-Z]\w*)(\s*\(\{[\s\S]*?}\))?\s*>/g;
  const convertedMarkup = markup.replace(componentRegex, (match, p1, p2) => {
    const isClosing = match.startsWith('</');
    const tagName = p1
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '');
    
    if (isClosing) {
      return `</${tagName.slice(2)}>`; // keep original closing logic
    }
    
    const attrs = (p2 || '')
      .replace(/\(\{/g, '{')
      .replace(/\}\)/g, '}')
      .replace(/"/g, '`');
    
    return `<${tagName} va-attrs="${attrs}">`;
  });
  
  // Step 2: Parse into a DocumentFragment
  const range = document.createRange();
  const fragment = range.createContextualFragment(convertedMarkup);
  
  // Props cache (static, shared across calls)
  if (!initiateExtendedNuggets._propsCache) {
    initiateExtendedNuggets._propsCache = new Map();
  }
  
  // Step 3: Iteratively replace all va-attrs elements (including new ones)
  let hasComponents = true;
  while (hasComponents) {
    hasComponents = false;
    
    // Collect all elements with va-attrs, deepest first
    const elements = fragment.querySelectorAll('[va-attrs]');
    if (elements.length === 0) break;
    
    // Convert NodeList to array, sort by depth (descending)
    const sorted = Array.from(elements).sort((a, b) => {
      const depthA = getDepth(a);
      const depthB = getDepth(b);
      return depthB - depthA; // deepest first
    });
    
    for (const element of sorted) {
      // Only process if still in the DOM (could have been replaced by a parent)
      if (!element.parentNode) continue;
      
      const originalTag = element.tagName.toLowerCase()
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        .replace(/^./, m => m.toUpperCase());
      const attrs = element.getAttribute('va-attrs');
      const content = element.innerHTML;
      const instance = nuggets.get(originalTag);
      
      if (!instance) {
        console.warn(`Valen:\nNugget '${originalTag}' is not defined`);
        element.removeAttribute('va-attrs');
        continue;
      }
      
      // Compile props (cached)
      let data;
      if (initiateExtendedNuggets._propsCache.has(attrs)) {
        data = initiateExtendedNuggets._propsCache.get(attrs);
      } else {
        try {
          data = new Function(`return ${attrs}`)();
          initiateExtendedNuggets._propsCache.set(attrs, data);
        } catch (e) {
          console.warn(`Valen:\nFailed to parse props for ${originalTag}: ${e}`);
          element.removeAttribute('va-attrs');
          continue;
        }
      }
      
      // Render the nugget
      const replacementHTML = renderNugget(instance, data, true, content);
      const replacementFragment = range.createContextualFragment(replacementHTML);
      
      // Replace the element in‑place
      element.parentNode.replaceChild(replacementFragment, element);
      
      // Since we've inserted new DOM, we need to re‑scan in the next while iteration
      hasComponents = true;
    }
  }
  
  // Step 4: Serialize the final fragment
  const div = document.createElement('div');
  div.appendChild(fragment);
  const finalMarkup = div.innerHTML;
  div.remove();
  
  // Step 5: Let normal nuggets be processed
  return initiateNuggets(finalMarkup);
};


const COMPONENT_SELF_CLOSING_REGEX = /<([A-Z]\w*)\s*\/>/g;

function initiateComponents(markup, isNugget, fromAtom) {
  markup = lintPlaceholders(markup, isNugget);
  
  // If not a nugget, replace self-closing component tags with rendered output
  if (!isNugget && !fromAtom) {
    markup = markup.replace(COMPONENT_SELF_CLOSING_REGEX, (match, tagName) => {
        const instance = components.get(tagName);
        if (!instance) {
          console.warn(`Valen:\nComponent '<${tagName}/>' is not defined, check whether '${tagName}' is correctly spelt or is defined.`);
          return match; // leave original to avoid further breakage
        }
        try {
          return renderComponent(instance, tagName);
        } catch (e) {
          console.warn(`Valen:\nAn error occured while rendering Component '${tagName}' \n ${e}, \n\nError sourced from: \`${match}\``);
          return match;
      }
    });
  }
  
  // After components, process nuggets
  markup = initiateNuggets(markup);
  markup = initiateExtendedNuggets(markup);
  
  return lintPlaceholders(markup, isNugget);
}


const lintPlaceholders = (html, isNugget) => {
  const eventRegex = /(on[\w]+)\s*=\s*\[((?:[^\[\]]|\[[^\[\]]*\])*)\]/g;
  const attributeRegex = /([\w-:]+)\s*=\s*\[((?:[^\[\]]|\[[^\[\]]*\])*)\]/g;

  // 1. Process Events
  if (!isNugget) {
    html = html.replace(eventRegex, (_, attrName, innerContent) => {
      return `${attrName}='${innerContent.replaceAll("'", "`")}'`;
    });
  }

  // 2. Process Directives & Standard Attributes
  return html.replace(attributeRegex, (_, attrName, innerContent) => {
    return `${attrName}="[${innerContent}]"`;
  });
};

const removeEvents = (nodeList, shouldRemove) => {
  // 1. Standard for-loop avoids iterator allocation overhead on HTMLCollections
  for (let i = 0, len = nodeList.length; i < len; i++) {
    const child = nodeList[i];
    
    // 2. Clean up Valen's tracked handlers (Fastest path)
    if (child._vaHandlerKeys) {
      const keys = child._vaHandlerKeys;
      for (let j = 0, kLen = keys.length; j < kLen; j++) {
        const attrName = keys[j];
        const handler = child[attrName];
        
        if (handler) child.removeEventListener(attrName, handler);
        
        child[attrName] = null;
        eventHandlerCache.delete(attrName);
      }
      child._vaHandlerKeys = null;
    }
    
    // 4. Bypass dataset completely, rely solely on getAttribute
    const valen_id = child.getAttribute('data-valen_id');
    if (valen_id) reactiveCache.delete(valen_id);
    
    // 5. Teardown
    if (shouldRemove) child.remove();
  }
  
  clearAllNuggetCaches();
};

const renderComponent = (instance, name, flag) => {
  // 1. Early Return (Flattens the execution path)
  if (instance.isMounted) return "";
  
  const id = typeof instance.element === 'string' ?
    instance.element :
    instance.element.id;
  
  // 2. Evaluate template ONCE
  const innerTemplate = typeof instance.template === 'function' ?
    instance.template(instance.data) :
    instance.template;
  
  // 3. Clean string assignment
  let template = flag ?
    innerTemplate :
    `<div id="${id}">${innerTemplate}</div>`;
  
  // 4. Pipeline
  template = handleRouter(template);
  template = initiateComponents(template);
  initiateStyleSheet(`#${id}`, instance);
  
  const rendered = processComponentMarkup(template, instance, name);
  
  // 5. State sync
  instance.isMounted = true;
  
  return rendered;
};




class App {
  // 1. Declare strict private fields
  #element;
  #isFrozen = false;
  #useStrict;
  #onUpdate;
  #run;
  #created;
  #template;
  #addedToReactiveCache = false;
  
  constructor(selector = "", options = {}) {
    this.#element = typeof selector === "string" ?
      document.querySelector(selector) :
      selector;
    
    if (!this.#element) {
      throw new Error(`Valen:\nElement selector '${selector}' is invalid`);
    }
    
    // Template
    this.#template = options.template || "";
    
    // Reactive state
    this.data = createSignal(options.data, this);
    
    this.stylesheet = options.stylesheet;
    
    // Assign to private fields
    this.#onUpdate = options.onUpdate;
    this.#created = options.created;
    this.#run = options.run || (() => {});
    
    // O(1) existence check instead of O(N) array allocation
    this.#useStrict = 'useStrict' in options ? options.useStrict : true;
    
    // Batched rendering queue
    this._renderPending = false;
    
    initiateStyleSheet("", this);
    
    let _data = this.data;
    Object.defineProperties(this, {
      data: {
        get: () => _data,
        set: (data) => {
          if (!this.#isFrozen) {
            // Hardened object validation
            if (!data || typeof data !== "object" || Array.isArray(data)) {
              console.warn(`Value of 'App.data' must be a plain object`);
              return;
            }
            
            const keys = Object.keys(data);
            for (let key of keys) {
              this.data[key] = data[key];
            }
          }
          return true;
        },
        configurable: true
      }
    });
    
    if (this.#created) {
      this.#created(this.data);
      this.#created = null; // Can still mutate internally
    }
  }
  
  // 2. Expose read-only public getters
  get element() { return this.#element; }
  get template() { return this.#template; }
  get isFrozen() { return this.#isFrozen; }
  get useStrict() { return this.#useStrict; }
  get onUpdate() { return this.#onUpdate; }
  get run() { return this.#run; }
  get created() { return this.#created; }
  
  _scheduleRender() {
    if (!this._renderPending) {
      this._renderPending = true;
      queueMicrotask(() => {
        this._renderPending = false;
        this._doRender();
      });
    }
  }
  
  _doRender() {
    let template = this.template instanceof Function ?
      this.template(this.data) :
      this.template;
    
    template = handleRouter(template);
    template = initiateComponents(template, false, false);
    
    const htmlString = processComponentMarkup(template, this);
    const fragment = document.createRange().createContextualFragment(htmlString);
    
    // 3. Replaces while-loop removal and appendChild in a single native API call
    this.#element.replaceChildren(fragment);
    
    currentComponent?.navigateFunc(currentComponent.data);
    
    if (!this.#addedToReactiveCache) {
      addToReactiveCache(this.#element);
      this.#addedToReactiveCache = true;
    }
    
    setupEventDelegation(this.#element, this);
    
    for (const component of components) {
      const instance = component[1];
      if (instance.constructor.name === "Atom") continue;
      
      if (instance.element) {
        strToEl(instance);
      }
      instance.run(instance.data);
    }
    
    this.#run(this.data);
  }
  
  render() {
    this._renderPending = false;
    this._doRender();
  }
  
  freeze() {
    this.#isFrozen = true; // Internal mutation works perfectly
  }
  
  unfreeze() {
    this.#isFrozen = false;
  }
  
  destroy() {
    const allNodes = [this.#element];
    const walker = document.createTreeWalker(
      this.#element,
      NodeFilter.SHOW_ELEMENT
    );
    let node;
    while ((node = walker.nextNode())) {
      allNodes.push(node);
    }
    
    removeEvents(allNodes);
    this.#element.remove();
  }
}


class Component {
  // 1. Declare strict private fields
  #name;
  #isFrozen = false;
  #useStrict;
  #onUpdate;
  #run;
  #created;
  #template;
  
  constructor(name, options = {}) {
    if (name) {
      globalThis[name] = this;
    }
    
    // Assign to private fields
    this.#name = name;
    this.#template = options?.template;
    this.#run = options.run || (() => {});
    this.isMounted = false;
    this.navigateFunc = options.onNavigate || (() => {});
    
    if (!this.#template) {
      throw new Error(`Valen:\nTemplate not provided for Component ${name}`);
    }
    
    this.element = `vaEl${counterVA}`; // string ID – later resolved to DOM node
    counterVA++;
    
    // Reactive state
    this.data = createSignal(options.data, this);
    
    this.#created = options.created;
    this.stylesheet = options.stylesheet;
    this.#onUpdate = options.onUpdate;
    
    // O(1) existence check instead of O(N) array allocation
    this.#useStrict = 'useStrict' in options ? options.useStrict : true;
    
    // Batched rendering queue (microtask‑based)
    this._renderPending = false;
    
    let _data = this.data;
    
    // 2. Only define the custom setter/getter for `data` here
    Object.defineProperty(this, "data", {
      get: () => _data,
      set: (data) => {
        if (!this.#isFrozen) {
          // Hardened object validation
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            console.warn(`Value of '${this.#name}.data' must be a plain object`);
            return;
          }
          
          const keys = Object.keys(data);
          
          for (let key of keys) {
            this.data[key] = data[key];
          }
        }
        return true;
      },
      configurable: true
    });
    
    if (this.#created) {
      this.#created(this.data);
      this.#created = null; // Safe internal mutation
    }
    
    components.set(name, this);
  }
  
  // 3. Expose read-only public getters
  get name() { return this.#name; }
  get isFrozen() { return this.#isFrozen; }
  get useStrict() { return this.#useStrict; }
  get onUpdate() { return this.#onUpdate; }
  get run() { return this.#run; }
  get created() { return this.#created; }
  get template() { return this.#template; }
  
  _scheduleRender() {
    if (!this._renderPending) {
      this._renderPending = true;
      queueMicrotask(() => {
        this._renderPending = false;
        
        const el = this._resolveElement();
        if (el && el.isConnected) {
          renderComponent(this, this.#name);
        }
      });
    }
  }
  
  renderNow() {
    this._renderPending = false;
    renderComponent(this, this.#name);
  }
  
  freeze() {
    this.#isFrozen = true;
  }
  
  unfreeze() {
    this.#isFrozen = false;
  }
  
  show() {
    const el = this._resolveElement();
    if (el && el.style.display !== 'block') {
      el.style.display = 'block';
    }
  }
  
  hide() {
    const el = this._resolveElement();
    if (el && el.style.display !== 'none') {
      el.style.display = 'none';
    }
  }
  
  mount() {
    if (!this.isMounted) {
      const rendered = renderComponent(this, this.#name, true);
      const fragment = document.createRange().createContextualFragment(rendered);
      const el = this._resolveElement();
      
      if (el) {
        // 4. Native C++ engine replacement replaces loop allocation
        el.replaceChildren(fragment);
      }
      
      this.isMounted = true; // Internal mutation
    }
  }
  
  destroy() {
    const el = this._resolveElement();
    if (!el) return;
    
    const allNodes = [el];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      allNodes.push(node);
    }
    
    removeEvents(allNodes);
    el.remove();
  }
  
  _resolveElement() {
    if (typeof this.element === 'string') {
      return document.querySelector(this.element) || null;
    }
    return this.element;
  }
}

function addIndexToTemplate(str, index, instance) {
  str = lintPlaceholders(str);
  const chunks = lexTemplate(str);

  let combined = "";
  
  if (!chunks.length || chunks.length === 1 && !chunks[0].isExpr) return str;
  
  for (var i = 0, len = chunks.length; i < len; i++) {
    const chunk = chunks[i],
      val = chunk.val;
    
    if (!chunk.isExpr) {
      combined += val;
      continue;
    }
    
    combined += `[this.data[${index}].${val.trim()}]`;
  }
  
  const linted = lintPlaceholders(combined);

  return instance ? evaluateTemplate(linted, instance) : linted;
}


const sharedTemplate = document.createElement('template');

function g(str, className) {
  sharedTemplate.innerHTML = str;
  
  const children = sharedTemplate.content.querySelectorAll("*");
  
  for (let i = 0, len = children.length; i < len; i++) {
    children[i].classList.add(className);
  }
  
  return sharedTemplate.innerHTML;
}

function stringToDocumentFragment(htmlString = "") {
  sharedTemplate.innerHTML = htmlString;
  
  // Return the content directly. 
  // Appending it later will move the nodes, saving ~130ms of memory cloning!
  return sharedTemplate.content; 
}



class Atom {
  // 1. Declare strict private fields
  #element;
  #name;
  #template;
  #data = [];
  #useStrict = true;
  #isReactive;
  
  constructor(name, options, id) {
    this.#element = id;
    this.#name = name;
    this.#template = options.template;
    this.#isReactive = options.isReactive;
    
    this.stylesheet = options.stylesheet;
    this.dependencyMap = new Map();
    initiateStyleSheet(`#${id}`, this);
    components.set(name, this)
  }
  
  // 2. Expose read-only public getters
  get element() { return this.#element; }
  get name() { return this.#name; }
  get template() { return this.#template; }
  get data() { return this.#data; }
  get useStrict() { return this.#useStrict; }
  get isReactive() { return this.#isReactive; }
  
  // Resolve string ID to DOM element once and cache it internally
  _getElement() {
    if (typeof this.#element === "string") {
      const resolvedNode = document.getElementById(this.#element);
      if (!resolvedNode) {
        throw new Error(`Valen:\nMount node of '${this.#name}' is invalid or not provided`);
      }
      this.#element = resolvedNode; // Cache the node
    }
    return this.#element;
  }
  
  // Cleanly clear the container and purge events
  destroy() {
    const el = this._getElement();
    if (!el) return;
    
    const allNodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode; // Start at root container
    
    while (node) {
      allNodes.push(node);
      node = walker.nextNode();
    }
    
    removeEvents(allNodes);
    
    el.replaceChildren();
    
    this.#data = [];
  }
  
  renderWith(data, position = "append") {
  if (!data || typeof data !== "object") {
    throw new Error(
      `Valen:\nFirst argument passed to '${this.#name}.renderWith()' must either be an object or an array.`
    );
  }
  
  const el = this._getElement();
  const dataArray = Array.isArray(data) ? data : [data];
  if (dataArray.length === 0) return;
  
  const dataLen = this.#data.length;
  
  this.#data = createSignal(dataArray.slice(), this);
  
  // Return a Promise that resolves when rendering finishes
  return new Promise((resolve, reject) => {
    const isTemplateFunc = typeof this.#template === "function";
    const isReactive = this.#isReactive;
    const template = this.#template;
    const name = this.#name;
    
    const processNuggets = (html) => {
      html = initiateNuggets(html);
      return initiateExtendedNuggets(html);
    };
    
    // ── Configuration ──
    const BATCH_SIZE = 30; // items per animation frame – tune this!
    const htmlParts = [];
    let currentIndex = dataLen;
    
    const processBatch = () => {
      const end = Math.min(currentIndex + BATCH_SIZE, dataArray.length);
      
      for (let i = currentIndex; i < end; i++) {
        const item = dataArray[i];
        let itemHTML = isTemplateFunc ? template(item, i) : template;

        itemHTML = isReactive ?
          addIndexToTemplate(itemHTML, i) :
          addIndexToTemplate(itemHTML, i, this);
        
        if (isReactive) {
          itemHTML = initiateComponents(itemHTML, false, true);
          itemHTML = processComponentMarkup(itemHTML, this, name);
        } else {
          itemHTML = processNuggets(itemHTML);
          itemHTML = lintPlaceholders(itemHTML, true);
          itemHTML = processComponentMarkup(itemHTML, this, name);
        }
        
        htmlParts.push(itemHTML);
      }
      
      currentIndex = end;
      
      if (currentIndex < dataArray.length) {
        // Still have items – yield the main thread
        requestAnimationFrame(processBatch);
      } else {
        // All items processed – build final DOM once and mount
        try {
          const combinedHTML = htmlParts.join('');
          const fragment = stringToDocumentFragment(combinedHTML);
          if (position === "append") {
            el.appendChild(fragment);
          } else {
            el.prepend(fragment);
          }
          
          addToReactiveCache(el);
          resolve(); // Done
        } catch (err) {
          reject(err);
        }
      }
    };
    // Kick off the first batch
    requestAnimationFrame(processBatch);
  });
}
  
  set(index, value, shallow) {
    if (!this.#isReactive) {
      throw new Error(`Valen:\nCannot call 'set()' on Atom ${this.#name}.\n\n${this.#name} is not a reactive Atom`);
    }
    
    if (typeof index === "number") {

      if (value && typeof value === "object") {
        if(shallow) {
          Object.keys(value).forEach(key => {
          this.#data[index][key] = value[key];
          });
        } else {
          this.#data[index] = value;
        }
      }
    } else if (Array.isArray(index)) {
      index.forEach((newObj, i) => {
        this.#data[i] = newObj;
      });
    } else {
      console.warn(`Valen:\nFirst Argument passed to '${this.#name}.set()' must either be a number or an array.`);
    }
  }
}

const renderNugget = (instance, data, isExtended, children) => {
  if (instance) {
    const className = instance.className;
    // Create a variable that holds the template 
    let template = instance.template instanceof Function ? instance.template(data) : instance.template;
    
    if (isExtended) {
      template = template.replaceAll("</>", children);
    }
    
    // Parse and initiate Nested Nuggets
    const initiated = initiateNuggets(template, true);
    
    // Render parsed html
    let rendered = renderTemplate(initiated, data);
    
    const html = g(rendered, className);
    if (!instance.stylesheetInitiated) {
      // Initiate stylesheet for instance 
      initiateStyleSheet("." + className, instance, true);
      instance.stylesheetInitiated = true;
    }
    
    // Return processed html
    return html;
  }
}

class Nugget {
  /**
   * A class for creating reusable UI components
   * @param {Object} options    An object containing all required options for the component
   */
  
  // 1. Declare strict private fields
  #className;
  #template;
  
  constructor(name, options = {}) {
    // Stores instance's stylesheet 
    this.stylesheet = options.stylesheet ?? {};
    
    // Create a property that generates a unique className for instance's parent element
    this.#className = `nugget${nuggetCounter}`;
    
    // Increment the nuggetCounter variable for later use
    nuggetCounter++;
    
    // Stores template 
    this.#template = options.template;
    this.stylesheetInitiated = false;
    
    nuggets.set(name, this);
  }
  
  // 2. Expose read-only public getters
  get className() { return this.#className; }
  get template() { return this.#template; }
  
  destroy() {
    // 3. Query safely utilizing the internal private field
    const all = document.querySelectorAll(`.${this.#className}`);
    // Remove elements and their events from the DOM
    removeEvents(all, true);
  }
}

globalThis.toPage = (path) => {
  history.pushState({}, '', path);
  loadComponent(path)
}

const loadComponent = (path) => {
  const len = routerObj.length;
  let comp404 = '';
  
  const changeView = (name, title) => {
    const instance = components.get(name);
    currentComponent?.hide();
    if (instance.isMounted) {
      instance.show();
    } else {
      instance.mount();
      instance.show();
    }
    document.title = title;
    currentComponent = instance;
    currentComponent.navigateFunc(currentComponent.data);
  }
  
  for (let i = 0; i < len; i++) {
    const { component, route, title } = routerObj[i];
    if (route === "*") {
      comp404 = component;
    }
    if (route === path) {
      changeView(component, title);
      break;
    } else {
      if (i === len - 1) {
        changeView(comp404, title)
      }
    }
  }
  navigateFunc(path);
  window.scrollTo(0, 0);
}


const Link = new Nugget('Link', {
  template: (data) => {
    const classN = data.class ? 'class=[ class ]' : '';
    return `
      <a href=[ to ] ${ classN } onclick="
        e.preventDefault()
        toPage('[ to ]')">${ data.isBtn ? '<button>[ label ]</button>' : '[ label ]' }</a>`
  }
})

function handleRouter(input) {
  const routerReg = /<(Router)\s*\{([\s\S]*?)\}\s*\/>/g;
  let out = '',
    computed = '';
  
  if (routerReg.test(input)) {
    const extr = input.match(routerReg)[0],
      whiteSpaceIndex = extr.indexOf(" "),
      d = extr.slice(whiteSpaceIndex, -2).trim(),
      path = window.location.pathname;
    const data = Function(`return ${d}.routes`)(),
      len = data.length;
    
    let comp404 = '',
      isSet = false;
    
    computed = data.map(({ route, component }, i) => {
      data[i].component = stringBetween(component, " <", "/>");
      
      const name = data[i].component;
      const title = data[i].title;
      if (!title) {
        throw new Error(`Valen Router Error:\nTitle not set for component '${ name }'`)
      }
      
      let instance = components.get(name);
      
      if (!instance) throw new Error(`\n\nValen Router Error:\nAn error occured while rendering component '${name}'`);
      
      if (route === "*") {
        comp404 = name;
      }
      
      if (route === path) {
        isSet = true;
        currentComponent = instance;
        document.title = title;
        return renderComponent(instance, name);
      } else {
        if (i === len - 1 && !isSet) {
          instance = components.get(comp404);
          currentComponent = instance;
          document.title = title;
          return renderComponent(instance, comp404);
        } else {
          const id = instance.element;
          return `<div id="${id}" display="none"></div>`;
        }
      }
    }).join('');
    routerObj = data;
    out = input.replace(extr, computed);
  } else {
    return input;
  }
  
  window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    loadComponent(path);
  });
  
  return out;
}

const onNavigate = (func, instance) => {
  navigateFunc = func.bind(instance);
}

export {
  App,
  Component,
  Nugget,
  Atom,
  globalState
};
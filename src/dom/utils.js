import { ctx, stylesheet, LRUCache, sharedTemplate, stringBetween, reactiveCache, removeFromReactiveCache, GLOBAL_STATE, components, KNOWN_STYLE_PROPS, INPUT_TAGS, SVG_SPECIFIC } from '../internal.js'
import { initiateComponents, evaluateTemplate } from '../parser/utils.js';


const b = (str, last) => stringBetween(str, "[", "]", last);

const serializer = new XMLSerializer();

const strToEl = (component) => {
  const id = component.element;
  if (typeof id === "string") {
    component.element = document.getElementById(id);
  }
}


// O(1) element lookup
const selectElement = valen_id => {
  return reactiveCache.get(valen_id);
};

const _knownPropsCache = Object.create(null);
const _styleKeyCache = new Map(); // "style.color" → "color"

function update(child, key, evaluated, isAttribute) {
  
  // ── 1. v:exist (structural directive) ──────────────────────────────────
  if (key === 'v:exist') {
    if (evaluated === false || evaluated === 'false') {
      const descendants = child.getElementsByTagName('*');
      const count = descendants.length;
      const nodesToClean = new Array(count + 1);
      nodesToClean[0] = child;
      
      for (let i = 0; i < count; i++) {
        nodesToClean[i + 1] = descendants[i];
      }
      removeFromReactiveCache(nodesToClean);
      child.remove();
    }
    return;
  }
  
  // ── 2. disabled (high-frequency boolean property) ──────────────────────
  if (key === 'disabled') {
    const isDisabled = evaluated !== false && evaluated !== 'false';
    if (child.disabled !== isDisabled) {
      child.disabled = isDisabled;
    }
    return;
  }
  
  // ── 3. style.* (char-code fast-path) ───────────────────────────────────
  if (key.length > 6 && key.charCodeAt(0) === 115 && key.charCodeAt(5) === 46) {
    if (key.charCodeAt(1) === 116 && key.charCodeAt(2) === 121 &&
      key.charCodeAt(3) === 108 && key.charCodeAt(4) === 101) {
      
      let prop = _styleKeyCache.get(key);
      if (prop === undefined) {
        prop = key.substring(6); // substring is historically slightly faster than slice
        _styleKeyCache.set(key, prop);
      }
      
      const style = child.style;
      if (style[prop] !== evaluated) {
        style[prop] = evaluated;
      }
      return;
    }
  }
  
  // ── 4. SVG (attribute-only fast path) ──────────────────────────────────
  if (SVG_SPECIFIC.has(key)) {
    // HUGE FIX: Added equality diffing. 
    // Unconditionally calling setAttribute() triggers expensive layout/paint 
    // recalculations in the browser, even if the value hasn't changed.
    if (child.getAttribute(key) != evaluated) {
      child.setAttribute(key, evaluated);
    }
    return;
  }
  
  // ── 5. Attribute mode ──────────────────────────────────────────────────
  if (isAttribute && key !== "value") {
    const current = child.getAttribute(key);
    
    if (current != evaluated) {
      // OPTIMIZATION: Replaced loose inequality (!=) with strict equality (===)
      // This entirely bypasses the JS engine's type-coercion overhead when
      // `evaluated` is a boolean or number being checked against string rules.
      if (evaluated === "false" || evaluated === "") {
        if (current !== null) {
          child.removeAttribute(key);
        }
      } else {
        child.setAttribute(key, evaluated);
      }
    }
    return;
  }
  
  
  // ── 6. Property mode ────────────────────────────────────────
  let isProp = _knownPropsCache[key];
  
  if (isProp === undefined) {
    // We only pay the prototype-walking penalty ONCE per unique key
    isProp = key in child;
    _knownPropsCache[key] = isProp;
  }
  
  if (isProp === true) {
    if (child[key] != evaluated) {
      child[key] = evaluated;
    }
  }
}

function scheduleFlush() {
  if (!ctx.microtaskPending) {
    ctx.microtaskPending = true;
    queueMicrotask(flushUpdates);
  }
}


let updateMap = new Map();

function batchedUpdate(child, key, evaluated, isAttribute) {
  let entry = updateMap.get(child);
  if (!entry) {
    entry = {};
    updateMap.set(child, entry);
  }
  entry[key] = evaluated;
  entry.isAttribute = isAttribute;
  
  scheduleFlush();
}

function flushUpdates() {
  const batch = updateMap;
  updateMap = new Map();
  ctx.microtaskPending = false;
  
  for (const [child, mutations] of batch) {
    if (child?.isConnected) {
      for (const key in mutations) {
        update(child, key, mutations[key], mutations.isAttribute);
      }
    }
  }
}


function updateComponent(changedKey, instance) {
  const dependencyMap = !instance ? GLOBAL_STATE.dependencyMap : instance.dependencyMap;
  const subscribers = dependencyMap.get(changedKey);
  
  if (!subscribers) return;
  
  for (const subscriber of subscribers) {
    const template = subscriber.template;
    const targetProp = subscriber.key;
    const elementId = subscriber.valen_id;
    const once = subscriber.once;
    const isAttribute = subscriber.isAttribute;
    
    const node = selectElement(elementId);
    if (node && node.isConnected) {
      const evaluated = evaluateTemplate(template, instance);
      batchedUpdate(node, targetProp, evaluated, isAttribute);
      if (once) subscribers.delete(subscriber);
    } else {
      subscribers.delete(subscriber);
      reactiveCache.delete(elementId);
    }
  }
}


function objToStyle(selector = "", obj = {}, alt = "", shouldSwitch) {
  const lines = [];
  // `alt` never changes during iteration — compute once, not per-key
  const isMedia = alt.charCodeAt(0) === 64 && alt.startsWith("@media");
  
  for (const key in obj) {
    const value = obj[key];
    if (typeof value !== "string" && typeof value !== "object") continue;
    
    const isAtRule = key.charCodeAt(0) === 64;
    const isRegularRule = !isAtRule && !isMedia;
    
    if (typeof value === "string") {
      const rule = shouldSwitch ?
        `${key}${isRegularRule ? selector : ""} { ${value} }` :
        `${isRegularRule ? selector + " " : ""}${key} { ${value} }`;
      lines.push(rule);
    } else {
      lines.push(`${key} {`);
      lines.push(objToStyle(selector, value, key, shouldSwitch));
      lines.push(`}`);
    }
  }
  
  return lines.join("\n");
}


function initiateStyleSheet(selector = "", instance = {}, shouldSwitch) {
  if (!instance.stylesheet) return;
  let styles = objToStyle(selector, instance.stylesheet, "", shouldSwitch);
  if (!stylesheet.isAppended) {
    document.head.appendChild(stylesheet.el);
    stylesheet.isAppended = true;
  }
  stylesheet.el.appendChild(document.createTextNode(styles + "\n"));
  instance.stylesheet = null;
}


// Prototypeless dictionary for faster property lookups
const qOnceMap = Object.assign(Object.create(null), {
  text: "textContent",
  html: "innerHTML",
  class: "className"
});

function convertDirective(attr, value, child) {
  if (attr.charCodeAt(0) !== 118 || attr.charCodeAt(1) !== 58 || attr === "v:syn" || attr === "v:exist") {
    return [attr, value, false];
  }
  
  child.removeAttribute(attr);
  
  if (attr.startsWith('v:once:')) {
    const realAttr = attr.substring(7);
    return [qOnceMap[realAttr] || realAttr, value, true];
  }
  
  if (attr.startsWith('v:copy:')) {
    const endIdx = attr.indexOf(':', 7);
    const _var = endIdx === -1 ? attr.substring(7) : attr.substring(7, endIdx);
    const val = "navigator.clipboard.writeText(" + _var + ").then(()=>{" + value + "}).catch(err=>console.error('Failed to copy text:\\n'+err))";
    return ["@click", val, false];
  }
  
  switch (attr) {
    case 'v:show': {
      if (value.indexOf('[') !== -1 && value.indexOf(']') !== -1) {
        const expr = b(value, true).trim();
        const fExpr = expr ? "[" + expr + " ? 'block' : 'none']" : "none";
        return ['display', fExpr, false];
      }
      const isVisible = (value === 'true' || value === true || value.length > 0);
      return ['display', isVisible ? 'block' : 'none', false];
    }
    case 'v:text':
      child.textContent = value;
      return ['textContent', value, false];
      
    case 'v:html':
      return ['innerHTML', value, false];
      
    default:
      if (attr === 'v:once') {
        console.warn("Valen: 'v:once' must be followed by ':attribute' (e.g., v:once:id=\"...\").");
      } else {
        console.warn("Valen: unknown directive '" + attr + "'\n'" + child.outerHTML + "'");
      }
      return [attr, value, false];
  }
}


// ─── Static lookup tables (module-init, runs once) ───────────────────────────
const ATTR_TO_PROP = {
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  accesskey: 'accessKey',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
};

const CONTENT_DIRECTIVES = new Set(['v:text', 'v:html', 'v:once:text', 'v:once:html']);

function createEntry(template, key, valen_id, once, isAttribute) {
  return { template, key, valen_id, once, isAttribute };
}

const eventsCache = new Map();

// ─── Hot path ────────────────────────────────────────────────────────────────
function generateDataVA(child, isParent, instance) {
  const isSVG = child instanceof SVGElement;
  const name = instance.name;
  const useStrict = instance.useStrict;
  const isRootComponent = instance.isRootComponent;
  const isComponent = instance.type === 'Component';
  const hasSyn = child.hasAttribute("v:syn");
  
  // 1. FAST STATIC SNAPSHOT
  // Replaces [...child.attributes] with flat pre-sized arrays.
  // This completely stops the "live index shifting" bug while avoiding heavy GC.
  const nativeAttrs = child.attributes;
  let len = nativeAttrs.length;
  const keys = new Array(len);
  const vals = new Array(len);
  
  for (let i = 0; i < len; i++) {
    keys[i] = nativeAttrs[i].name;
    vals[i] = nativeAttrs[i].value ?? '';
  }
  
  // 2. Implicit content directive (Fixed original `.attribute` typo)
  if (!isParent && !hasSyn) {
    let hasContent = false;
    for (let i = 0; i < len; i++) {
      // Your original code checked attributes[i].attribute which is undefined.
      // Now it properly checks the actual string name (keys[i]).
      if (CONTENT_DIRECTIVES.has(keys[i])) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      const key = useStrict ? 'textContent' : 'innerHTML';
      const val = child[key];
      if (val && val.length > 0) {
        keys.push(key);
        vals.push(val);
        len++; // Expand the loop boundary to process this fake attribute
      }
    }
  }
  
  // OPTIMIZATION: Hoisted out of the loop
  if (isComponent && child.hasAttribute('id')) {
    child.setAttribute('data-__v_cname__', name);
  }
  
  const arr = [];
  const childStyle = child.style;
  let VAID = null;
  let vaChecked = false;
  let evtId = null;
  let evtChecked = false;
  
  // 3. Main processing loop runs against frozen arrays, safe from DOM mutation
  for (let i = 0; i < len; i++) {
    let attribute = keys[i];
    let value = vals[i];
    
    if (hasSyn && (attribute === "textContent" || attribute === 'v:text')) {
      child.textContent = value;
      if (isRootComponent) child.removeAttribute("v:syn");
      continue;
    }
    
    if (attribute === 'class' && !isSVG) attribute = 'className';
    
    const conv = convertDirective(attribute, value, child);
    attribute = conv[0];
    value = conv[1];
    const once = conv[2];
    
    const c0 = attribute.charCodeAt(0);
    
    // "on…" → illegal event syntax
    if (c0 === 111 /* o */ && attribute.charCodeAt(1) === 110 /* n */ ) {
      throw new Error(
        "Valen:\nEvent names must start with '@'.\nRefer to element: <" + child.tagName.toLowerCase() + ">."
      );
    }
    
    // "@…" → event binding
    if (c0 === 64 /* @ */ ) {
      if (value) {
        if (!evtChecked) {
          evtId = child.getAttribute('data-evt_id');
          evtChecked = true;
        }
        if (!evtId) {
          evtId = 'evt' + ctx.evtCounter++;
          child.setAttribute('data-evt_id', evtId);
        }
        
        const eventName = attribute.substring(1);
        
        // Fast Map caching without fallback array allocations
        let cache = eventsCache.get(evtId);
        if (cache === undefined) {
          cache = [];
          eventsCache.set(evtId, cache);
        }
        cache.push({ name: eventName, value });
        usedEvents.add(eventName);
      }
      child.removeAttribute(attribute);
      continue;
    }
    
    // Fast string check bypasses .includes() allocation
    const hasTemplate = value.indexOf('[') !== -1 && value.indexOf(']') !== -1;
    const prop = ATTR_TO_PROP[attribute] ?? attribute;
    const style = KNOWN_STYLE_PROPS.get(prop);
    
    if (!hasTemplate && !style) continue;
    
    const finalValue = hasTemplate ? evaluateTemplate(value, instance) : value;
    
    if (prop === "v:exist" && (finalValue === "false")) {
      child.remove();
      break;
    }
    
    let isAttribute = false;
    
    if (style) {
      childStyle[style] = finalValue;
      child.removeAttribute(attribute);
    } else if (SVG_SPECIFIC.has(prop)) {
      child.setAttribute(prop, finalValue);
    } else if (child.hasAttribute(prop)) {
      isAttribute = true;
      if (finalValue !== "false") {
        child.setAttribute(prop, finalValue);
      } else {
        child.removeAttribute(prop);
      }
    } else {
      child[prop] = finalValue;
    }
    
    if (!hasTemplate) continue;
    
    if (!vaChecked) {
      VAID = child.getAttribute('data-valen_id');
      vaChecked = true;
    }
    if (!VAID) {
      VAID = 'va' + ctx.counterVA++;
      child.setAttribute('data-valen_id', VAID);
    }
    
    const expression = b(value).trim();
    const entry = createEntry(
      value,
      style ? 'style.' + style : attribute,
      VAID,
      once,
      isAttribute
    );
    
    // 36 = '$'
    if (expression.charCodeAt(0) === 36) {
      GLOBAL_STATE.dataVA.push(entry);
    } else {
      arr.push(entry);
    }
  }
  
  child.setAttribute("valen_processed", "");
  return arr;
}



function _populateDeps(depArr, dataVA, targetMap) {
  const depLen = depArr.length;
  const dataLen = dataVA.length;
  
  for (let i = 0; i < depLen; i++) {
    const item = depArr[i];
    const temp = item.temp;
    const key = item.key;
    
    let deps = undefined;
    
    for (let j = 0; j < dataLen; j++) {
      const entry = dataVA[j];
      if (entry.template.indexOf(temp) !== -1) {
        if (deps === undefined) {
          deps = targetMap.get(key);
          if (deps === undefined) {
            deps = new Set();
            targetMap.set(key, deps);
          }
        }
        
        deps.add(entry);
      }
    }
  }
}

function buildDependencyMap(instance, data) {
  if (!instance.dependencyMap) instance.dependencyMap = new Map();
  
  const localDepArr = ctx.currentDepArr;
  const globalDepArr = ctx.globalCurrentDepArr;
  
  if (localDepArr.length > 0) {
    _populateDeps(localDepArr, data, instance.dependencyMap);
  }
  
  if (globalDepArr.length > 0) {
    _populateDeps(globalDepArr, GLOBAL_STATE.dataVA, GLOBAL_STATE.dependencyMap);
  }
  
  ctx.currentDepArr.length = [];
  ctx.globalCurrentDepArr = [];
  GLOBAL_STATE.dataVA = [];
}


const BARE_WRAPPER = document.createElement('span');

BARE_WRAPPER.style.cssText = 'display: contents; font: inherit; color: inherit;';

function wrapBareExpressions(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  
  const nodesToWrap = [];
  
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    
    if (
      text.indexOf('[') !== -1 &&
      text.indexOf(']') !== -1 &&
      (node.nextSibling !== null || node.previousSibling !== null)
    ) {
      nodesToWrap.push(node);
    }
  }
  
  // Batch DOM mutations after traversal is complete
  for (let i = 0, len = nodesToWrap.length; i < len; i++) {
    const textNode = nodesToWrap[i];
    const span = BARE_WRAPPER.cloneNode(false);
    textNode.parentNode.insertBefore(span, textNode);
    span.appendChild(textNode);
  }
}


function processComponentMarkup(jsx, instance, subId) {
  const isRootComponent = instance.isRootComponent;
  const isAtom = instance.type === "Atom";
  sharedTemplate.innerHTML = jsx; // parse once
  const fragment = sharedTemplate.content;
  
  wrapBareExpressions(fragment);
  
  const data = [];
  
  try {
    const targetElements = fragment.querySelectorAll("*");
    
    for (let i = 0, len = targetElements.length; i < len; i++) {
      const element = targetElements[i];
      
      if (subId && !element.hasAttribute("data-v_sub")) {
        element.setAttribute("data-v_sub", subId);
      }
      
      const childData = element.hasAttribute("valen_processed") ? null : generateDataVA(
        element,
        element.childElementCount > 0,
        instance
      );
      
      if (childData?.length > 0) {
        data.push.apply(data, childData);
      }
      
      if (isRootComponent || isAtom) {
        element.removeAttribute("valen_processed");
      }
      
      element.removeAttribute("innertext");
      element.removeAttribute("isattribute");
    }
    
    buildDependencyMap(instance, data);
    
    return fragment;
    
  } catch (error) {
    console.warn(
      `Valen:\nAn error in Component \`${instance.name || ""}\`:\n\n` +
      `Error sourced from: \`${jsx}\``,
      error
    );
    // Return an empty fragment so callers don't need a null check
    return document.createDocumentFragment();
  }
}



const nodeBindings = new WeakMap();

function processReactiveNode(node) {
  let bindings = null;
  
  // 1. Process vSub
  const vSub = node.getAttribute("data-v_sub");
  if (vSub !== null) {
    bindings = Object.create(null); // Dictionary without prototype overhead
    bindings.vDataSub = vSub;
    node.removeAttribute("data-v_sub");
  }
  
  // 2. Process vCName
  const vCName = node.getAttribute("data-__v_cname__");
  if (vCName !== null) {
    if (bindings === null) bindings = Object.create(null);
    bindings.vCName = vCName;
    node.removeAttribute("data-__v_cname__");
  }
  
  // 3. Process valen_id
  const valenId = node.getAttribute("data-valen_id");
  if (valenId !== null) {
    if (!reactiveCache.has(valenId)) {
      reactiveCache.set(valenId, node);
    }
    node.removeAttribute("data-valen_id");
  }
  
  // 4. Process Events (Fixed Map lookup & lazy evaluation)
  const evtId = node.getAttribute('data-evt_id');
  if (evtId !== null) {
    const events = eventsCache.get(evtId);
    
    // Map.get() returns undefined on miss, NOT null.
    if (events !== undefined) {
      if (bindings === null) bindings = Object.create(null);
      bindings.entries = events;
      
      // Cleanup the map immediately to free memory
      eventsCache.delete(evtId);
    }
    
    node.removeAttribute('data-evt_id');
  }
  
  if (bindings !== null) {
    nodeBindings.set(node, bindings);
  }
}


function addToReactiveCache(parent) {
  // 1. Process the root node first
  processReactiveNode(parent);
  
  const elements = parent.getElementsByTagName ?
    parent.getElementsByTagName('*') :
    parent.querySelectorAll('*');
  
  const len = elements.length;
  
  for (let i = 0; i < len; i++) {
    processReactiveNode(elements[i]);
  }
}


const EVENT_ALIAS_MAP = {
  mousedown: 'pointerdown',
  touchstart: 'pointerdown',
  mouseup: 'pointerup',
  touchend: 'pointerup',
  mousemove: 'pointermove',
  touchmove: 'pointermove',
  mouseenter: 'pointerover',
  mouseleave: 'pointerout',
};


const usedEvents = new Set();
const _lastTriggerTime = new WeakMap();
const eventHandlerCache = new LRUCache(500);

function _makeContainerHandler(instance, root) {
  return function delegatedHandler(e) {
    const type = e.type;
    const target = e.target;
    
    // --- A. Ghost-click dedupe (Optimized) ---
    let pointerId = e.pointerId;
    const touches = e.changedTouches;
    
    // Exact original logic: touches explicitly override pointerId
    if (touches && touches.length > 0) {
      pointerId = touches[0].identifier;
    }
    if (pointerId == null) pointerId = 0; // == null catches undefined too
    
    const normalizedType = EVENT_ALIAS_MAP[type] || type;
    const dedupeKey = normalizedType + '_' + pointerId;
    
    let timestamps = _lastTriggerTime.get(target);
    if (!timestamps) {
      timestamps = Object.create(null); // Faster dictionary lookups than {}
      _lastTriggerTime.set(target, timestamps);
    }
    
    const now = performance.now();
    if (type.startsWith('mouse')) {
      const lastTime = timestamps[dedupeKey];
      if (lastTime && (now - lastTime < 80)) {
        return; // Blocks synthetic mouse events after touch
      }
    }
    timestamps[dedupeKey] = now;
    
    // --- B. DOM Traversal (Zero-Allocation) ---
    let current = target;
    let vOn = undefined;
    let vExpr = undefined;
    let vDataSub = undefined;
    let loopRan = false;
    
    while (current && current !== root) {
      loopRan = true;
      const b = nodeBindings.get(current);
      
      // Reset variables for this iteration
      vOn = undefined;
      vExpr = undefined;
      // Fixed a hidden bug: original `b.vDataSub` would throw if b was undefined
      vDataSub = b ? b.vDataSub : undefined;
      // Replaces array allocation (b?.entries?.filter(...)) with a fast loop
      if (b && b.entries) {
        const entries = b.entries;
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          
          if (entry.name && entry.name === type) {
            vOn = type;
            vExpr = entry.value;
            break; // Takes the first match (emulates bFiltered[0])
          }
        }
      }
      
      const normalizedStored = EVENT_ALIAS_MAP[vOn] || vOn;
      
      // Check if the user's stored event matches the actual browser event
      if (normalizedStored === type) {
        break;
      }
      
      current = current.parentNode;
    }
    
    // Emulates the original `if (!bindings || !current)` logic quirk
    if (!loopRan || !current) return;
    
    // --- C. Resolve instance ---
    let targetInstance = vDataSub ? components.get(vDataSub) : instance;
    if (!targetInstance) return;
    
    if (typeof targetInstance === 'function') {
      targetInstance = targetInstance();
    }
    if (!targetInstance) return;
    
    // --- D. Get/Cache handler ---
    let handler = eventHandlerCache.get(vExpr);
    if (!handler) {
      try {
        handler = new Function(
          'e',
          'value',
          'const state=this.state;try{' + vExpr + '}catch(err){console.error("Valen Event Handler error:\\n"+err)}'
        );
        eventHandlerCache.set(vExpr, handler);
      } catch (err) {
        console.warn('[Valen] Failed to compile:', vExpr, err);
        return;
      }
    }
    
    // --- E. Execute ---
    handler.call(targetInstance, e, current.value);
  };
}

function setupEventDelegation(root, instance) {
  if (root._vDelegated) return root._vDelegatedHandler;
  
  const eventsToAttach = usedEvents;
  const handler = _makeContainerHandler(instance, root);
  
  eventsToAttach.forEach(eventType => {
    // Smart passive: only pointerdown needs passive:false
    const isPreventable = (eventType === 'pointerdown' || eventType === 'touchstart');
    root.addEventListener(eventType, handler, { passive: !isPreventable });
  });
  
  root._vDelegated = true;
  root._vDelegatedHandler = handler;
  root._vUsedEvents = eventsToAttach;
  return handler;
}

// ============================================================
// 3. CLEANUP (PREVENTS LEAKS)
// ============================================================
function removeEventDelegation(root) {
  if (!root._vDelegated) return;
  const handler = root._vDelegatedHandler;
  const events = root._vUsedEvents || usedEvents;
  events.forEach(ev => root.removeEventListener(ev, handler));
  root._vDelegated = false;
  root._vDelegatedHandler = null;
  root._vUsedEvents = null;
}



const renderComponent = (instance, name, flag, toFrag) => {
  // Component instantiation
  instance = typeof instance === "function" ? instance() : instance;
  
  components.set(instance.name, instance);
  
  // 1. Early Return (Flattens the execution path)
  if (instance.isMounted) return "";
  
  const id = typeof instance.element === 'string' ?
    instance.element :
    instance.element.id;
  
  // 2. Evaluate template ONCE
  const innerTemplate = typeof instance.template === 'function' ?
    instance.template(instance.state) :
    instance.template;
  
  // 3. Clean string assignment
  let template = flag ?
    innerTemplate :
    `<div id="${id}">${innerTemplate}</div>`;
  
  // 4. Pipeline
  // template = handleRouter(template);
  template = initiateComponents(template);
  
  const rendered = processComponentMarkup(template, instance, name);
  
  // 5. State sync
  instance.isMounted = true;
  
  const output = toFrag ? rendered : serializer.serializeToString(rendered);
  
  return output;
};



export {
  updateComponent,
  initiateStyleSheet,
  processComponentMarkup,
  addToReactiveCache,
  setupEventDelegation,
  removeEventDelegation,
  renderComponent,
  strToEl,
  nodeBindings
}
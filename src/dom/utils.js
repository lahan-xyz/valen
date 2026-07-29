import { ctx, stylesheet, LRUCache, sharedTemplate, stringBetween, reactiveCache, removeFromReactiveCache, GLOBAL_STATE, components, KNOWN_STYLE_PROPS } from '../internal.js'
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


const _styleKeyCache = new Map(); // "style.color" → "color"

// ─── update ──────────────────────────────────────────────────────────────────

function update(child, key, evaluated, isAttribute) {
  
  // ── v:exist ────────────────────────────────────────────────────────────
  if (key === 'v:exist') {
    if (evaluated === false || evaluated === 'false') {
      const descendants = child.getElementsByTagName('*');
      const count = descendants.length; // single read on live HTMLCollection
      const nodesToClean = new Array(count + 1);
      nodesToClean[0] = child;
      for (let i = 0; i < count; i++) {
        nodesToClean[i + 1] = descendants[i];
      }
      removeEvents(nodesToClean, true);
    }
    return;
  }
  
  // ── disabled ───────────────────────────────────────────────────────────
  if (key === 'disabled') {
    const isDisabled = evaluated !== false && evaluated !== 'false';
    if (child.disabled !== isDisabled) {
      child.disabled = isDisabled;
    }
    return;
  }
  
  // ── style.* ────────────────────────────────────────────────────────────
  if (key[0] === 's' && key.startsWith('style.')) {
    let prop = _styleKeyCache.get(key);
    if (prop === undefined) {
      prop = key.slice(6);
      _styleKeyCache.set(key, prop);
    }
    const style = child.style; // cache CSSStyleDeclaration getter
    if (style[prop] !== evaluated) {
      style[prop] = evaluated;
    }
    return;
  }
  
  if (isAttribute && child.getAttribute(key) != evaluated) {
    
    if (evaluated != "false" && evaluated != "") {
      child.setAttribute(key, evaluated);
    } else {
      child.removeAttribute(key);
    }
    
    return;
  }
  
  if (key in child) {
    if (child[key] != evaluated) { // loose != : intentional ("5" == 5)
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
    stylesheet.el.type = "text/css";
    document.head.appendChild(stylesheet.el);
    stylesheet.isAppended = true;
  }
  stylesheet.el.appendChild(document.createTextNode(styles + "\n"));
  instance.stylesheet = null;
}


function getAttributes(el) {
  return Array.from(el.attributes).map(({ nodeName, nodeValue }) => ({ attribute: nodeName, value: nodeValue }));
}


const qOnceMap = {
  text: "textContent",
  html: "innerHTML",
  class: "className"
}

function convertDirective(attr, value, child) {
  if (!attr.startsWith('v:')) return [attr, value, false];
  
  child.removeAttribute(attr);
  
  if (attr.startsWith('v:once:')) {
    let realAttr = attr.slice(7);
    return [qOnceMap[realAttr] || realAttr, value, true];
  }
  
  switch (attr) {
    case 'v:show': {
      if (value.includes('[') && value.includes(']')) {
        const expr = b(value, true).trim();
        const fExpr = expr ? `[${expr} ? 'block' : 'none']` : "none";
        return ['display', fExpr, false];
      }
      return ['display', (value === 'true' || value === true || value.length) ? 'block' : 'none', false];
    }
    case 'v:text':
      child.textContent = value;
      return ['textContent', value, false];
      
    case 'v:html':
      return ['innerHTML', value, false];
      
    case 'v:value':
      return ['value', value, false];
      
    default:
      if (attr === 'v:once') {
        console.warn(`Valen: 'v:once' must be followed by ':attribute' (e.g., v:once:id="...").`);
      } else {
        console.warn(`Valen: unknown directive '${attr}'\n'${child.outerHTML}'`);
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


// ─── V8 hidden-class shape template ─────────────────────────────────────────
// Allocate once so every entry object shares the same hidden class (map).
// V8 will transition all objects created with this exact key order into
// the same map, avoiding megamorphic property lookups in the update loop.
function createEntry(template, key, valen_id, once, isAttribute) {
  return { template, key, valen_id, once, isAttribute };
}


// ─── Hot path ────────────────────────────────────────────────────────────────

function generateDataVA(child, isParent, instance) {
  const isSVG = child instanceof SVGElement;
  const attributes = getAttributes(child);
  
  // Hoist instance properties once to avoid repeated lookups
  const name = instance.name;
  const useStrict = instance.useStrict;
  const isRootComponent = instance.isRootComponent;
  const isComponent = instance.type === 'Component';
  
  const hasSyn = child.hasAttribute("v:syn");
  
  // ── 1. Inject implicit content directive (only for non-parent nodes) ──
  if (!isParent && !hasSyn) {
    let hasContent = false;
    for (let i = 0, len = attributes.length; i < len; i++) {
      if (CONTENT_DIRECTIVES.has(attributes[i].attribute)) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      const key = useStrict ? 'textContent' : 'innerHTML';
      attributes.push({ attribute: key, value: child[key] });
    }
  }
  
  // OPTIMIZATION: Hoist component ID tagging completely out of the attribute loop.
  // This avoids checking `attribute === 'id'` on every single iteration.
  if (isComponent && child.hasAttribute('id')) {
    child.setAttribute('data-__v_cname__', name);
  }
  
  // ── 2. Main attribute loop ──
  const arr = [];
  const childStyle = child.style; // cache the CSSStyleDeclaration
  let VAID = null;
  let vaChecked = false;
  
  for (let i = 0, len = attributes.length; i < len; i++) {
    const attr = attributes[i];
    let attribute = attr.attribute;
    let value = attr.value ?? ''; // ?? preserves 0 / false
    
    if (hasSyn && attribute === "v:syn") {
      if (isRootComponent) child.removeAttribute("v:syn");
      continue;
    }
    
    // class → className (skip for SVG where "class" is the correct attr)
    if (attribute === 'class' && !isSVG) attribute = 'className';
    
    // ── Fast prefix dispatch via char codes ──
    const c0 = attribute.charCodeAt(0);
    
    // "on…" → illegal event syntax
    if (c0 === 111 /* o */ && attribute.charCodeAt(1) === 110 /* n */ ) {
      // SAFETY FIX: Avoid child.outerHTML which triggers massive DOM serialization 
      // and can cause severe GC spikes/frame drops when an error is thrown.
      throw new Error(
        `Valen:\nEvent names must start with '@'.\nRefer to element: <${child.tagName.toLowerCase()}>.`
      );
    }
    
    // "@…" → event binding
    if (c0 === 64 /* @ */ ) {
      if (value) {
        child.setAttribute('data-v-on', attribute.slice(1));
        child.setAttribute('data-v-exp', value.trim());
      }
      child.removeAttribute(attribute);
      continue;
    }
    
    // ── Directive conversion ──
    // OPTIMIZATION: Avoid array destructuring overhead in hot path. 
    // Direct index access is measurably faster than the iterator protocol.
    const conv = convertDirective(attribute, value, child);
    attribute = conv[0];
    value = conv[1];
    const once = conv[2];
    
    // ── Template detection (single scan) ──
    const hasTemplate = value.includes('[') && value.includes(']');
    
    // ── Resolve the mapped property name once ──
    const prop = ATTR_TO_PROP[attribute] ?? attribute;
    
    // ── Style vs attribute/property ──
    const style = KNOWN_STYLE_PROPS.get(prop);
    
    const finalValue = hasTemplate ? evaluateTemplate(value, instance) : value;
    
    // Moved inside loop to avoid manual resetting
    let isAttribute = false;
    
    if (style) {
      childStyle[style] = finalValue;
      child.removeAttribute(attribute);
    } else if (isSVG) {
      child.setAttribute(prop, finalValue);
    } else if (child.hasAttribute(prop)) {
      isAttribute = true;
      // OPTIMIZATION: Use strict inequality (!==) to avoid type coercion overhead
      if (finalValue !== "false") {
        child.setAttribute(prop, finalValue);
      } else {
        child.removeAttribute(prop);
      }
    } else {
      child[prop] = finalValue;
    }
    
    if (!hasTemplate) continue;
    
    // ── Lazy VAID: only touch the DOM when a template actually exists ──
    if (!vaChecked) {
      VAID = child.getAttribute('data-valen_id');
      vaChecked = true;
    }
    if (!VAID) {
      // OPTIMIZATION: String concatenation is marginally faster than template literals
      VAID = 'va' + ctx.counterVA++;
      child.setAttribute('data-valen_id', VAID);
    }
    
    // ── Build entry (shared hidden class via createEntry) ──
    const expression = b(value).trim();
    const entry = createEntry(
      value,
      style ? 'style.' + attribute : attribute, // String concatenation
      VAID,
      once,
      isAttribute
    );
    
    // 36 = '$' → global state
    if (expression.charCodeAt(0) === 36) {
      GLOBAL_STATE.dataVA.push(entry);
    } else {
      arr.push(entry);
    }
  }
  return arr;
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
  
  if (ctx.currentDepArr.length) build(true, ctx.currentDepArr);
  if (ctx.globalCurrentDepArr.length) build(false, ctx.globalCurrentDepArr);
  
  ctx.currentDepArr = [];
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
      
      const childData = generateDataVA(
        element,
        element.childElementCount > 0,
        instance
      );
      
      if (childData.length > 0) {
        data.push.apply(data, childData);
      }
      
      element.removeAttribute("innertext");
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
  
  const getBindings = () => {
    if (!bindings) {
      bindings = {};
      nodeBindings.set(node, bindings);
    }
    return bindings;
  };
  
  // 1. Process vSub
  const vSub = node.getAttribute("data-v_sub");
  if (vSub) {
    getBindings().vDataSub = vSub;
    node.removeAttribute("data-v_sub");
  }
  
  // 2. Process Reactive ID
  const valen_id = node.getAttribute('data-valen_id');
  if (valen_id && !reactiveCache.has(valen_id)) {
    reactiveCache.set(valen_id, node);
    node.removeAttribute('data-valen_id');
  }
  
  // 3. Process Event Listeners
  const vExp = node.getAttribute("data-v-exp");
  if (vExp) {
    const b = getBindings();
    b.vOn = node.getAttribute("data-v-on");
    b.vExpr = vExp;
    node.removeAttribute('data-v-on');
    node.removeAttribute('data-v-exp');
  }
  
  const vCName = node.getAttribute("data-__v_cname__");
  if (vCName) {
    getBindings().vCName = vCName;
    node.removeAttribute("data-__v_cname__");
  }
}

function addToReactiveCache(parent) {
  // Process the root node first
  processReactiveNode(parent);
  
  const walker = document.createTreeWalker(
    parent,
    NodeFilter.SHOW_ELEMENT
  );
  
  let node;
  while ((node = walker.nextNode())) {
    processReactiveNode(node);
  }
}


const DELEGATED_EVENTS = new Set(['click', 'input', 'submit', 'change', 'keydown']);

const eventHandlerCache = new LRUCache(500);

function _makeContainerHandler(instance) {
  return function delegatedHandler(e) {
    const target = e.target;
    const bindings = nodeBindings.get(target)
    if (bindings?.vOn !== e.type) return;
    
    const expression = bindings.vExpr;
    
    const subId = bindings.vDataSub;
    
    let targetInstance = subId ? components.get(subId) : instance;
    
    if (!targetInstance) return;
    
    if (typeof targetInstance === 'function') {
      targetInstance = targetInstance();
    }
    
    let handler = eventHandlerCache.get(expression);
    if (!handler) {
      try {
        handler = new Function('e', 'value', `const state = this.state;${expression}`);
        eventHandlerCache.set(expression, handler);
      } catch (err) {
        console.warn(`Valen: Failed to execute event handler:\n${expression}\n${err}`);
        return;
      }
    }
    
    handler.call(targetInstance, e, target.value); // .call avoids bind() allocation
  };
}

function setupEventDelegation(root, instance) {
  if (root._vDelegated) return;
  root._vDelegated = true;
  
  const handler = _makeContainerHandler(instance);
  DELEGATED_EVENTS.forEach(eventType => {
    root.addEventListener(eventType, handler);
  });
  
  return handler;
}

function removeEventDelegation(root, handler) {
  DELEGATED_EVENTS.forEach(eventType => {
    root.removeEventListener(eventType, handler);
  });
  
  removeFromReactiveCache(root.querySelectorAll("*"));
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
import { ctx, stylesheet, LRUCache, sharedTemplate, stringBetween, reactiveCache, removeFromReactiveCache, GLOBAL_STATE, components } from '../internal.js'
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

function update(child, key, evaluated) {
  switch (key) {
    case 'v:exist':
      if (evaluated === "false" || evaluated === false) {
        const descendants = child.getElementsByTagName('*');
        const nodesToClean = new Array(descendants.length + 1);
        nodesToClean[0] = child;
        for (let i = 0, len = descendants.length; i < len; i++) {
          nodesToClean[i + 1] = descendants[i];
        }
        removeEvents(nodesToClean, true);
      }
      break;
      
    case 'disabled': {
      const isDisabled = evaluated !== "false" && evaluated !== false;
      if (child.disabled !== isDisabled) {
        child.disabled = isDisabled;
      }
      break;
    }
    
    default:
      // Ultra-fast string check: 115 is the charCode for 's'
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
  if (!ctx.microtaskPending) {
    ctx.microtaskPending = true;
    queueMicrotask(flushUpdates);
  }
}


let updateMap = new Map();

function batchedUpdate(child, key, evaluated) {
  let entry = updateMap.get(child);
  if (!entry) {
    entry = {};
    updateMap.set(child, entry);
  }
  entry[key] = evaluated;
  scheduleFlush();
}

function flushUpdates() {
  const batch = updateMap;
  updateMap = new Map();
  ctx.microtaskPending = false;
  
  for (const [child, mutations] of batch) {
    if (child?.isConnected) {
      for (const key in mutations) {
        update(child, key, mutations[key]);
      }
    }
  }
}


function updateComponent(changedKey, instance) {
  const dependencyMap = !instance ? GLOBAL_STATE.dependencyMap : instance.dependencyMap;
  const subscribers = dependencyMap.get(changedKey);

  if (!subscribers) return;
  
  for (const subscriber of subscribers) {
    const { template, key: targetProp, valen_id: elementId, once } = subscriber;
    const node = selectElement(elementId);
    if (node && node.isConnected) {
      const evaluated = evaluateTemplate(template, instance);
      batchedUpdate(node, targetProp, evaluated);
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


const ATTR_TO_PROP = {
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  accesskey: 'accessKey',
  colspan: 'colSpan',
  rowspan: 'rowSpan'
};

const CONTENT_DIRECTIVES = new Set(['v:text', 'v:html', 'v:once:text', 'v:once:html']);


const KNOWN_STYLE_PROPS = new Set([
  'color', 'background', 'background-color', 'border', 'border-color', 'border-width',
  'border-radius', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'display', 'visibility', 'opacity', 'overflow', 'overflow-x', 'overflow-y',
  'position', 'top', 'left', 'right', 'bottom', 'z-index',
  'flex-direction', 'flex-wrap', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-self', 'align-content', 'gap', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'font-size', 'font-weight', 'font-family', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration', 'text-transform', 'white-space', 'word-break',
  'transform', 'transition', 'animation', 'cursor', 'pointer-events',
  'box-shadow', 'outline', 'float', 'clear', 'list-style', 'content',
  'object-fit', 'object-position', 'resize', 'user-select', 'appearance',
]);


function generateDataVA(child, isParent, instance) {
  const arr = [];
  const attributes = getAttributes(child);
  let VAID = child.getAttribute("data-valen_id");
  const { name, type, useStrict } = instance;
  
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
    
    if(attribute === 'class') attribute = 'className';
    
    if (type === 'Component' && attribute === 'id') {
      child.setAttribute("data-__v_cname__", name);
    }
    
    let once = false;
    const isOnType = attribute.startsWith("on");
    
    if (isOnType) {
      throw Error(`Valen\n:Event names must start with '@'.\nRefer to '${child.outerHTML}'.`)
    }
    
    const isEvent = attribute.startsWith("@");
    
    if (isEvent) {
      if (child.getAttribute(attribute)) {
        child.setAttribute("data-v-on", attribute.slice(1))
        child.setAttribute("data-v-exp", value.trim());
        child.removeAttribute(attribute);
        continue;
      } else {
        child.removeAttribute(attribute);
        continue;
      }
    }
    
    [attribute, value, once] = convertDirective(attribute, value, child);
    
    const hasTemplate = value.indexOf('[') !== -1 && value.indexOf(']') !== -1;
    
    const isStyle = attribute !== 'src' && KNOWN_STYLE_PROPS.has(attribute) || attribute !== 'src' && (attribute in childStyle);
    
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
      VAID = `va${ctx.counterVA++}`;
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
    if (bindings.vOn !== e.type) return;
    
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
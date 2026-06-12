import { ctx, stylesheet, LRUCache, sharedTemplate, stringBetween, reactiveCache, GLOBAL_STATE, updateQueue, components } from '../internal.js'
import { initiateComponents,evaluateTemplate } from '../parser/utils.js';

  
const b = (str, last) => stringBetween(str, "[", "]", last);

const strToEl = (component) => {
  const id = component.element;
  if (typeof id === "string") {
    component.element = document.getElementById(id);
  }
}

function stringToDocumentFragment(htmlString = "") {
  sharedTemplate.innerHTML = htmlString;
  
  // Return the content directly. 
  // Appending it later will move the nodes, saving ~130ms of memory cloning!
  return sharedTemplate.content;
}

// O(1) element lookup
const selectElement = valen_id => {
  return reactiveCache.get(valen_id);
};

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
  if (!ctx.microtaskPending) {
    ctx.microtaskPending = true;
    queueMicrotask(flushUpdates);
  }
}

// A Map where Key = DOM Node, Value = Object of properties to update
const updateMap = new Map();

function batchedUpdate(child, key, evaluated) {
  if (!updateMap.has(child)) {
    updateMap.set(child, {});
  }
  
  // This overwrites previous identical keys, instantly deduping!
  updateMap.get(child)[key] = evaluated;
  
  scheduleFlush();
}

function flushUpdates() {
  const batch = new Map(updateMap);
  updateMap.clear();
  ctx.microtaskPending = false;
  
  for (const [child, mutations] of batch.entries()) {
    if (child?.isConnected) {
      // Apply all accumulated mutations for this specific node
      for (const key in mutations) {
        update(child, key, mutations[key]);
      }
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


// Gets the attributes of a DOM element.
function getAttributes(el) {
  return Array.from(el.attributes).map(({ nodeName, nodeValue }) => ({ attribute: nodeName, value: nodeValue }));
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
    const isEvent = attribute.startsWith("@");
    
    if (isEvent) {
      if(child.getAttribute(attribute)) {
        child.setAttribute('data-v-on', attribute.slice(1));
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
  ctx.globurrentDepArr = [];
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
    console.warn(`Valen:\nAn error in Component \`${instance.name || ""}\`:\n\nError sourced from: \`${jsx}\``, error);
    return "";
  }
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
 // template = handleRouter(template);
  template = initiateComponents(template);
  initiateStyleSheet(`#${id}`, instance);
  
  const rendered = processComponentMarkup(template, instance, name);
  
  // 5. State sync
  instance.isMounted = true;
  
  return rendered;
}; 


export { updateComponent, initiateStyleSheet, processComponentMarkup, addToReactiveCache, setupEventDelegation, renderComponent, strToEl, stringToDocumentFragment }
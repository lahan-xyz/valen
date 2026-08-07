import {
  initiateStyleSheet,
  processComponentMarkup,
  addToReactiveCache,
  nodeBindings
} from '../dom/utils.js';
import { components, removeFromReactiveCache } from '../internal.js';
import { createSignal } from '../reactivity/signal.js';
import {
  initiateComponents,
  initiateWidgets,
  initiateExtendedWidgets,
  lintPlaceholders
} from '../parser/utils.js';

// Extracted to module level to prevent per-item string allocation and CSSOM parsing overhead
const WRAPPER_STYLE = 'all:initial!important;display:block!important;color:inherit!important;font:inherit!important;';

// Helper to render a single item into a DocumentFragment
function renderItem(isTemplateFunc, itemData, index, template, isReactive, instance, name) {
  const itemHTML = isTemplateFunc ? template(itemData, index) : template;
  
  instance.executingIndex = index;
  
  const processedHTML = isReactive ?
    initiateComponents(itemHTML, false, true) :
    lintPlaceholders(initiateExtendedWidgets(initiateWidgets(itemHTML)), true);
  
  return processComponentMarkup(processedHTML, instance, name);
}

function _set(index, value) {
  if (this.isDestroyed) return;
 
  if (typeof index === 'number') {
    if (value && typeof value === 'object') {
      this.executingIndex = index;
      this.state[index] = value;
    }
  } else if (Array.isArray(index)) {
    for (let i = 0, len = index.length; i < len; i++) {
      this.executingIndex = i;
      this.state[i] = index[i];
    }
  } else {
    console.warn(`Valen:\nFirst Argument passed to '${name}.set()' must be a number or an array.`);
  }
}

export default function Atom(activatorFunc) {
  const options = activatorFunc();
  const { id, template, isReactive, stylesheet, created, onCleanup } = options;
  const name = activatorFunc.name;
  
  // ─── Mutable closure variables ────────────────────────────────────
  let element = id; // initially string, later the resolved DOM node
  let state = [];
  let entry = new Map();
  let pendingRafId; // undefined by default, cancels render batches
  let isDestroyed = false;
  
  // ─── Set function ──────────────────────────────────────────────────
  const setFunc = isReactive ? _set : () => {
    console.warn(`Cannot call set on Atom '${name}'. Make sure 'isReactive' is true.`);
  };
  
  // ─── Instance object ──────────────────────────────────────────────
  const instance = {
    dependencyMap: isReactive ? new Map() : undefined,
    stylesheet,
    isMounted: false,
    created,
    onCleanup,
    reserved: [],
    executingIndex: 0,
    
    _getElement() {
      if (isDestroyed) return null;
      if (typeof element === 'string') {
        const resolved = document.getElementById(element);
        if (!resolved) {
          throw new Error(`Valen:\nMount node of '${name}' is invalid or not provided`);
        }
        element = resolved; // cache the DOM node
      }
      
      const bindings = nodeBindings.get(element);
      const cName = bindings?.vCName;
      if (cName) {
        let component = components.get(cName);
        
        if(typeof component === 'function') {
          component = component();
          components.set(cName, component);
        }
        
        component?.atomDeps.add(name);
      }
      return element;
    },
    
    clearElement() {
      element = id;
    },
    
    destroy() {
      if (isDestroyed) return;
      isDestroyed = true; // Set immediately to prevent re-entrancy
      
      if (pendingRafId) {
        cancelAnimationFrame(pendingRafId);
        pendingRafId = undefined;
      }
      
      components.delete(name);
      
      // SAFETY FIX: Ensure it's an actual DOM Element before calling DOM methods
      const el = typeof element === 'string' ? document.getElementById(element) : element;
      if (el instanceof Element) {
        removeFromReactiveCache(el.getElementsByTagName("*"));
        el.replaceChildren();
        el.remove();
      }
      
      if (isReactive && instance.dependencyMap) {
        instance.dependencyMap.clear();
        instance.dependencyMap = undefined;
      }
      
      entry.clear();
      
      // Optimized property cleanup: standard for-loop is faster than .forEach()
      // Explicitly skip 'name' and 'isDestroyed' so they naturally remain intact
      const keys = Object.getOwnPropertyNames(instance);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key !== 'name' && key !== 'isDestroyed') {
          delete instance[key];
        }
      }
      
      // Nullify closure-bound references to guarantee garbage collection
      entry = undefined;
      state = undefined;
      element = undefined;
      // setFunc is a const, but we can nullify the internal reference if needed, 
      // though the closure itself will be GC'd when instance is GC'd.
    },
    
    reAttach(obj, index) {
      if (isDestroyed) return;
      const container = entry.get(index);
      
      if (container) {
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          state[index] = obj;
          const isTemplateFunc = typeof template === 'function';
          const frag = renderItem(
            isTemplateFunc,
            state[index],
            index,
            template,
            isReactive,
            instance,
            name
          );
          container.appendChild(frag);
          addToReactiveCache(container);
        }
      } else if (!instance.isMounted) {
        instance.renderWith(obj ?? instance.reserved);
        instance.reserved.length = 0; // Fast array clear
      }
    },
    
    renderWith(data, position = 'append') {
      if (isDestroyed) {
        console.warn(`Valen: Atom '${name}' is destroyed – ignoring.`);
        return Promise.resolve();
      }
      
      if (!data || typeof data !== 'object') {
        throw new Error(`Valen:\nFirst argument of '${name}.renderWith()' must be an object or array.`);
      }
      
      const el = this._getElement();
      if (!el) return Promise.resolve();
      
      const dataArray = Array.isArray(data) ? data : [data];
      if (dataArray.length === 0) return Promise.resolve();
      
      const oldLen = state.length;
      const totalLen = oldLen + dataArray.length;
      
      // Update state (append for reactive, replace for non‑reactive)
      state = isReactive ? createSignal([...state, ...dataArray], instance) : dataArray;
      
      // Faster than optional chaining for one-time lifecycle hooks
      if (typeof instance.created === 'function') {
        instance.created(state);
        instance.created = undefined;
      }
      
      return new Promise((resolve, reject) => {
        const isTemplateFunc = typeof template === 'function';
        const masterFragment = document.createDocumentFragment();
        const BATCH_SIZE = 30;
        let currentIndex = oldLen;
        
        const processBatch = () => {
          if (isDestroyed) {
            resolve();
            return;
          }
          
          const end = Math.min(currentIndex + BATCH_SIZE, totalLen);
          
          for (let i = currentIndex; i < end; i++) {
            const itemData = state[i];
            const frag = renderItem(
              isTemplateFunc,
              itemData,
              i,
              template,
              isReactive,
              instance,
              name
            );
            
            const wrapper = document.createElement('div');
            // Use pre-allocated constant to avoid per-item string allocation/parsing
            wrapper.style.cssText = WRAPPER_STYLE;
            wrapper.appendChild(frag);
            masterFragment.appendChild(wrapper);
            entry.set(i, wrapper);
          }
          
          currentIndex = end;
          
          if (currentIndex < totalLen) {
            pendingRafId = requestAnimationFrame(processBatch);
          } else {
            pendingRafId = undefined;
            try {
              if (position === 'append') {
                el.appendChild(masterFragment);
              } else {
                el.prepend(masterFragment);
              }
              addToReactiveCache(el);
              instance.isMounted = true;
              resolve();
            } catch (err) {
              console.error('Valen render error:', err);
              reject(err);
            }
          }
        };
        
        pendingRafId = requestAnimationFrame(processBatch);
      });
    },
    
    set: setFunc
  };
  
  // ─── Define properties (optimized for V8 hidden-class) ────────────
  Object.defineProperties(instance, {
    element: { get: () => element, configurable: true },
    name: { value: name, writable: false, configurable: true },
    state: {
      get: () => state,
      set: (newState) => {
        if (isDestroyed) return;
        if (newState && typeof newState === 'object') {
          Object.assign(state, newState);
        }
        return true;
      },
      configurable: true
    },
    template: { value: template, writable: false, configurable: true },
    useStrict: { value: true, writable: false, configurable: true },
    entry: { get: () => entry, configurable: true },
    isReactive: { value: isReactive, writable: false, configurable: true },
    type: { value: 'Atom', writable: false, configurable: true },
    isDestroyed: {
      get: () => isDestroyed,
      configurable: true
    }
  });
  
  // ─── Initialise stylesheet and register ───────────────────────────
  initiateStyleSheet(`#${id}`, instance);
  components.set(name, instance);
  
  return instance;
}
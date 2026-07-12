import {
  initiateStyleSheet,
  processComponentMarkup,
  addToReactiveCache,
  setupEventDelegation,
  removeEventDelegation,
  nodeBindings
} from '../dom/utils.js';
import { components } from '../internal.js';
import { createSignal } from '../reactivity/signal.js';
import {
  addIndexToTemplate,
  initiateComponents,
  initiateWidgets,
  initiateExtendedWidgets,
  lintPlaceholders
} from '../parser/utils.js';

// Helper to render a single item into a DocumentFragment
function renderItem(isTemplateFunc, itemData, index, template, isReactive, instance, name) {
  const itemHTML = isTemplateFunc ? template(itemData, index) : template;
  const indexedHTML = addIndexToTemplate(itemHTML, index);
  const processedHTML = isReactive ?
    initiateComponents(indexedHTML, false, true) :
    lintPlaceholders(initiateExtendedWidgets(initiateWidgets(indexedHTML)), true);
  return processComponentMarkup(processedHTML, instance, name);
}

function _set(index, value, shallow) {
  if (!this.isReactive) throw new Error(`Valen:\nCannot call 'set()' on Atom ${this.name}.`);
  if (this._isDestroyed || !this.isMounted) return;
  
  if (typeof index === 'number') {
    if (value && typeof value === 'object') {
      if (shallow) {
        Object.assign(this.state[index], value);
      } else {
        this.state[index] = value;
      }
    }
  } else if (Array.isArray(index)) {
    const state = this.state;
    for (let i = 0, len = index.length; i < len; i++) {
      state[i] = index[i];
    }
  } else {
    console.warn(`Valen:\nFirst Argument passed to '${this.name}.set()' must be a number or an array.`);
  }
}

export default function Atom(activatorFunc) {
  const options = activatorFunc();
  const { id, template, isReactive, stylesheet } = options;
  const name = activatorFunc.name;
  
  // ─── Mutable closure variables ────────────────────────────────────
  let element = id;
  let state = [];
  let entry = new Map(); // now a `let` so we can nullify it
  let delegationSetup = false;
  let pendingRafId = undefined; // for cancelling render batches
  let isDestroyed = false; // internal flag
  let eventHandler = undefined;
  
  // ─── Set function ──────────────────────────────────────────────────
  let setFunc = isReactive ? _set : () => {
    console.warn(`Cannot call set on Atom '${name}'. Make sure 'isReactive' is true.`);
  };
  
  // ─── Instance object ──────────────────────────────────────────────
  const instance = {
    dependencyMap: isReactive ? new Map() : undefined,
    stylesheet,
    isMounted: false,
    reserved: [],
    _getElement() {
      if (isDestroyed) return null;
      if (typeof element === 'string') {
        const resolved = document.getElementById(element);
        if (!resolved) {
          throw new Error(`Valen:\nMount node of '${name}' is invalid or not provided`);
        }
        element = resolved;
      }
     
     const bindings = nodeBindings.get(element);
      const cName = bindings.vCName;

      if(cName) {
        const component = components.get(cName);
        if(component) component.atomDeps.add(name);
      }
      return element;
    },
    
    clearElement(){
      element = id;
    },
    
    destroy() {
      if (isDestroyed) return;
      
      // 1. Cancel any pending render batch
      if (pendingRafId) {
        cancelAnimationFrame(pendingRafId);
        pendingRafId = null;
      }
      
      // 2. Remove Atom from global registry
      components.delete(name);
      
      // 3. Remove DOM element (if still attached)
      const el = this._getElement();
      
      if (el) {
        if (eventHandler) {
          removeEventDelegation(el, eventHandler);
          eventHandler = undefined;
          delegationSetup = undefined;
        }
        
        el.replaceChildren();
        el.remove();
      }
      
      // 5. Clear reactive dependencies
      if (isReactive && this.dependencyMap) {
        this.dependencyMap.clear();
        this.dependencyMap = undefined;
      }
      
      // 6. Clear and nullify closure‑bound collections
      entry.clear();
      entry = undefined; // break the closure reference
      state = undefined;
      element = undefined;
      delegationSetup = false;
      
      // 7. Break the `set` function reference
      setFunc = undefined;
      
      // 8. Delete all own enumerable properties (methods, getters, etc.)
      //    We keep only `name` and a `_isDestroyed` flag.
      const ownKeys = Reflect.ownKeys(this);
      for (const key of ownKeys) {
        delete this[key];
      }
      
      // 9. Mark as destroyed and set a flag on the instance itself
      isDestroyed = true;
    },
    
    reAttach(obj, index) {
      if (isDestroyed) return;
      const container = entry.get(index);
      if (container) {
        if (obj && !Array.isArray(obj)) {
          state[index] = obj;
          const isTemplateFunc = typeof template === 'function';
          const frag = renderItem(
            isTemplateFunc,
            state[index],
            index,
            template,
            isReactive,
            this,
            name
          );
          container.appendChild(frag);
          addToReactiveCache(container);
        }
      } else if (!this.isMounted) {
        this.renderWith(obj || this.reserved);
        this.reserved.length = 0;
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
      state = isReactive ? createSignal([...state, ...dataArray], this) : dataArray;
      
      return new Promise((resolve, reject) => {
        const isTemplateFunc = typeof template === 'function';
        const masterFragment = document.createDocumentFragment();
        const BATCH_SIZE = 30;
        let currentIndex = oldLen;
        
        const processBatch = () => {
          // If destroyed during batch, stop and resolve early
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
              this,
              name
            );
            
            const wrapper = document.createElement('div');
            wrapper.style.cssText =
              'all: initial !important; display: block !important; color: inherit !important; font: inherit !important;';
            wrapper.appendChild(frag);
            masterFragment.appendChild(wrapper);
            entry.set(i, wrapper);
          }
          
          currentIndex = end;
          
          if (currentIndex < totalLen) {
            pendingRafId = requestAnimationFrame(processBatch);
          } else {
            pendingRafId = null;
            try {
              if (position === 'append') {
                el.appendChild(masterFragment);
              } else {
                el.prepend(masterFragment);
              }
              addToReactiveCache(el);
              if (!delegationSetup) {
                eventHandler = setupEventDelegation(el, this);
                delegationSetup = true;
              }
              this.isMounted = true;
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
  
  // ─── Define properties (getters/setters) ──────────────────────────
  Object.defineProperties(instance, {
    element: { get: () => element, configurable: true },
    name: { get: () => name, configurable: true },
    state: {
      get: () => state,
      set: (newState) => {
        Object.assign(state, newState);
        return true;
      },
      configurable: true
    },
    template: { get: () => template, configurable: true },
    useStrict: { get: () => true, configurable: true },
    entry: { get: () => entry, configurable: true },
    isReactive: { get: () => isReactive, configurable: true },
    type: { get: () => 'Atom', configurable: true }
  });
  
  // ─── Init style and register ──────────────────────────────────────
  const styleResult = initiateStyleSheet(`#${id}`, instance);
  components.set(name, instance);
  
  return instance;
}
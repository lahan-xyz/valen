import {
  initiateStyleSheet,
  processComponentMarkup,
  addToReactiveCache,
  setupEventDelegation,
  removeEventDelegation,
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

// Helper to render a single item into a DocumentFragment
function renderItem(isTemplateFunc, itemData, index, template, isReactive, instance, name) {
  const itemHTML = isTemplateFunc ? template(itemData, index) : template;

  instance.currentExecIndex = index;

  const processedHTML = isReactive ?
    initiateComponents(itemHTML, false, true) :
    lintPlaceholders(initiateExtendedWidgets(initiateWidgets(itemHTML)), true);
  return processComponentMarkup(processedHTML, instance, name);
}

function _set(index, value, shallow) {
  if (!this.isReactive) throw new Error(`Valen:\nCannot call 'set()' on Atom ${this.name}.`);
  if (this._isDestroyed || !this.isMounted) return;
  
  if (typeof index === 'number') {
    if (value && typeof value === 'object') {
      this.currentExecIndex = index;
      if (shallow) {
        Object.assign(this.state[index], value);
      } else {
        this.state[index] = value;
      }
      
    }
  } else if (Array.isArray(index)) {
    const state = this.state;
    for (let i = 0, len = index.length; i < len; i++) {
      this.currentExecIndex = i;
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
  let element = id; // initially string, later the resolved DOM node
  let state = [];
  let entry = new Map();
  let delegationSetup = false;
  let pendingRafId; // undefined by default, cancels render batches
  let isDestroyed = false;
  let eventHandler;
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
    currentExecIndex: undefined,
    
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
        const component = components.get(cName);
        component?.atomDeps.add(name);
      }
      return element;
    },
    
    clearElement() {
      element = id;
    },
    
    destroy() {
      if (isDestroyed) return;
      
      // Cancel any pending render batch
      if (pendingRafId) {
        cancelAnimationFrame(pendingRafId);
        pendingRafId = null;
      }
      
      // Remove from global registry
      components.delete(name);
      
      // Remove DOM element and delegation
      const el = this._getElement();
      if (el) {
        if (eventHandler) {
          removeEventDelegation(el, eventHandler);
          eventHandler = undefined;
          delegationSetup = undefined;
        }
        removeFromReactiveCache(el.getElementsByTagName("*"));
        el.replaceChildren();
        el.remove();
      }
      
      // Clear reactive dependencies
      if (isReactive && this.dependencyMap) {
        this.dependencyMap.clear();
        this.dependencyMap = undefined;
      }
      
      // Nullify closure‑bound references
      entry.clear();
      entry = undefined;
      state = undefined;
      element = undefined;
      delegationSetup = false;
      setFunc = undefined;
      // ─────────────────────────────────────────────────────────────
      // GUARANTEE: after destroy ONLY 'name' and 'isDestroyed' remain
      // ─────────────────────────────────────────────────────────────
      // Remove all own properties (enumerable + non‑enumerable, including getters)
      Object.getOwnPropertyNames(this).forEach(key => delete this[key]);
      
      // Re‑establish the two required data properties
      this.name = name; // plain value, no getter
      this.isDestroyed = true; // plain value
      isDestroyed = true; // keep closure flag synchronised
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
        this.renderWith(obj ?? this.reserved);
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
  //  currentExecIndex: { get: () => currentExecIndex, configurable: true },
    isReactive: { get: () => isReactive, configurable: true },
    type: { get: () => 'Atom', configurable: true }
  });
  
  // ─── Initialise stylesheet and register ───────────────────────────
  initiateStyleSheet(`#${id}`, instance);
  components.set(name, instance);
  
  return instance;
}
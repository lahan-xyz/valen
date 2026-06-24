import {
  initiateStyleSheet,
  processComponentMarkup,
  addToReactiveCache,
  setupEventDelegation
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

function _set(index, value, shallow) {
  if (!this.isReactive) {
    throw new Error(`Valen:\nCannot call 'set()' on Atom ${this.name}.\n\n${this.name} is not a reactive Atom`);
  }
  
  if (typeof index === "number") {
    if (value && typeof value === "object") {
      if (shallow) {
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length; i++) {
          this.state[index][keys[i]] = value[keys[i]];
        }
      } else {
        this.state[index] = value;
      }
    }
  } else if (Array.isArray(index)) {
    for (var i = 0, len = index.length; i < len; i++) {
      this.state[i] = index[i];
    }
  } else {
    console.warn(`Valen:\nFirst Argument passed to '${this.name}.set()' must either be a number or an array.`);
  }
}

export default function Atom(activatorFunc) {
  const options = activatorFunc();
  const { id, template, isReactive, stylesheet } = options;
  
  const name = activatorFunc.name;
  
  let _element = id,
  _state = [];
  const _name = name;
  const _template = template;
  const _useStrict = true;
  
  const setFunc = isReactive ? _set : () => {
    console.warn(`Cannot call set on Atom '${_name}'. Make sure 'isReactive' is set to true.`);
  };
  
  const instance = {
   dependencyMap: isReactive ? new Map() : undefined,
    stylesheet,
    _getElement() {
      if (typeof _element === "string") {
        const resolvedNode = document.getElementById(_element);
        if (!resolvedNode) {
          throw new Error(`Valen:\nMount node of '${_name}' is invalid or not provided`);
        }
        _element = resolvedNode;
      }
      return _element;
    },
    
    destroy() {
      const el = this._getElement();
      if (isReactive) this.dependencyMap.clear();
      
      if (!el) return;
      
      el.replaceChildren();
      this.state = [];
    },
    
    renderWith(data, position = "append") {
      if (!data || (typeof data !== "object")) {
        throw new Error(`Valen:\nFirst argument of '${_name}.renderWith()' must be an object or array.`);
      }
      
      const el = this._getElement();
      const dataArray = Array.isArray(data) ? data : [data];
      
      if (dataArray.length === 0) return Promise.resolve();
      
      const maxBound = _state.length + dataArray.length;
      
      let currentIndex = _state.length;
      _state = isReactive ? createSignal([..._state, ...dataArray], this) : dataArray;
      
      return new Promise((resolve, reject) => {
        const isTemplateFunc = typeof _template === "function";
        const masterFragment = document.createDocumentFragment();
        const BATCH_SIZE = 30;
        
        const processBatch = () => {
          const end = Math.min(currentIndex + BATCH_SIZE, maxBound);
          
          for (let i = currentIndex; i < end; i++) {
            const relativeIndex = i - _state.length;
            const itemData = dataArray[relativeIndex];
            
            const itemHTML = isTemplateFunc ?
              _template(itemData, i) :
              _template;
            
            const indexedHTML = addIndexToTemplate(itemHTML, i);
            
            const processedHTML = isReactive ?
              initiateComponents(indexedHTML, false, true) :
              lintPlaceholders(initiateExtendedWidgets(initiateWidgets(indexedHTML)), true);
            
            const frag = processComponentMarkup(processedHTML, instance, _name);
            if (frag) masterFragment.appendChild(frag);
          }
          
          currentIndex = end;
          
          if (currentIndex < maxBound) {
            requestAnimationFrame(processBatch);
          } else {
            try {
              if (position === "append") {
                el.appendChild(masterFragment);
              } else {
                el.prepend(masterFragment);
              }
              addToReactiveCache(el);
              setupEventDelegation(el, instance);
              resolve();
            } catch (err) {
              console.error("Valen render error:", err);
              reject(err);
            }
          }
        };
        
        requestAnimationFrame(processBatch);
      });
    },
    set: setFunc
  };
  
  Object.defineProperties(instance, {
    element: { get: () => _element, configurable: true },
    name: { get: () => _name, configurable: true },
    state: { get: () => _state,
      configurable: true },
    template: { get: () => _template, configurable: true },
    useStrict: { get: () => _useStrict, configurable: true },
    isReactive: { get: () => isReactive, configurable: true },
    type: { get: () => "Atom", configurable: true }
  });
  
  initiateStyleSheet(`#${id}`, instance);
  components.set(name, instance);
  return instance;
}
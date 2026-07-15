import { components, removeFromReactiveCache } from '../internal.js';
import { createSignal } from '../reactivity/signal.js';
import { initiateStyleSheet } from '../dom/utils.js';

export default function Component(componentFunc) {
  const componentName = componentFunc.name;
  
  // 1. FAST FAIL: Validate the name BEFORE executing the function or checking the map
  if (!componentName || componentName === "anonymous") {
    throw new Error(`[Valen] Components must be named functions. Example: function Header() {}.`);
  }
  
  if (components.has(componentName)) {
    throw new Error(`Component '${componentName}' already exists, choose a new component name.`);
  }
  
  // 2. Safely invoke the component function now that validation has passed
  const instance = componentFunc();
  
  // 3. SAFETY FIX: `typeof null` is "object". We must check if instance is strictly truthy.
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
    throw new Error(`Return value of Component '${componentName}' must be a plain object`);
  }
  
  // The Gatekeeper Flag
  let cssInjected = false;
  let atomDeps = new Set();
  
  let _state = createSignal(instance.state, instance);
  
  let isDestroyed = false;
  
  instance.destroy = function() {
    if (isDestroyed) return;
    
    components.delete(componentName);
    
    const el = instance.element;
    if (el) {
      removeFromReactiveCache(el.getElementsByTagName("*"));
      el.replaceChildren();
      el.remove();
    }
    
    if (instance.isReactive && instance.dependencyMap) {
      instance.dependencyMap.clear();
      instance.dependencyMap = undefined;
    }
    
    // Clean up internal references
    atomDeps = undefined;
    _state = undefined;
    instance.element = undefined;
    instance.isMounted = false;
    
    // -----------------------------------------------
    // GUARANTEE: only 'name' and 'isDestroyed' remain
    // -----------------------------------------------
    // Remove ALL own properties (enumerable + non‑enumerable) EXCEPT 'name'
    Object.getOwnPropertyNames(instance).forEach(key => {
      if (key !== 'name') delete instance[key];
    });
    
    // Now set a plain data property for isDestroyed
    instance.isDestroyed = true;
    isDestroyed = true; // keep local guard variable in sync
  };
  
  // Make getter properties configurable so they can be deleted during destroy
  Object.defineProperties(instance, {
    type: {
      get: () => "Component",
      configurable: true
    },
    atomDeps: {
      get: () => atomDeps,
      configurable: true
    },
    state: {
      get: () => _state,
      set: (newstate) => {
        if (instance.isFrozen) return;
        if (!newstate || typeof newstate !== "object" || Array.isArray(newstate)) {
          console.warn(`Value of '${componentName}.state' must be a plain object`);
          return;
        }
        Object.assign(_state, newstate);
        return true;
      },
      configurable: true
    },
    isDestroyed: {
      get: () => isDestroyed,
      configurable: true
    }
  });
  
  // 5. LIFECYCLE OPTIMIZATION: Avoid `.bind()` memory allocation
  //    Optional chaining keeps `this` as `instance`, equivalent to `.call(instance, _state)`
  instance.created?.(_state);
  instance.created = undefined; // prefer undefined for V8 hidden classes
  
  // The Execution Function (registered in the global component map)
  const func = () => {
    if (!instance.isMounted) {
      instance.isFrozen = false;
      instance.name = componentName;
      instance.useStrict = instance.useStrict ?? true;
      instance.element = `valen${componentName}`;
      
      // One‑time CSS evaluation
      if (instance.stylesheet && !cssInjected) {
        initiateStyleSheet(`#${instance.element}`, instance);
        cssInjected = true;
      }
      
      instance.stylesheet = undefined;
    }
    return instance;
  };
  
  components.set(componentName, func);
  return instance;
}
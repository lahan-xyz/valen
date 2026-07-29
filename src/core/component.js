import { components, removeFromReactiveCache } from '../internal.js';
import { createSignal } from '../reactivity/signal.js';
import { initiateStyleSheet } from '../dom/utils.js';

let hasInitializedRoot = false;

export default function Component(componentFunc) {
  const componentName = componentFunc.name;
  
  // 1. FAST FAIL: Validate the name BEFORE executing the function
  if (!componentName || componentName === "anonymous") {
    throw new Error(`Valen Components must be named functions. Example: function Header() {}.`);
  }
  
  if (components.has(componentName)) {
    throw new Error(`Component '${componentName}' already exists, choose a new component name.`);
  }
  
  // 2. Safely invoke the component function
  const instance = componentFunc();
  
  // 3. EARLY VALIDATION: Prevent partial state mutation and runtime errors 
  // if the component function returns null, undefined, or an array.
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
    throw new Error(`Return value of Component '${componentName}' must be a plain object`);
  }
  
  const mount = instance.mount;
  let isRootComponent = false;
  
  // 4. Root component initialization
  if (!hasInitializedRoot && mount) {
    instance.element = typeof mount === "string" ? document.querySelector(mount) : mount;
    hasInitializedRoot = true;
    isRootComponent = true;
    
    if (!instance.element) {
      throw new Error(`Valen:\nMount node selector '${mount}' is invalid`);
    }
  }
  
  // 5. Internal state setup (grouped for better JS engine hidden-class optimization)
  let cssInjected = false;
  let atomDeps = new Set();
  let _state = createSignal(instance.state, instance);
  let isDestroyed = false;
  
  // 6. Destroy logic
  instance.destroy = function() {
    if (isDestroyed) return;
    
    components.delete(componentName);
    
    const el = instance.element;
    // SAFETY FIX: Ensure it's an actual DOM Element before calling DOM methods
    if (el instanceof Element) {
      removeFromReactiveCache(el.getElementsByTagName("*"));
      el.replaceChildren();
      el.remove();
    }
    
    if (instance.isReactive && instance.dependencyMap) {
      instance.dependencyMap.clear();
      instance.dependencyMap = undefined;
    }
    
    // Clean up internal references to prevent memory leaks
    atomDeps = undefined;
    _state = undefined;
    instance.element = undefined;
    instance.isMounted = false;
    
    // Remove ALL own properties EXCEPT 'name' and 'isDestroyed'
    // Optimized with a standard for-loop for better performance than .forEach()
    const keys = Object.getOwnPropertyNames(instance);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key !== 'name' && key !== 'isDestroyed') {
        delete instance[key];
      }
    }
    
    isDestroyed = true;
  };
  
  // 7. Define optimized properties 
  // Using 'value' instead of getters for static values improves engine performance
  Object.defineProperties(instance, {
    type: { value: "Component", writable: false, configurable: true },
    isRootComponent: { value: isRootComponent, writable: false, configurable: true },
    name: { value: componentName, writable: false, configurable: true },
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
  
  // 8. Lifecycle hook (explicit typeof check is marginally faster than optional chaining in V8)
  if (typeof instance.created === "function") {
    instance.created(_state);
    instance.created = undefined;
  }
  
  // 9. The Execution Function (registered in the global component map)
  const func = () => {
    if (!instance.isMounted) {
      instance.isFrozen = false;
      instance.useStrict = instance.useStrict ?? true;
      
      // SAFETY FIX: Prevent overwriting the root DOM element with a string ID, 
      // which would break instance.destroy() later.
      if (!isRootComponent) {
        instance.element = `valen${componentName}`;
      }
      
      // One‑time CSS evaluation
      if (instance.stylesheet && !cssInjected) {
        // Derive selector safely: if root is an Element, use its ID, otherwise use the element property
        const selector = (isRootComponent) ? "" :
          `#${instance.element}`;
    
        initiateStyleSheet(selector, instance);
        cssInjected = true;
      }
      
      instance.stylesheet = undefined;
    }
    return instance;
  };
  
  components.set(componentName, func);
  return instance;
}
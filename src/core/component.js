import { components } from '../internal.js';
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
  
  const _state = createSignal(instance.state, instance);
  
  Object.defineProperty(instance, "state", {
    get: () => _state,
    set: (newstate) => {
      if (instance.isFrozen) return;
      
      // Hardened object validation
      if (!newstate || typeof newstate !== "object" || Array.isArray(newstate)) {
        console.warn(`Value of '${componentName}.state' must be a plain object`);
        return;
      }
      
      // 4. MEMORY & SPEED: Bypass the getter completely and use Object.assign
      Object.assign(_state, newstate);
      return true;
    },
    configurable: true
  });
  
  // 5. LIFECYCLE OPTIMIZATION: Avoid `.bind()` memory allocation
  if (typeof instance.created === "function") {
    // Call directly with 'instance' as the 'this' context.
    // Also pass '_state' directly to avoid triggering the instance.state getter we just defined.
    instance.created.call(instance, _state);
    instance.created = undefined; // 'undefined' is preferred over 'null' for V8 hidden classes
  }
  
  // The Execution Function
  const func = () => {
    if (!instance.isMounted) {
      instance.isFrozen = false;
      instance.name = componentName;
      
      // 6. SPEED: Avoid the 'in' operator, use Nullish Coalescing
      instance.useStrict = instance.useStrict ?? true;
      instance.element = `valen${componentName}`;
      
      // The One-Time CSS Evaluation
      if (instance.stylesheet && !cssInjected) {
        initiateStyleSheet(`#${instance.element}`, instance);
        cssInjected = true;
      }
      
      // Clean up (undefined > null)
      instance.stylesheet = undefined;
    }
    
    return instance;
  };
  
  // Register globally for template interpolation
  components.set(componentName, func);
  
  return instance;
}
import { ctx } from '../internal.js';
import { updateComponent } from '../dom/utils.js';


// Creates a reactive signal, a proxy object that automatically updates the DOM.
function createSignal(data, object) {
  const item = typeof data !== "object" ? { value: data } : data;
  
  // Cache for nested reactive wrappers – one proxy per underlying object
  const cache = new WeakMap();
  
  function createReactiveObject(obj) {
    if (typeof obj !== "object" || obj === null) return obj;
    
    // Return existing proxy if available
    if (cache.has(obj)) return cache.get(obj);
    
    const proxy = new Proxy(obj, {
      get(target, key) {
        if (ctx.currentTemplate) {
          const temp = ctx.currentComponent;
          ctx.currentDepArr.push({ temp: ctx.currentTemplate, key });
        }
        // Recursively wrap nested objects, but now cached
        return createReactiveObject(target[key]);
      },
      set(target, key, value) {
        const prev = target[key];
        if (prev !== value) {
          target[key] = value;
          
          if (!object.isFrozen) {
            const goAhead = object.onUpdate ?
              object.onUpdate({ oldVal: prev, key, newVal: value },
                object.data
              ) :
              true;
            if (goAhead) updateComponent(key, object);
          }
        }
        return true;
      }
    });
    
    cache.set(obj, proxy);
    return proxy;
  }
  
  return createReactiveObject(item);
}



const globalState = (name, val, shouldStore) => {
  let stored;
  if (shouldStore) {
    stored = localStorage.getItem(name);
    val = stored ? JSON.parse(stored) : val; // only parse if truthy
  }
  
  const obj = typeof val === "object" ? val : { value: val };
  
  // Batching helpers for localStorage writes
  let localStorageDirty = false;
  const persist = () => {
    if (shouldStore && localStorageDirty) {
      localStorage.setItem(name, JSON.stringify(obj));
      localStorageDirty = false;
    }
  };
  
  // Cache for nested reactive wrappers – one proxy per underlying object
  const cache = new WeakMap();
  
  const reactiveObj = (object) => {
    if (typeof object !== "object" || object === null) return object;
    
    if (cache.has(object)) return cache.get(object);
    
    const proxy = new Proxy(object, {
      get(target, key) {
        if (ctx.currentTemplate) {
          ctx.globalCurrentDepArr.push({ temp: ctx.currentTemplate, key });
        }
        
        return reactiveObj(target[key]);
      },
      set(target, key, value) {
        if (target[key] !== value) {
          target[key] = value;
          // Trigger DOM update (already batched via batchedUpdate)
          updateComponent(key, null);
          
          // Mark localStorage as dirty; write will happen once per microtask
          if (shouldStore) {
            localStorageDirty = true;
            queueMicrotask(persist);
          }
        }
        return true;
      }
    });
    cache.set(obj, proxy);
    return proxy;
  };
  
  globalThis[name] = reactiveObj(obj);
};


export { createSignal, globalState }
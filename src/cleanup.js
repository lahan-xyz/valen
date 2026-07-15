import { reactiveCache, removeFromReactiveCache, components } from './internal.js';
import { renderComponent, addToReactiveCache } from './dom/utils.js'

export function detach(instance, index) {
  const { type, isMounted, element, onCleanup } = instance;
  
  // 1. Guard clause: Exit early if there's nothing to detach
  if (type === "Widget" || !isMounted) return;
  
  const isAtom = type === "Atom";
  const isNumberIndex = typeof index === "number";
  const isAtomWithIndex = isAtom && isNumberIndex;
  
  // 2. Deduce the target container efficiently
  const container = isAtomWithIndex ? instance.entry.get(index) : element;
  if (!container) return;
  
  const firstChild = container.firstElementChild;
  
  // 3. Consolidate state updates and lifecycle flags
  if (isAtomWithIndex) {
    instance.dependencyMap.delete(index);
  } else {
    instance.isMounted = false;
    if (isAtom) {
      instance.reserved = instance.state.slice();
      instance.state.length = 0;
      instance.dependencyMap.clear();
      instance.entry.clear();
      instance.clearElement();
    }
  }
  
  if(typeof onCleanup === 'function') onCleanup(instance.state);
  
  if (type === 'Component') {
    const deps = instance.atomDeps;
    
    if(deps.size) {
      deps.forEach((name) => {
        const ins = components.get(name);
        detach(ins);
      })
    }
  }
  // 4. Optimize DOM Cleanup: Only query the DOM if children actually exist
  if (firstChild) {
    removeFromReactiveCache(container.getElementsByTagName("*"));
    container.replaceChildren();
  }
}


export function reAttach(instance) {
  const { name, type, isMounted, element: container } = instance;
  
  if(isMounted || type === "Atom" || type === 'Widget') return;
  
  if(!container) return;
  
  
  const frag = renderComponent(instance, name, true, true);
  
  container.appendChild(frag);
  addToReactiveCache(container);
  instance.run(instance.state);
}
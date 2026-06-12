import { ctx, components } from '../internal.js';
import { createSignal } from '../reactivity/utils.js';


class Component {
  // 1. Declare strict private fields
  #name;
  #isFrozen = false;
  #useStrict;
  #onUpdate;
  #run;
  #created;
  #template;
  
  constructor(name, options = {}) {
    if (name) {
      globalThis[name] = this;
    }
    
    // Assign to private fields
    this.#name = name;
    this.#template = options?.template;
    this.#run = options.run || (() => {});
    this.isMounted = false;
    this.navigateFunc = options.onNavigate || (() => {});
    
    if (!this.#template) {
      throw new Error(`Valen:\nTemplate not provided for Component ${name}`);
    }
    
    this.element = `vaEl${ctx.counterVA}`; // string ID – later resolved to DOM node
    ctx.counterVA++;
    
    // Reactive state
    this.data = createSignal(options.data, this);
    
    this.#created = options.created;
    this.stylesheet = options.stylesheet;
    this.#onUpdate = options.onUpdate;
    
    // O(1) existence check instead of O(N) array allocation
    this.#useStrict = 'useStrict' in options ? options.useStrict : true;
    
    // Batched rendering queue (microtask‑based)
    this._renderPending = false;
    
    let _data = this.data;
    
    // 2. Only define the custom setter/getter for `data` here
    Object.defineProperty(this, "data", {
      get: () => _data,
      set: (data) => {
        if (!this.#isFrozen) {
          // Hardened object validation
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            console.warn(`Value of '${this.#name}.data' must be a plain object`);
            return;
          }
          
          const keys = Object.keys(data);
          
          for (let key of keys) {
            this.data[key] = data[key];
          }
        }
        return true;
      },
      configurable: true
    });
    
    if (this.#created) {
      this.#created(this.data);
      this.#created = null; // Safe internal mutation
    }
    
    components.set(name, this);
  }
  
  // 3. Expose read-only public getters
  get name() { return this.#name; }
  get isFrozen() { return this.#isFrozen; }
  get useStrict() { return this.#useStrict; }
  get onUpdate() { return this.#onUpdate; }
  get run() { return this.#run; }
  get created() { return this.#created; }
  get template() { return this.#template; }
  
  _scheduleRender() {
    if (!this._renderPending) {
      this._renderPending = true;
      queueMicrotask(() => {
        this._renderPending = false;
        
        const el = this._resolveElement();
        if (el && el.isConnected) {
          renderComponent(this, this.#name);
        }
      });
    }
  }
  
  renderNow() {
    this._renderPending = false;
    renderComponent(this, this.#name);
  }
  
  freeze() {
    this.#isFrozen = true;
  }
  
  unfreeze() {
    this.#isFrozen = false;
  }
  
  show() {
    const el = this._resolveElement();
    if (el && el.style.display !== 'block') {
      el.style.display = 'block';
    }
  }
  
  hide() {
    const el = this._resolveElement();
    if (el && el.style.display !== 'none') {
      el.style.display = 'none';
    }
  }
  
  mount() {
    if (!this.isMounted) {
      const rendered = renderComponent(this, this.#name, true);
      const fragment = document.createRange().createContextualFragment(rendered);
      const el = this._resolveElement();
      
      if (el) {
        // 4. Native C++ engine replacement replaces loop allocation
        el.replaceChildren(fragment);
      }
      
      this.isMounted = true; // Internal mutation
    }
  }
  
  destroy() {
    const el = this._resolveElement();
    if (!el) return;
    
    const allNodes = [el];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      allNodes.push(node);
    }
    
    removeEvents(allNodes);
    el.remove();
  }
  
  _resolveElement() {
    if (typeof this.element === 'string') {
      return document.querySelector(this.element) || null;
    }
    return this.element;
  }
}


export default Component;
import { createSignal } from '../reactivity/signal.js';
import { initiateStyleSheet, processComponentMarkup, addToReactiveCache, setupEventDelegation, strToEl } from '../dom/utils.js';
import { initiateComponents, lintPlaceholders } from '../parser/utils.js';
import { ctx, components } from '../internal.js';


class App {
  // 1. Declare strict private fields
  #element;
  #isFrozen = false;
  #useStrict;
  #onUpdate;
  #run;
  #created;
  #template;
  #addedToReactiveCache = false;
  
  constructor(selector = "", options = {}) {
    this.#element = typeof selector === "string" ?
      document.querySelector(selector) :
      selector;
    
    if (!this.#element) {
      throw new Error(`Valen:\nElement selector '${selector}' is invalid`);
    }
    
    // Template
    this.#template = options.template || "";
    
    // Reactive state
    this.state = createSignal(options.state, this);
    
    this.stylesheet = options.stylesheet;
    
    // Assign to private fields
    this.#onUpdate = options.onUpdate;
    this.#created = options.created;
    this.#run = options.run || (() => {});
    
    // O(1) existence check instead of O(N) array allocation
    this.#useStrict = 'useStrict' in options ? options.useStrict : true;
    
    // Batched rendering queue
    this._renderPending = false;
    
    initiateStyleSheet("", this);
    
    let _state = this.state;
    Object.defineProperties(this, {
      state: {
        get: () => _state,
        set: (state) => {
          if (!this.#isFrozen) {
            // Hardened object validation
            if (!state || typeof state !== "object" || Array.isArray(state)) {
              console.warn(`Value of 'App.state' must be a plain object`);
              return;
            }
            
            const keys = Object.keys(state);
            for (let key of keys) {
              this.state[key] = state[key];
            }
          }
          return true;
        },
        configurable: true
      }
    });
    
    if (this.#created) {
      this.#created(this.state);
      this.#created = null; // Can still mutate internally
    }
  }
  
  // 2. Expose read-only public getters
  get element() { return this.#element; }
  get template() { return this.#template; }
  get isFrozen() { return this.#isFrozen; }
  get useStrict() { return this.#useStrict; }
  get onUpdate() { return this.#onUpdate; }
  get run() { return this.#run; }
  get created() { return this.#created; }
  
  _scheduleRender() {
    if (!this._renderPending) {
      this._renderPending = true;
      queueMicrotask(() => {
        this._renderPending = false;
        this._doRender();
      });
    }
  }
  
  _doRender() {
    let template = this.template instanceof Function ?
      this.template(this.state) :
      this.template;
    
    //template = handleRouter(template);
    template = initiateComponents(template, false, false);
 
    const fragment = processComponentMarkup(template, this);
    //const fragment = document.createRange().createContextualFragment(htmlString);
    
    // 3. Replaces while-loop removal and appendChild in a single native API call
    this.#element.replaceChildren(fragment);
    
    ctx.currentComponent?.navigateFunc(ctx.currentComponent.state);
    
    if (!this.#addedToReactiveCache) {
      addToReactiveCache(this.#element);  
      this.#addedToReactiveCache = true;
    }
    
    setupEventDelegation(this.#element, this);
    
    for (const component of components) {
      const instance = component[1];
      if (instance.type === "Atom") continue;
      
      if (instance.element) {
        strToEl(instance);
      }
      
      if(instance.run) instance.run(instance.state);
    }
    
    this.#run(this.state);
  }
  
  render() {
    this._renderPending = false;
    this._doRender();
  }
  
  freeze() {
    this.#isFrozen = true; // Internal mutation works perfectly
  }
  
  unfreeze() {
    this.#isFrozen = false;
  }
  
  destroy() {
    const allNodes = [this.#element];
    const walker = document.createTreeWalker(
      this.#element,
      NodeFilter.SHOW_ELEMENT
    );
    let node;
    while ((node = walker.nextNode())) {
      allNodes.push(node);
    }
    
    removeEvents(allNodes);
    this.#element.remove();
  }
}

export default App;

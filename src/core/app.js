import { createSignal } from '../reactivity/utils.js';
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
    this.data = createSignal(options.data, this);
    
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
    
    let _data = this.data;
    Object.defineProperties(this, {
      data: {
        get: () => _data,
        set: (data) => {
          if (!this.#isFrozen) {
            // Hardened object validation
            if (!data || typeof data !== "object" || Array.isArray(data)) {
              console.warn(`Value of 'App.data' must be a plain object`);
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
      }
    });
    
    if (this.#created) {
      this.#created(this.data);
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
      this.template(this.data) :
      this.template;
    
    //template = handleRouter(template);
    template = initiateComponents(template, false, false);
    
    const htmlString = processComponentMarkup(template, this);
    const fragment = document.createRange().createContextualFragment(htmlString);
    
    // 3. Replaces while-loop removal and appendChild in a single native API call
    this.#element.replaceChildren(fragment);
    
    ctx.currentComponent?.navigateFunc(ctx.currentComponent.data);
    
    if (!this.#addedToReactiveCache) {
      addToReactiveCache(this.#element);
      this.#addedToReactiveCache = true;
    }
    
    setupEventDelegation(this.#element, this);
    
    for (const component of components) {
      const instance = component[1];
      if (instance.constructor.name === "Atom") continue;
      
      if (instance.element) {
        strToEl(instance);
      }
      instance.run(instance.data);
    }
    
    this.#run(this.data);
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
import { initiateStyleSheet, processComponentMarkup, stringToDocumentFragment, addToReactiveCache } from '../dom/utils.js';
import { components } from '../internal.js'
import { createSignal } from '../reactivity/signal.js';
import { addIndexToTemplate, initiateComponents } from '../parser/utils.js';  


class Atom {
  // 1. Declare strict private fields
  #element;
  #name;
  #template;
  #data = [];
  #useStrict = true;
  #isReactive;
  
  constructor(name, options, id) {
    this.#element = id;
    this.#name = name;
    this.#template = options.template;
    this.#isReactive = options.isReactive;
    
    this.stylesheet = options.stylesheet;
    this.dependencyMap = new Map();
    initiateStyleSheet(`#${id}`, this);
    components.set(name, this)
  }
  
  // 2. Expose read-only public getters
  get element() { return this.#element; }
  get name() { return this.#name; }
  get template() { return this.#template; }
  get data() { return this.#data; }
  get useStrict() { return this.#useStrict; }
  get isReactive() { return this.#isReactive; }
  
  // Resolve string ID to DOM element once and cache it internally
  _getElement() {
    if (typeof this.#element === "string") {
      const resolvedNode = document.getElementById(this.#element);
      if (!resolvedNode) {
        throw new Error(`Valen:\nMount node of '${this.#name}' is invalid or not provided`);
      }
      this.#element = resolvedNode; // Cache the node
    }
    return this.#element;
  }
  
  // Cleanly clear the container and purge events
  destroy() {
    const el = this._getElement();
    if (!el) return;
    
    const allNodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode; // Start at root container
    
    while (node) {
      allNodes.push(node);
      node = walker.nextNode();
    }
    
    removeEvents(allNodes);
    
    el.replaceChildren();
    
    this.#data = [];
  }
  
  renderWith(data, position = "append") {
    if (!data || typeof data !== "object") {
      throw new Error(
        `Valen:\nFirst argument passed to '${this.#name}.renderWith()' must either be an object or an array.`
      );
    }
    
    const el = this._getElement();
    const dataArray = Array.isArray(data) ? data : [data];
    if (dataArray.length === 0) return;
    
    const dataLen = this.#data.length;
    
    this.#data = createSignal(dataArray.slice(), this);
    
    // Return a Promise that resolves when rendering finishes
    return new Promise((resolve, reject) => {
      const isTemplateFunc = typeof this.#template === "function";
      const isReactive = this.#isReactive;
      const template = this.#template;
      const name = this.#name;
      
      const processNuggets = (html) => {
        html = initiateNuggets(html);
        return initiateExtendedNuggets(html);
      };
      
      // ── Configuration ──
      const BATCH_SIZE = 30; // items per animation frame – tune this!
      const htmlParts = [];
      let currentIndex = dataLen;
      
      const processBatch = () => {
        const end = Math.min(currentIndex + BATCH_SIZE, dataArray.length);
        
        for (let i = currentIndex; i < end; i++) {
          const item = dataArray[i];
          let itemHTML = isTemplateFunc ? template(item, i) : template;
          
          itemHTML = isReactive ?
            addIndexToTemplate(itemHTML, i) :
            addIndexToTemplate(itemHTML, i, this);
          
          if (isReactive) {
            itemHTML = initiateComponents(itemHTML, false, true);
            itemHTML = processComponentMarkup(itemHTML, this, name);
          } else {
            itemHTML = processNuggets(itemHTML);
            itemHTML = lintPlaceholders(itemHTML, true);
            itemHTML = processComponentMarkup(itemHTML, this, name);
          }
          
          htmlParts.push(itemHTML);
        }
        
        currentIndex = end;
        
        if (currentIndex < dataArray.length) {
          // Still have items – yield the main thread
          requestAnimationFrame(processBatch);
        } else {
          // All items processed – build final DOM once and mount
          try {
            const combinedHTML = htmlParts.join('');
            const fragment = stringToDocumentFragment(combinedHTML);
            if (position === "append") {
              el.appendChild(fragment);
            } else {
              el.prepend(fragment);
            }
            
            addToReactiveCache(el);
            resolve(); // Done
          } catch (err) {
            reject(err);
          }
        }
      };
      // Kick off the first batch
      requestAnimationFrame(processBatch);
    });
  }
  
  set(index, value, shallow) {
    if (!this.#isReactive) {
      throw new Error(`Valen:\nCannot call 'set()' on Atom ${this.#name}.\n\n${this.#name} is not a reactive Atom`);
    }
    
    if (typeof index === "number") {
      
      if (value && typeof value === "object") {
        if (shallow) {
          Object.keys(value).forEach(key => {
            this.#data[index][key] = value[key];
          });
        } else {
          this.#data[index] = value;
        }
      }
    } else if (Array.isArray(index)) {
      index.forEach((newObj, i) => {
        this.#data[i] = newObj;
      });
    } else {
      console.warn(`Valen:\nFirst Argument passed to '${this.#name}.set()' must either be a number or an array.`);
    }
  }
}


export default Atom;
import { ctx, nuggets } from '../internal.js'

class Nugget {
  /**
   * A class for creating reusable UI components
   * @param {Object} options    An object containing all required options for the component
   */
  
  // 1. Declare strict private fields
  #className;
  #template;
  
  constructor(name, options = {}) {
    // Stores instance's stylesheet 
    this.stylesheet = options.stylesheet ?? {};
    
    // Create a property that generates a unique className for instance's parent element
    this.#className = `nugget${ctx.nuggetCounter}`;
    
    // Increment the ctx.nuggetCounter variable for later use
    ctx.nuggetCounter++;
    
    // Stores template 
    this.#template = options.template;
    this.stylesheetInitiated = false;
    
    nuggets.set(name, this);
  }
  
  // 2. Expose read-only public getters
  get className() { return this.#className; }
  get template() { return this.#template; }
  
  destroy() {
    // 3. Query safely utilizing the internal private field
    const all = document.querySelectorAll(`.${this.#className}`);
    // Remove elements and their events from the DOM
    removeEvents(all, true);
  }
}


export default Nugget;
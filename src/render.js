import Component from './core/component.js';
import { processComponentMarkup, addToReactiveCache, setupEventDelegation, strToEl } from './dom/utils.js';
import { initiateComponents } from './parser/utils.js';
import { ctx, components } from './internal.js';

let appIsRendered = false;

export default function render(component) {
  if (appIsRendered) return;
  
  const activatorFunc = components.get(component.name);
  
  if (typeof activatorFunc === "function") {
    component = activatorFunc();
  }
  
  let template = component.template instanceof Function ?
    component.template(component.state) :
    component.template;
  
  //template = handleRouter(template);
  template = initiateComponents(template, false, false);
  
  const fragment = processComponentMarkup(template, component);
  
  component.element.replaceChildren(fragment);
  
  //ctx.currentComponent?.navigateFunc(ctx.currentComponent.state);
  
  if (!component.addedToReactiveCache) {
    addToReactiveCache(component.element);
    component.addedToReactiveCache = true;
  }
  
  setupEventDelegation(component.element, component);
  
  for (const component of components) {
    const instance = component[1];
    if (instance.type === "Atom" || typeof instance === "function") continue;
    if (instance.element) {
      strToEl(instance);
    }
    
    if (instance.run) instance.run(instance.state);
  }
  
  if (typeof component.run === 'function') component.run(component.state);
  
  appIsRendered = true;
}
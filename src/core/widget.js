import { widgets } from '../internal.js'
import { renderWidget } from '../parser/utils.js';
import { initiateStyleSheet } from '../dom/utils.js';

/**
 * Valen Widget Higher-Order Function
 */
export default function Widget(WidgetFunc) {
  const widgetName = WidgetFunc.name;
  
  // 1. FAST FAIL: Validate immediately
  if (!widgetName || widgetName === "anonymous") {
    throw new Error(`[Valen] Widgets must be named functions. Example: function Button() {}`);
  }
  
  // 2. CONSISTENCY & SAFETY: Prevent duplicate widget registrations
  if (widgets.has(widgetName)) {
    throw new Error(`Widget '${widgetName}' already exists, choose a new widget name.`);
  }
  
  // The Gatekeeper Flag
  let cssInjected = false;
  
  // The Execution Function
  const func = (props = {}, children = "") => {
    // Generate the raw component object
    const instance = WidgetFunc(props);
    
    // 3. INSTANCE SAFETY: Ensure the widget actually returned a valid object
    if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
      throw new Error(`Return value of Widget '${widgetName}' must be a plain object`);
    }
    
    instance.className = widgetName;
    
    // 4. MICRO-OPTIMIZATION: Short-circuiting order
    if (!cssInjected && instance.stylesheet) {
      initiateStyleSheet(`.${widgetName}`, instance, true);
      cssInjected = true;
    }
    
    // 5. MEMORY/V8 OPTIMIZATION: undefined over null
    instance.stylesheet = undefined;
    
    // Pass only what is necessary to the renderer
    return renderWidget(instance, props, children);
  };
  
  // Register globally for template interpolation
  widgets.set(widgetName, func);
  
  return func;
}
import { widgets } from '../internal.js';
import { renderWidget } from '../parser/utils.js';
import { initiateStyleSheet } from '../dom/utils.js';

// Shared frozen empty object to prevent allocating a new {} on every widget render
const EMPTY_PROPS = Object.freeze({});

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
  // Removed default parameter {} to avoid per-call memory allocation
  function func(props, children) {
    const safeProps = props == null ? EMPTY_PROPS : props;
    const safeChildren = children == null ? "" : children;
    
    // Generate the raw component object
    const instance = WidgetFunc(safeProps);
    
    // 3. INSTANCE SAFETY: Ensure the widget actually returned a valid object
    if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
      throw new Error(`Return value of Widget '${widgetName}' must be a plain object`);
    }
    
    instance.className = widgetName;
    
    // 4. OPTIMIZATION: Only interact with stylesheet property if it exists
    if (instance.stylesheet) {
      if (!cssInjected) {
        initiateStyleSheet(`.${widgetName}`, instance, true);
        cssInjected = true;
      }
      // 5. MEMORY/V8 OPTIMIZATION: Clean up reference after first use
      instance.stylesheet = undefined;
    }
    
    // Pass only what is necessary to the renderer
    return renderWidget(instance, safeProps, safeChildren);
  }
  
  // 6. PERFORMANCE: Use 'value' instead of getter for static properties 
  // (enables better JavaScript engine hidden-class optimization)
  Object.defineProperty(func, "type", {
    value: "Widget",
    writable: false,
    configurable: true
  });
  
  // Register globally for template interpolation
  widgets.set(widgetName, func);
  
  return func;
}
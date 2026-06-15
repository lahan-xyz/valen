import { widgets } from '../internal.js'
import { renderWidget } from '../parser/utils.js';
import { initiateStyleSheet } from '../dom/utils.js';


/**
 * Valen Widget Higher-Order Function
 */
export default function Widget(WidgetFunc) {
  // 1. The Gatekeeper Flag
  let cssInjected = false;
  
  const widgetName = WidgetFunc.name;
  
  if (!widgetName || widgetName === "anonymous") {
    throw new Error(`[Valen] Widgets must be named functions. Example: function Button() {}`);
  }
  
  // 2. The Execution Function
  const func = (props = {}, children = "") => {
    // Generate the raw component object
    const instance = WidgetFunc(props);
    instance.className = widgetName;
    
    // 3. The One-Time CSS Evaluation
    if (instance.stylesheet && !cssInjected) {
      initiateStyleSheet("."+widgetName, instance, true); // Inject styles to the <head>
      cssInjected = true; // Lock the gate forever for this component type
    }
    
    // 4. Clean up the object before passing it to the parser to save memory
    instance.stylesheet = null;
    
    // 5. Pass only what is necessary to the renderer
    return renderWidget(instance, props, children);
  };
  
  // Register globally for template interpolation
  widgets.set(widgetName, func);
  
  return func;
}
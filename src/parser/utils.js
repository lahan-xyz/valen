import { ctx, components, LRUCache, sharedTemplate, stringBetween, updateQueue, widgets } from '../internal.js';
import { renderComponent, initiateStyleSheet } from '../dom/utils.js';



const lintPlaceholders = (html, isWidget) => {
  const eventRegex = /(@[\w]+)\s*=\s*\[((?:[^\[\]]|\[[^\[\]]*\])*)\]/g;
  const attributeRegex = /([\w-:]+)\s*=\s*\[((?:[^\[\]]|\[[^\[\]]*\])*)\]/g;
  
  // 1. Process Events
  if (!isWidget) {
    html = html.replace(eventRegex, (_, attrName, innerContent) => {
        return `${attrName}="${innerContent.replaceAll("'", "`")}"`;
    });
  }

  // 2. Process Directives & Standard Attributes
  return html.replace(attributeRegex, (_, attrName, innerContent) => {
    return `${ attrName } = "[${innerContent}]"`;
  });
};

const lexerCache = new LRUCache(500);

// Pre-calculated ASCII constants for V8 optimization
const C_SPACE = 32, C_TAB = 9, C_NL = 10, C_CR = 13;
const C_EQ = 61, C_GT = 62, C_LT = 60, C_SLASH = 47, C_BRACKET_OPEN = 91;

function isWhitespace(code) {
  return code === C_SPACE || code === C_TAB || code === C_NL || code === C_CR;
}

function isBoundary(code) {
  return isWhitespace(code) || code === C_EQ || code === C_GT || code === C_LT || code === C_SLASH;
}

function lexTemplate(templateString) {
  if (lexerCache.has(templateString)) {
    return lexerCache.get(templateString);
  }
  
  const chunks = [];
  const len = templateString.length;
  let depth = 0;
  let inQuote = false;
  let quoteCode = 0;
  let startIdx = 0;
  let exprStart = -1;
  
  let currentAttrName = '';
  let gatheringAttrName = false;
  let attrNameStart = 0;

  for (let i = 0; i < len; i++) {
    const code = templateString.charCodeAt(i);
    
    // Track HTML attribute names
    if (depth === 0) {
      if (isBoundary(code) && code !== C_EQ) {
        gatheringAttrName = true;
        attrNameStart = i + 1;
      } else if (code === C_EQ) {
        gatheringAttrName = false;
        currentAttrName = templateString.slice(attrNameStart, i).trim();
      }
    }
    
    // 1. NATIVE EVENT SKIPPING ONLY
    // We removed the '@' check! Now it ONLY skips native DOM events like 'onclick'.
    // This allows Valen to dive into @change="[ ... ]" and extract your signal logic.
    if (depth === 0 && (code === 34 || code === 39)) { 
      if (currentAttrName.startsWith('on')) {
        let closingIdx = i + 1;
        while (closingIdx < len) {
          if (templateString.charCodeAt(closingIdx) === code && templateString.charCodeAt(closingIdx - 1) !== 92) { 
            break;
          }
          closingIdx++;
        }
        if (closingIdx < len) {
          i = closingIdx;
          continue;
        }
      }
    }
    
    // 2. INTERNAL QUOTE TRACKING
    if (depth > 0 && (code === 34 || code === 39 || code === 96) && templateString.charCodeAt(i - 1) !== 92) {
      if (!inQuote) {
        inQuote = true;
        quoteCode = code;
      } else if (quoteCode === code) {
        inQuote = false;
        quoteCode = 0;
      }
    }
    
    // 3. STRUCTURAL BRACKET TRACKING
    if (!inQuote) {
      if (code === 91) { // '['
        
        const prevCode = templateString.charCodeAt(i - 1);
        if (depth === 0 && (prevCode === 45 || prevCode === 58)) {
          continue; // Skip static CSS framework classes
        }

        if (depth === 0) {
          if (startIdx < i) {
            chunks.push({ isExpr: false, val: templateString.slice(startIdx, i) });
          }
          exprStart = i;
        }
        depth++;
      } else if (code === 93) { // ']'
        if (depth > 0) {
          depth--;
          if (depth === 0) {
            chunks.push({ isExpr: true, val: templateString.slice(exprStart + 1, i) });
            startIdx = i + 1;
          }
        }
      }
    }
  }
  
  if (startIdx < len) {
    chunks.push({ isExpr: false, val: templateString.slice(startIdx) });
  }
  
  lexerCache.set(templateString, chunks);
  return chunks;
}



const ENTITY_REGEX = /&(gt|lt);/g;
const evaluatorCache = new LRUCache(500);

function evaluateTemplate(templateString, instance) {
  const chunks = lexTemplate(templateString);
  
  // Fast exit: If it's just one chunk of text, no expressions exist
  if (chunks.length === 1 && !chunks[0].isExpr) return templateString;
  
  let combinedHTML = '';
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    // If it's standard HTML text, just append it and move on
    if (!chunk.isExpr) {
      combinedHTML += chunk.val;
      continue;
    }
    
    // --- EXPRESSION EVALUATION ---
    const innerContent = chunk.val;
    ctx.currentTemplate = innerContent; // Reactivity dependency trap
    
    const ext = innerContent.replace(ENTITY_REGEX, (_, entity) =>
      entity === 'gt' ? '>' : '<'
    ).trim();
    
    if (!ext) continue;
    
    const isGlobal = ext.charCodeAt(0) === 36; // '$'
    
    let evaluator = evaluatorCache.get(ext);
    if (!evaluator) {
      try {
        const source = isGlobal ? ` return ${ ext };` : `with(state) { return ${ ext }; }`;
        
        // Pass 'state' as the argument name
        evaluator = new Function("state", source);
        evaluatorCache.set(ext, evaluator);
      } catch (err) {
        console.warn(`
        Valen Syntax Error in \`${innerContent}\`\n`, err); combinedHTML += `[${innerContent}]`; // Output raw bracket if it fails
      continue;
    }
  }
  
  try {
    // Pass instance.state directly into the function execution
    const parsed = isGlobal ? evaluator() : evaluator.call(instance, instance.state);
    
    if (parsed != null && !Number.isNaN(parsed)) {
      combinedHTML += parsed;
    }
  } catch (error) {
    console.warn(`Valen Execution Error in \`${innerContent}\`\n`, error);
  }
}

ctx.currentTemplate = "";
return combinedHTML;
}


function initiateWidgets(markup, isWidget) {
  const widgetRegex = /<([A-Z]\w*)\s*\{([\s\S]*?)\}\s*\/>/g;
  
  // Shared cache for compiled props (across all calls)
  if (!initiateWidgets._propsCache) {
    initiateWidgets._propsCache = new LRUCache();
  }
  
  const replacedMarkup = markup.replace(widgetRegex, (match, name, propsString) => {
    // propsString = the object literal inside { } (trimmed later)
    const trimmedProps = `{ ${propsString.trim()} }`;
    const cacheKey = `${propsString.trim()}`;
    
    let evaluated;
    try {
      // Retrieve or compile the props function
      let propsFn = initiateWidgets._propsCache.get(cacheKey);
      if (!propsFn) {
        propsFn = new Function(`return ${trimmedProps}`);
        initiateWidgets._propsCache.set(cacheKey, propsFn);
      }
      const d = propsFn();
      const instance = widgets.get(name);
      
      if (instance) {
        evaluated = instance(d);
      } else {
        console.warn(`Valen:\nWidget '${name}' could not be rendered. Make sure '${name}' is defined or wrapped in the Widget function.`);
        evaluated = match; // leave original markup as fallback
      }
    } catch (e) {
      console.warn(`Valen:\nAn error occured while rendering Widget '${name}': ${e}\n\nError sourced from: \`${match}\``);
      evaluated = match; // keep original on error
    }
    return evaluated;
  });
  
  return lintPlaceholders(replacedMarkup, isWidget);
}


const COMPONENT_SELF_CLOSING_REGEX = /<([A-Z]\w*)\s*\/>/g;

function initiateComponents(markup, isWidget, fromAtom) {
  markup = lintPlaceholders(markup, isWidget);
  
  // If not a widget, replace self-closing component tags with rendered output
  if (!isWidget && !fromAtom) {
    markup = markup.replace(COMPONENT_SELF_CLOSING_REGEX, (match, tagName) => {
      const instance = components.get(tagName);
      if (!instance) {
        console.warn(`Valen:\nComponent '<${tagName}/>' is not defined, check whether '${tagName}' is correctly spelt or is defined.`);
        return match; // leave original to avoid further breakage
      }
      try {
        return renderComponent(instance, tagName);
      } catch (e) {
        console.warn(`Valen:\nAn error occured while rendering Component '${tagName}', \n\nError sourced from: \`${match}\``, e);
        return match;
      }
    });
  }
  
  // After components, process widgets
  markup = initiateWidgets(markup);
  markup = initiateExtendedWidgets(markup);
 
  return lintPlaceholders(markup, isWidget);
}

const classRe = /\bclass\s*=\s*(["'])(.*?)\1/i;
const entRe = /<([a-zA-Z][a-zA-Z0-9\-]*)((?:\s+[^>]*?)?)(\/?>)/g;

function g(str, className) {
  return str.replace(entRe, (match, tagName, attrs, ending) => {
    // Already has class attribute?
    const existing = attrs.match(classRe);
    if (existing) {
      // Append to existing class
      const newClass = `${existing[2]} ${className}`;
      attrs = attrs.replace(classRe, `class=${existing[1]}${newClass}${existing[1]}`);
    } else {
      // Add class attribute before the ending
      attrs += ` class="${className}"`;
    }
    return `<${tagName}${attrs}${ending}`;
  });
}



const renderWidget = (instance, data, children) => {
  if (instance) {
    // Create a variable that holds the template
    const className = instance.className;
    let template = instance.template instanceof Function ? instance.template(data) : instance.template;
    
    if (children) {
      template = template.replaceAll("</>", children || "");
    }
    
    // Parse and initiate Nested Widgets
    const initiated = initiateWidgets(template, true);
    
    // Render parsed html
    let rendered = renderTemplate(initiated, data);
    
    const html = g(rendered, className);
  
    // Return processed html
    return html;
  }
}


// Pre‑computed lookup for HTML entities
const htmlEscapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

// Static replacer function (created once, reused)
function htmlEscapeReplacer(match) {
  return htmlEscapeMap[match];
}

function sanitizeString(str) {
  str = String(str);
  
  // 1. Escape only the five dangerous HTML characters (fast regex, no case‑insensitive)
  str = str.replace(/[&<>"']/g, htmlEscapeReplacer);
  
  // 2. Strip any "javascript:" substrings (case‑insensitive)
  //    This is a simple string‑removal pass, far cheaper than mixing it into the first regex.
  str = str.replace(/javascript:/gi, '');
  
  return str;
}



// Caches for compiled property accessors
const getterCache = new LRUCache();

// Helper that returns a cached function to access nested properties
function getValueFromPath(obj, path) {
  let getter = getterCache.get(path);
  if (!getter) {
    // Create a compiled function once per unique path
    getter = new Function("data", `return data.${path}`);
    getterCache.set(path, getter);
  }
  return getter(obj);
}



function renderTemplate(input, props, shouldSanitize) {
  const chunks = lexTemplate(input);
  
  // Early return if there's nothing to interpolate
  if (!chunks.length || (chunks.length === 1 && !chunks[0].isExpr)) {
    return input;
  }
  
  // 2. Use array + join instead of repeated string concatenation
  const parts = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const val = chunk.val;
    
    if (!chunk.isExpr) {
      parts.push(val);
      continue;
    }
    
    const trimmed = val.trim();
    const value = getValueFromPath(props, trimmed);
    
    // 3. Fix bug: only add placeholder when value is missing, not both
    if (value === undefined || value === null) {
      parts.push(`[${val}]`);
    } else {
      parts.push(shouldSanitize ? sanitizeString(value) : value);
    }
  }
  
  return parts.join('');
}


// Compute DOM depth
function getDepth(node) {
  let depth = 0;
  while (node.parentNode) {
    depth++;
    node = node.parentNode;
  }
  return depth;
}

function clearAllWidgetCaches() {
  initiateWidgets._propsCache?.clear();
  initiateExtendedWidgets._propsCache?.clear();
}

const componentRegex = /<(\/?[A-Z]\w*)(\s*\(\{[\s\S]*?}\))?\s*>/g;

const initiateExtendedWidgets = (markup) => {
  if (componentRegex.test(markup)) {
    // Step 1: Convert component tags to custom elements with va-attrs
    const convertedMarkup = markup.replace(componentRegex, (match, p1, p2) => {
      const isClosing = match.startsWith('</');
      const tagName = p1
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
      
      if (isClosing) {
        return `</${tagName.slice(2)}>`; // keep original closing logic
      }
      
      const attrs = (p2 || '')
        .replace(/\(\{/g, '{')
        .replace(/\}\)/g, '}')
        .replace(/"/g, '`');
      
      return `<${tagName} va-attrs="${attrs}">`;
    });
    
    // Step 2: Parse into a DocumentFragment
    const range = document.createRange();
    const fragment = range.createContextualFragment(convertedMarkup);
    
    // Props cache (static, shared across calls)
    if (!initiateExtendedWidgets._propsCache) {
      initiateExtendedWidgets._propsCache = new LRUCache();
    }
    
    // Step 3: Iteratively replace all va-attrs elements (including new ones)
    let hasComponents = true;
    while (hasComponents) {
      hasComponents = false;
      
      // Collect all elements with va-attrs, deepest first
      const elements = fragment.querySelectorAll('[va-attrs]');
      if (elements.length === 0) break;
      
      // Convert NodeList to array, sort by depth (descending)
      const sorted = Array.from(elements).sort((a, b) => {
        const depthA = getDepth(a);
        const depthB = getDepth(b);
        return depthB - depthA; // deepest first
      });
      
      for (const element of sorted) {
        // Only process if still in the DOM (could have been replaced by a parent)
        if (!element.parentNode) continue;
        
        const originalTag = element.tagName.toLowerCase()
          .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
          .replace(/^./, m => m.toUpperCase());
        const attrs = element.getAttribute('va-attrs');
        const content = element.innerHTML;
        const instance = widgets.get(originalTag);
        
        if (!instance) {
          console.warn(`Valen:\nWidget '${originalTag}' is not defined`);
          element.removeAttribute('va-attrs');
          continue;
        }
        
        // Compile props (cached)
        let data;
        if (initiateExtendedWidgets._propsCache.has(attrs)) {
          data = initiateExtendedWidgets._propsCache.get(attrs);
        } else {
          try {
            data = new Function(`return ${attrs}`)();
            initiateExtendedWidgets._propsCache.set(attrs, data);
          } catch (e) {
            console.warn(`Valen:\nFailed to parse props for ${originalTag}: ${e}`);
            element.removeAttribute('va-attrs');
            continue;
          }
        }
        
        // Render the widget
        const replacementHTML = instance(data, content);
        const replacementFragment = range.createContextualFragment(replacementHTML);
        
        // Replace the element in‑place
        element.parentNode.replaceChild(replacementFragment, element);
        
        // Since we've inserted new DOM, we need to re‑scan in the next while iteration
        hasComponents = true;
      }
    }
    
    // Step 4: Serialize the final fragment
    const div = document.createElement('div');
    div.appendChild(fragment);
    const finalMarkup = div.innerHTML;
    div.remove();
    
    // Step 5: Let normal widgets be processed
    return initiateWidgets(finalMarkup);
  } else {
    return markup;
  }
};

function addIndexToTemplate(str, index, instance) {
  str = lintPlaceholders(str);
  const chunks = lexTemplate(str);
  
  let combined = "";
  
  if (!chunks.length || chunks.length === 1 && !chunks[0].isExpr) return str;
  
  for (var i = 0, len = chunks.length; i < len; i++) {
    const chunk = chunks[i],
      val = chunk.val;
    
    if (!chunk.isExpr) {
      combined += val;
      continue;
    }
    
    combined += `[this.state[${index}].${val.trim()}]`;
  }
  
  const linted = lintPlaceholders(combined);
  
  return instance ? evaluateTemplate(linted, instance) : linted;
}


export { lexTemplate, evaluateTemplate, initiateComponents, initiateWidgets, renderWidget, renderTemplate, initiateExtendedWidgets, lintPlaceholders, addIndexToTemplate }
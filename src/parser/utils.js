import { ctx, components, LRUCache, widgets } from '../internal.js';
import { renderComponent } from '../dom/utils.js';


const lintedCache = new LRUCache();

// Matches both '@event=[' and 'attribute=['
// The regex stops exactly after the '[' character.
const startRegex = /(@[\w]+|[\w-:]+)\s*=\s*\[/g;

const lintPlaceholders = (html, isWidget) => {
  const entry = lintedCache.get(html);
  if (entry) return entry;

  let result = '';
  let lastIndex = 0;
  let match;

  // Reset regex state in case it was used previously
  startRegex.lastIndex = 0;

  while ((match = startRegex.exec(html)) !== null) {
    const attrName = match[1];
    const startIndex = startRegex.lastIndex; // Index right after the opening '['

    // Fast character scan to find the matching closing ']'
    let depth = 1;
    let i = startIndex;
    
    while (i < html.length && depth > 0) {
      // charCodeAt is slightly faster than string indexing in some engines
      const charCode = html.charCodeAt(i);
      if (charCode === 91) depth++;      // '['
      else if (charCode === 93) depth--; // ']'
      i++;
    }

    // If we found a perfectly balanced closing bracket
    if (depth === 0) {
      const endIndex = i - 1;
      const innerContent = html.substring(startIndex, endIndex);

      // Append all the HTML that came before this attribute
      result += html.substring(lastIndex, match.index);

      if (attrName.startsWith('@')) {
        if (!isWidget) {
          // Process Events
          result += `${attrName}="${innerContent.replaceAll("'", "`")}"`;
        } else {
          // If it's a widget event, leave it exactly as it was
          result += `${attrName}=[${innerContent}]`;
        }
      } else {
        // Process Directives & Standard Attributes
        result += `${attrName}="[${innerContent}]"`;
      }

      // Move our cursors forward to skip the content we just processed
      lastIndex = i;
      startRegex.lastIndex = i; 
    } 
  }

  // Append any remaining HTML after the last match
  result += html.substring(lastIndex);

  lintedCache.set(html, result);
  return result;
};



const lexerCache = new LRUCache(500);

// Pre-calculated ASCII constants
const C_SPACE = 32, C_TAB = 9, C_NL = 10, C_CR = 13;
const C_EQ = 61, C_GT = 62, C_LT = 60, C_SLASH = 47;
const C_QUOTE_D = 34, C_QUOTE_S = 39, C_BACKTICK = 96;
const C_BRACKET_O = 91, C_BRACKET_C = 93, C_BACKSLASH = 92;
const C_HYPHEN = 45, C_COLON = 58;

function isWhitespace(code) {
  return code === C_SPACE || code === C_TAB || code === C_NL || code === C_CR;
}

// Hoisted for V8 monomorphism — single object shape
const CHUNK_TEXT = { isExpr: false, val: '' };
const CHUNK_EXPR = { isExpr: true, val: '' };

function lexTemplate(templateString) {
  const cached = lexerCache.get(templateString);
  if (cached !== undefined) return cached;
  
  const chunks = [];
  const len = templateString.length;
  let depth = 0;
  let inQuote = false;
  let quoteCode = 0;
  let startIdx = 0;
  let exprStart = -1;
  
  // Attribute tracking state
  let currentAttrName = '';
  let gatheringAttrName = false;
  let attrNameStart = 0;
  
  // Local var for string to avoid repeated property access
  const str = templateString;

  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    
    // --- HTML ATTRIBUTE NAME TRACKING (depth === 0 only) ---
    if (depth === 0) {
      if (code === C_EQ) {
        gatheringAttrName = false;
        // Trim manually — faster than .trim() for short strings
        let s = attrNameStart;
        let e = i;
        while (s < e && isWhitespace(str.charCodeAt(s))) s++;
        while (e > s && isWhitespace(str.charCodeAt(e - 1))) e--;
        currentAttrName = str.slice(s, e);
      } else if (gatheringAttrName) {
        // Continue gathering — check if boundary hit
        if (isWhitespace(code) || code === C_GT || code === C_LT || code === C_SLASH) {
          gatheringAttrName = true;
          attrNameStart = i + 1;
        }
      } else if (isWhitespace(code) || code === C_GT || code === C_LT || code === C_SLASH) {
        gatheringAttrName = true;
        attrNameStart = i + 1;
      }
    }
    
    // --- NATIVE EVENT SKIPPING (depth === 0, quotes only) ---
    if (depth === 0 && (code === C_QUOTE_D || code === C_QUOTE_S)) {
      // Fast path: check attr name starts with 'on'
      if (currentAttrName.length >= 2 && 
          currentAttrName.charCodeAt(0) === 111 && // 'o'
          currentAttrName.charCodeAt(1) === 110) { // 'n'
        let closingIdx = i + 1;
        // Unroll first check for speed
        while (closingIdx < len) {
          if (str.charCodeAt(closingIdx) === code) {
            const prev = str.charCodeAt(closingIdx - 1);
            if (prev !== C_BACKSLASH) break;
          }
          closingIdx++;
        }
        if (closingIdx < len) {
          i = closingIdx;
          continue;
        }
      }
    }
    
    // --- INTERNAL QUOTE TRACKING (depth > 0) ---
    if (depth > 0) {
      if (code === C_QUOTE_D || code === C_QUOTE_S || code === C_BACKTICK) {
        const prev = str.charCodeAt(i - 1);
        if (prev !== C_BACKSLASH) {
          if (!inQuote) {
            inQuote = true;
            quoteCode = code;
          } else if (quoteCode === code) {
            inQuote = false;
            quoteCode = 0;
          }
        }
      }
    }
    
    // --- STRUCTURAL BRACKET TRACKING ---
    if (!inQuote) {
      if (code === C_BRACKET_O) {
        const prevCode = i > 0 ? str.charCodeAt(i - 1) : 0;
        // Skip static CSS framework classes [- or :[
        if (depth === 0 && (prevCode === C_HYPHEN || prevCode === C_COLON)) {
          continue;
        }

        if (depth === 0) {
          if (startIdx < i) {
            chunks.push({ isExpr: false, val: str.slice(startIdx, i) });
          }
          exprStart = i;
        }
        depth++;
      } else if (code === C_BRACKET_C) {
        if (depth > 0) {
          depth--;
          if (depth === 0) {
            chunks.push({ isExpr: true, val: str.slice(exprStart + 1, i) });
            startIdx = i + 1;
          }
        }
      }
    }
  }
  
  if (startIdx < len) {
    chunks.push({ isExpr: false, val: str.slice(startIdx) });
  }
  
  lexerCache.set(templateString, chunks);
  return chunks;
}


const ENTITY_REGEX = /&(gt|lt);/g;
const evaluatorCache = new LRUCache(500);

function evaluateTemplate(templateString, instance) {
  const chunks = lexTemplate(templateString);
  const chunkLen = chunks.length;
  
  // Fast exit: pure text
  if (chunkLen === 1 && !chunks[0].isExpr) return templateString;
  
  let added = '';
  let hasStateArg = true;
  
  if (instance.type === 'Atom') {
    const idx = instance.currentExecIndex;
    let cacheKey = instance._destCache;
    
    if (!cacheKey) {
      cacheKey = {};
      instance._destCache = cacheKey;
    }
    
    let destSrc = cacheKey[idx];
    if (destSrc === undefined) {
      const atomState = instance.state[idx];
      const keys = Object.keys(atomState);
      destSrc = keys.length ? `const{${keys.join(',')}}=this.state[this.currentExecIndex];` : '';
      cacheKey[idx] = destSrc;
    }
    
    added = destSrc;
    hasStateArg = false;
  }
  
  let combinedHTML = '';
  
  for (let i = 0; i < chunkLen; i++) {
    const chunk = chunks[i];
    
    if (!chunk.isExpr) {
      combinedHTML += chunk.val;
      continue;
    }
    
    const innerContent = chunk.val;
    ctx.currentTemplate = innerContent;
    
    // Entity decode + manual trim
    let ext = innerContent.replace(ENTITY_REGEX, (_, e) => e === 'gt' ? '>' : '<');
    let start = 0;
    let end = ext.length;
    
    while (start < end && ext.charCodeAt(start) <= 32) start++;
    while (end > start && ext.charCodeAt(end - 1) <= 32) end--;
    if (start !== 0 || end !== ext.length) ext = ext.slice(start, end);
    
    if (!ext) continue;
    
    const isGlobal = ext.charCodeAt(0) === 36; // '$'
    
    // Cache key must include destructuring context to avoid cross‑index contamination
    const cacheKey = hasStateArg ? ext : `${added}|${ext}`;
    let evaluator = evaluatorCache.get(cacheKey);
    
    if (!evaluator) {
      try {
        const source = isGlobal ?
          `return ${ext};` :
          (hasStateArg ? `with(state){return ${ext};}` : `${added}return ${ext};`);
        
        evaluator = hasStateArg ? new Function('state', source) : new Function(source);
        evaluatorCache.set(cacheKey, evaluator);
      } catch (err) {
        console.warn(`Valen Syntax Error in \`${innerContent}\`\n`, err);
        combinedHTML += `[${innerContent}]`;
        continue;
      }
    }
    
    try {
      const result = isGlobal ?
        evaluator() :
        (hasStateArg ? evaluator.call(instance, instance.state) : evaluator.call(instance));
      
      if (result != null && result === result) {
        combinedHTML += result;
      }
    } catch (error) {
      console.warn(`Valen Execution Error in \`${innerContent}\`\n`, error);
    }
  }
  
  ctx.currentTemplate = '';
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


export { lexTemplate, evaluateTemplate, initiateComponents, initiateWidgets, renderWidget, renderTemplate, initiateExtendedWidgets, lintPlaceholders }
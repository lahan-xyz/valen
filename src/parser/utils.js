import { ctx, components, LRUCache, sharedTemplate, stringBetween, updateQueue } from '../internal.js';
import { renderComponent } from '../dom/utils.js';



const lintPlaceholders = (html, isNugget) => {
  const eventRegex = /(@[\w]+)\s*=\s*\[((?:[^\[\]]|\[[^\[\]]*\])*)\]/g;
  const attributeRegex = /([\w-:]+)\s*=\s*\[((?:[^\[\]]|\[[^\[\]]*\])*)\]/g;

  // 1. Process Events
  if (!isNugget) {
    html = html.replace(eventRegex, (_, attrName, innerContent) => {
      return `${attrName}="${innerContent.replaceAll("'", "`")}"`;
    });
  }

  // 2. Process Directives & Standard Attributes
  return html.replace(attributeRegex, (_, attrName, innerContent) => {
    return `${attrName}="[${innerContent}]"`;
  });
};


const lexerCache = new LRUCache(500);

function lexTemplate(templateString) {
  if (lexerCache.has(templateString)) {
    return lexerCache.get(templateString);
  }
  
  const chunks = [];
  let depth = 0;
  let inQuote = false;
  let quoteChar = null;
  let startIdx = 0;
  let exprStart = -1;
  
  for (let i = 0; i < templateString.length; i++) {
    const char = templateString[i];
    
    // 1. ABSOLUTE NATIVE EVENT SKIPPING
    // Native 'on*' attributes are now strictly vanilla JS. We skip them completely
    // to protect native array literals like [1, 2]. Custom directives like @click
    // are ignored here and parsed beautifully below.
    if (depth === 0 && (char === '"' || char === "'")) {
      let j = i - 1;
      while (j > 0 && /\s/.test(templateString[j])) j--;
      
      if (templateString[j] === '=') {
        j--;
        while (j > 0 && /\s/.test(templateString[j])) j--;
        
        let nameEnd = j + 1;
        while (j >= 0 && !/[\s=>/<{}]/.test(templateString[j])) j--;
        const attrName = templateString.slice(j + 1, nameEnd);
        
        if (attrName.startsWith('on')) {
          let closingIdx = i + 1;
          while (closingIdx < templateString.length) {
            if (templateString[closingIdx] === char && templateString[closingIdx - 1] !== '\\') {
              break;
            }
            closingIdx++;
          }
          if (closingIdx < templateString.length) {
            i = closingIdx; // Skip the entire native JS event string safely
            continue;
          }
        }
      }
    }
    
    // 2. SCOPED QUOTE TRACKING (For quotes INSIDE Valen expressions)
    if (depth > 0 && (char === '"' || char === "'" || char === '`') && templateString[i - 1] !== '\\') {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (quoteChar === char) {
        inQuote = false;
        quoteChar = null;
      }
    }
    
    // 3. BRACKET TRACKING
    if (!inQuote) {
      if (char === '[') {
        if (depth === 0) {
          if (startIdx < i) {
            chunks.push({ isExpr: false, val: templateString.slice(startIdx, i) });
          }
          exprStart = i;
        }
        depth++;
      } else if (char === ']') {
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
  
  // 4. CLEANUP
  if (startIdx < templateString.length) {
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
        // PERFORMANCE KEY: We pass `data` as a direct parameter to the Function.
        // This is significantly faster and safer than `with(this.data)`.
        const source = isGlobal ?
          `return ${ext};` :
          `with (data) { return ${ext}; }`;
        
        // Pass 'data' as the argument name
        evaluator = new Function("data", source);
        evaluatorCache.set(ext, evaluator);
      } catch (err) {
        console.warn(`Valen Syntax Error in \`${innerContent}\`\n`, err);
        combinedHTML += `[${innerContent}]`; // Output raw bracket if it fails
        continue;
      }
    }
    
    try {
      // Pass instance.data directly into the function execution
      const parsed = isGlobal ? evaluator() : evaluator.call(instance, instance.data);
      
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


function initiateNuggets(markup, isNugget) {
  const nuggetRegex = /<([A-Z]\w*)\s*\{([\s\S]*?)\}\s*\/>/g;
  
  // Shared cache for compiled props (across all calls)
  if (!initiateNuggets._propsCache) {
    initiateNuggets._propsCache = new LRUCache();
  }
  
  const replacedMarkup = markup.replace(nuggetRegex, (match, name, propsString) => {
    // propsString = the object literal inside { } (trimmed later)
    const trimmedProps = `{ ${propsString.trim()} }`;
    const cacheKey = `${propsString.trim()}`;
    
    let evaluated;
    try {
      // Retrieve or compile the props function
      let propsFn = initiateNuggets._propsCache.get(cacheKey);
      if (!propsFn) {
        propsFn = new Function(`return ${trimmedProps}`);
        initiateNuggets._propsCache.set(cacheKey, propsFn);
      }
      const d = propsFn();
      const instance = nuggets.get(name);
      
      if (instance) {
        evaluated = renderNugget(instance, d);
      } else {
        console.warn(`Valen:\nNugget '${name}' is not defined`);
        evaluated = match; // leave original markup as fallback
      }
    } catch (e) {
      console.warn(`Valen:\nAn error occured while rendering Nugget '${name}': ${e}\n\nError sourced from: \`${match}\``);
      evaluated = match; // keep original on error
    }
    return evaluated;
  });
  
  return lintPlaceholders(replacedMarkup, isNugget);
}


const COMPONENT_SELF_CLOSING_REGEX = /<([A-Z]\w*)\s*\/>/g;

function initiateComponents(markup, isNugget, fromAtom) {
  markup = lintPlaceholders(markup, isNugget);
  
  // If not a nugget, replace self-closing component tags with rendered output
  if (!isNugget && !fromAtom) {
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
  
  // After components, process nuggets
  markup = initiateNuggets(markup);
  markup = initiateExtendedNuggets(markup);

  return lintPlaceholders(markup, isNugget);
}


function g(str, className) {
  sharedTemplate.innerHTML = str;
  
  const children = sharedTemplate.content.querySelectorAll("*");
  
  for (let i = 0, len = children.length; i < len; i++) {
    children[i].classList.add(className);
  }
  
  return sharedTemplate.innerHTML;
}



const renderNugget = (instance, data, isExtended, children) => {
  if (instance) {
    const className = instance.className;
    // Create a variable that holds the template 
    let template = instance.template instanceof Function ? instance.template(data) : instance.template;
    
    if (isExtended) {
      template = template.replaceAll("</>", children);
    }
    
    // Parse and initiate Nested Nuggets
    const initiated = initiateNuggets(template, true);
    
    // Render parsed html
    let rendered = renderTemplate(initiated, data);
    
    const html = g(rendered, className);
    if (!instance.stylesheetInitiated) {
      // Initiate stylesheet for instance 
      initiateStyleSheet("." + className, instance, true);
      instance.stylesheetInitiated = true;
    }
    
    // Return processed html
    return html;
  }
}


// Sanitizes a string to prevent potential XSS attacks.
function sanitizeString(str) {
  str = String(str);
  
  // Single‑pass regex: escape HTML special chars & remove "javascript:"
  return str.replace(/[&<>"']|javascript:/gi, match => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default: // matched "javascript:" (case‑insensitive)
        return '';
    }
  });
}



function renderTemplate(input, props, shouldSanitize) {
  const chunks = lexTemplate(input);
  if (!chunks.length || chunks.length === 1 && !chunks[0].isExpr) return input;
  
  let combined = "";
  
  for (var i = 0, len = chunks.length; i < len; i++) {
    const chunk = chunks[i],
      val = chunk.val;
    
    if (!chunk.isExpr) {
      combined += val;
      continue;
    }
    
    const trimmed = val.trim();
    const value = props[trimmed];
    
    if (value === undefined || value === null) {
      combined += `[${val}]`; // keep placeholder for debugging
    }
    
    combined += shouldSanitize ? sanitizeString(value) : value;
  }
  
  return combined;
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

function clearAllNuggetCaches() {
  initiateNuggets._propsCache?.clear();
  initiateExtendedNuggets._propsCache?.clear();
}

const initiateExtendedNuggets = (markup) => {
  // Step 1: Convert component tags to custom elements with va-attrs
  const componentRegex = /<(\/?[A-Z]\w*)(\s*\(\{[\s\S]*?}\))?\s*>/g;
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
  if (!initiateExtendedNuggets._propsCache) {
    initiateExtendedNuggets._propsCache = new LRUCache();
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
      const instance = nuggets.get(originalTag);
      
      if (!instance) {
        console.warn(`Valen:\nNugget '${originalTag}' is not defined`);
        element.removeAttribute('va-attrs');
        continue;
      }
      
      // Compile props (cached)
      let data;
      if (initiateExtendedNuggets._propsCache.has(attrs)) {
        data = initiateExtendedNuggets._propsCache.get(attrs);
      } else {
        try {
          data = new Function(`return ${attrs}`)();
          initiateExtendedNuggets._propsCache.set(attrs, data);
        } catch (e) {
          console.warn(`Valen:\nFailed to parse props for ${originalTag}: ${e}`);
          element.removeAttribute('va-attrs');
          continue;
        }
      }
      
      // Render the nugget
      const replacementHTML = renderNugget(instance, data, true, content);
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
  
  // Step 5: Let normal nuggets be processed
  return initiateNuggets(finalMarkup);
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
    
    combined += `[this.data[${index}].${val.trim()}]`;
  }
  
  const linted = lintPlaceholders(combined);
  
  return instance ? evaluateTemplate(linted, instance) : linted;
}


export { lexTemplate, evaluateTemplate, initiateComponents, initiateNuggets, renderNugget, renderTemplate, initiateExtendedNuggets, lintPlaceholders, addIndexToTemplate }
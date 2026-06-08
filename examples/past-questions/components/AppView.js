import { Component, globalState } from 'queflow'
import QuestionCard from '../atoms/QuestionCard.js'

// Subject list
const SUBJECTS = ['Mathematics', 'English', 'Chemistry', 'Physics']

const YEARS = Array.from({ length: 2025 - 1978 + 1 }, (_, i) => 1978 + i)

globalState('$pq', {
  subject: SUBJECTS[0],
  year: YEARS[0]
}, true)

async function loadSubject(subject, year) {
  const module = await import(`../scraper/past-questions/${subject.toLowerCase()}.min.js`);
  return module.default[`year_${year}`] || [];
}

const AppView = new Component("AppView", {
  data: {
    currentSubject: $pq.subject,
    currentYear: $pq.year,
    currentPage: 1,
    totalPages: 6
  },
  
  created(data) {
    this.isRendered = false;
    
    this.computePageIdxRange = () => {
      const first = (data.currentPage * 10) - 10
      const second = (data.currentPage * 10)
      return [first, second]
    }
    
    // Optimized
    this.transformQuestObj = (questionsArray, idxStart) => {
      const len = questionsArray.length;
      const result = new Array(len); // Pre-allocate memory
      
      for (let i = 0; i < len; i++) {
        // Prefix increment bumps the number before assignment
        result[i] = { ...questionsArray[i], quest_no: ++idxStart, year: data.currentYear };
      }
      
      return result;
    }
    
    this.loadAndRender = async () => {
      const questions = await loadSubject(data.currentSubject, data.currentYear)
      const [first, second] = this.computePageIdxRange()
      const sliced = questions.slice(first, second)
      const transformed = this.transformQuestObj(sliced, first)
      // update total pages dynamically
      data.totalPages = Math.ceil(questions.length / 10) || 1
      
      if (this.isRendered) {
        QuestionCard.set(transformed)
      } else {
        QuestionCard.renderWith(transformed);
        this.isRendered = true;
      }
    }
    
    // Page navigation
    this.previousPage = () => {
      if (data.currentPage > 1) {
        data.currentPage -= 1
      }
    }
    
    this.nextPage = () => {
      if (data.currentPage < data.totalPages) {
        data.currentPage += 1
      }
    }
    
    this.changeSubject = (value) => {
      data.currentSubject = value;
      data.currentPage = 1; // Reset to page 1
    }
    
    this.changeYear = (value) => {
      data.currentYear = parseInt(value);
      data.currentPage = 1; // Reset to page 1
    }
  },
  
  onUpdate({ key, newVal: value }) {
    switch (key) {
      case 'currentSubject':
        $pq.subject = value;
        break;
      
      case 'currentYear':
        $pq.year = value;
        break;
      
      default:
        this.loadAndRender();
        return true;
    }
    
    this.loadAndRender();
    return true;
  },
  
  async run(data) {
    // Initial load
    await this.loadAndRender()
  },
  
  template: (data) => `
    <div class="app-container">
      <header class="app-header">
        <h1 class="app-title">JAMB Past Questions</h1>
        <div class="app-controls">
          <select aria-label="Select Subject" class="app-select" q:value=[ currentSubject ] onchange=[ 
            const { value } = e.target;
            this.changeSubject(value);
           ]>
            ${SUBJECTS.map(sub => `<option value="${sub}" ${ sub === data.currentSubject ? 'selected' : '' }>${sub}</option>`).join('')}
          </select>
          <select aria-label="Select Year" class="app-select"
            q:value=[ currentYear ]
            onchange=[
            const { value } = e.target;
            this.changeYear(value);
          ]>
            ${YEARS.map(year => `<option value="${year}"  ${ year === data.currentYear ? 'selected' : '' }>${year}</option>`).join('')}
          </select>
          <div class="page-nav">
            <button class="page-btn" onclick=[ this.previousPage() ]>← Prev</button>
            <span class="page-indicator">[ currentPage ] / [ totalPages ]</span>
            <button class="page-btn" onclick=[ this.nextPage() ]>Next →</button>
          </div>
        </div>
      </header>
      <main id="questions-container"></main>
    </div>
  `,
  
  stylesheet: {
    ".app-container": `
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem 1.2rem;
    `,
    ".app-header": `
      text-align: center;
      margin-bottom: 2rem;
    `,
    ".app-title": `
      font-size: 2.2rem;
      font-weight: 700;
      margin: 0 0 1.5rem 0;
      background: linear-gradient(to right, #4ade80, #22c55e);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    `,
    ".app-controls": `
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.8rem;
      align-items: center;
    `,
    ".app-select": `
      background: #1a1a24;
      border: 1px solid #2e2e3e;
      border-radius: 30px;
      padding: 0.6rem 1.4rem;
      color: #ccc;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
  
      /* remove browser default appearance (including Safari) */
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
  
      /* custom dropdown arrow */
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 1rem center;
      background-size: 1em;
  
      /* ensure width is determined by content + padding, not by default sizing */
      min-width: 18rem;
    `,
    ".app-select:hover, .app-select:focus": `
      border-color: #4ade80;
      box-shadow: 0 0 0 2px rgba(74,222,128,0.3);
    `,
    ".page-nav": `
      display: flex;
      align-items: center;
      gap: 0.6rem;
    `,
    ".page-btn": `
      all: unset;
      background: #1a1a24;
      border: 1px solid #2e2e3e;
      border-radius: 30px;
      padding: 0.6rem 1.2rem;
      color: #ccc;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, color 0.2s, transform 0.1s;
    `,
    ".page-btn:hover": `
      background: #252535;
      color: #fff;
      transform: translateY(-1px);
    `,
    ".page-btn:active": `
      transform: scale(0.96);
    `,
    ".page-indicator": `
      font-size: 0.9rem;
      font-weight: 500;
      color: #888;
      min-width: 3rem;
      text-align: center;
    `,
    "#questions-container": `
      margin-top: 1rem;
    `,
    // Responsive
    "@media (max-width: 600px)": `
      .app-title {
        font-size: 1.8rem;
      }
      .app-controls {
        flex-direction: column;
        align-items: stretch;
      }
      .page-nav {
        justify-content: center;
      }
    `,
  },
})

export default AppView
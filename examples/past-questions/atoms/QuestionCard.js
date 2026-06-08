import { Atom } from 'queflow'
import Text from '../nuggets/Text.js'

const QuestionCard = new Atom("QuestionCard", {
  template: () => {
    return (`
    <div class="qc-card">
      <div class="qc-header">
        <div class="qc-badge">
          <span class="qc-badge-label">Q</span>
          <span class="qc-badge-num">[ quest_no ]</span>
        </div>
        <span class="qc-year">[ year ]</span>
      </div>

      <div class="qc-image-wrap" q:show=[ src ]>
        <img class="qc-image" src="https://jamb-past-questions.vercel.app/src/scraper/images/[ src ]" loading="lazy" alt="[ year ] Question diagram" />
      </div>

      <div class="qc-body">
        <p class="qc-text" q:text="[ question ]"></p>
        <div class="qc-options">
          <button class="qc-opt" data-letter="A">
            <span class="qc-opt-letter">A</span>
            <span class="qc-opt-text">[ options[0] ]</span>
          </button>
          <button class="qc-opt" data-letter="B">
            <span class="qc-opt-letter">B</span>
            <span class="qc-opt-text">[ options[1] ]</span>
          </button>
          <button class="qc-opt" data-letter="C">
            <span class="qc-opt-letter">C</span>
            <span class="qc-opt-text">[ options[2] ]</span>
          </button>
          <button class="qc-opt" data-letter="D">
            <span class="qc-opt-letter">D</span>
            <span class="qc-opt-text">[ options[3] ]</span>
          </button>
          <button class="qc-opt" data-letter="E" q:show=[ options[4] ]>
            <span class="qc-opt-letter">E</span>
            <span class="qc-opt-text">[ options[4] ]</span>
          </button>
        </div>
      </div>
    </div>
  `)
  },
  
  stylesheet: {
    // ----- card shell (optimised) -----
    ".qc-card": `
      background: radial-gradient(circle at 20% 20%, #1b1b28, #0d0d14);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 24px;
      padding: 2rem 1.8rem;
      display: flex;
      flex-direction: column;
      gap: 1.4rem;
      box-shadow: 0 8px 20px rgba(0,0,0,0.5);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      margin-block: 32px;
      position: relative;
      overflow: hidden;
    `,
    ".qc-card:hover": `
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(0,0,0,0.6), 0 0 0 1px rgba(74,222,128,0.25);
    `,
    
    // ----- header -----
    ".qc-header": `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 0.9rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    `,
    ".qc-badge": `
      display: flex;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #4ade80, #22c55e);
      color: #000;
      font-weight: 800;
      font-size: 1.3rem;
      padding: 0.3rem 1.2rem 0.3rem 0.8rem;
      border-radius: 40px;
      box-shadow: 0 0 16px rgba(74,222,128,0.4);
      letter-spacing: 0.5px;
    `,
    ".qc-badge-label": `
      font-size: 0.85rem;
      background: rgba(0,0,0,0.2);
      padding: 0.1rem 0.5rem;
      border-radius: 20px;
      margin-right: 2px;
    `,
    ".qc-badge-num": `
      font-variant-numeric: tabular-nums;
    `,
    ".qc-year": `
      font-size: 0.85rem;
      font-weight: 500;
      color: #888;
      letter-spacing: 0.6px;
      background: rgba(255,255,255,0.04);
      padding: 0.25rem 0.9rem;
      border-radius: 30px;
      border: 1px solid rgba(255,255,255,0.05);
    `,
    
    // ----- image -----
    ".qc-image-wrap": `
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    `,
    ".qc-image": `
      width: 100%;
      min-height: 50px;
      display: block;
      background: #0a0a0f;
      object-fit: contain;
      padding: 0.6rem;
    `,
    
    // ----- body -----
    ".qc-body": `
      display: flex;
      flex-direction: column;
      gap: 1.4rem;
    `,
    ".qc-text": `
      font-size: 1.05rem;
      font-weight: 450;
      line-height: 1.75;
      color: #e4e4e7;
      margin: 0;
    `,
    
    // ----- options -----
    ".qc-options": `
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    `,
    ".qc-opt": `
      all: unset;
      display: flex;
      align-items: center;
      gap: 0.9rem;
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      padding: 0.85rem 1.1rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.15s;
      color: #ccc;
      font-size: 0.90rem;
      font-weight: 450;
      position: relative;
    `,
    ".qc-opt:hover": `
      background: rgba(255,255,255,0.07);
      border-color: rgba(255,255,255,0.15);
      transform: translateX(4px);
    `,
    ".qc-opt:active": `
      transform: scale(0.985);
    `,
    ".qc-opt-letter": `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #232330;
      font-weight: 700;
      font-size: 0.8rem;
      color: #aaa;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    `,
    ".qc-opt:hover .qc-opt-letter": `
      background: #4ade80;
      color: #000;
      box-shadow: 0 0 10px #4ade80;
    `,
    ".qc-opt-text": `
      flex: 1;
    `,
    
    // ----- responsive -----
    "@media (max-width: 500px)": {
      ".qc-card": `
        padding: 1.4rem 1.1rem;
        border-radius: 18px;
        gap: 1rem;
      `,
      ".qc-text": `
        font-size: 1rem;
      `,
      ".qc-opt": `
        padding: 0.7rem 0.9rem;
        font-size: 0.88rem;
      `,
      ".qc-badge": `
        font-size: 1.1rem;
        padding: 0.25rem 0.9rem 0.25rem 0.6rem;
      `,
    },
  },
  
  isReactive: true,
}, "questions-container")

export default QuestionCard
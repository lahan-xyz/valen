const axios = require("axios")
const cheerio = require("cheerio");
const fs = require('fs');
const path = require('path');


let no_of_questions_fetched = 0;

const imagesDir = path.resolve(__dirname, '.', 'images');
const pqDir = path.resolve(__dirname, '.', 'past-questions');

async function downloadImage(url, filepath) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
    });
    
    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (err) {
    console.error(`Failed to download ${url}:`, err.message);
  }
}

function saveAsFile(fileName, contents) {
  
  const filePath = path.join(pqDir, fileName);
  
  fs.writeFile(filePath, contents, (err) => {
    if (err) {
      console.error('Error writing file:', err);
    }
  });
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));


async function fetchWithRetry(url, headers, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, { headers });
    } catch (err) {
      if (err.code === 'ECONNRESET' && i < retries - 1) {
        await delay(2000 + Math.random() * 3000);
      } else {
        throw err;
      }
    }
  }
}

async function fetchQuestions(subject = "mathematics", type = "jamb", year = 2025, imageOnly = false) {
  const no_of_pages = subject === "english-language" ? 12 : 8;
  const outArr = [];
  let imgCounter = 0;
  const fetchNExtract = async () => {
    for (var i = 1; i <= no_of_pages; i++) {
      const url = `https://myschool.ng/classroom/${subject}?exam_type=${type}&exam_year=${year}&topic=&page=${i}`
      
      const response = await fetchWithRetry(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          "Referer": "https://myschool.ng/",
          "Accept": "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      
      const data = await response.data;
      
      const $ = cheerio.load(data);
      const items = $('.question-item');
      
      items.each((_, el) => {
        const p = $(el).find('p');
        const li = $(el).find('li');
        const img = $(el).find('img');
        let question = "";
        
        p.each((i, el) => {
          question += "\\n"+$(el).html();
        });
        
        question = question.slice(2);
        
        const options = li.map((idx, liEl) => {
          const rawText = $(liEl).text();
          return rawText.slice(15).trim();
        }).get(); // plain array of strings
        
        const src = img.eq(0).attr('src');
        let fileName = ""
        // Download images
        if (src) {
          const dotIndex = src.lastIndexOf(".");
   
          fileName = `${subject}_${year}_${imgCounter}${src.slice(dotIndex)}`;
          imgCounter++;
          const filepath = path.join(imagesDir, fileName);
          // 🛑 Skip if already downloaded
          if (fs.existsSync(filepath)) {
            console.log(`⏭️ Skipping (already exists): ${filepath}`);
          } else {
            downloadImage(src, filepath);
          }
          
        }
        
        if (!imageOnly) outArr.push(src ? { src: fileName, question, options } : { question, options });
      });
    }
  }
  
  await fetchNExtract();
  return outArr;
}

// .question-item p, li

/*(async () => {
  const q_a = await fetchQuestions();
  console.log(q_a)
})();
*/

function fetchJambPastQuestions(from = 2025, to = 2026) {
  const yearDiff = to - from;
  let progress = 0;
  
  const subjects = ["chemistry"] /*, "english-language", "physics", "chemistry"];*/
  
  subjects.forEach(async (subject) => {
    const qObj = {},
      total_no_of_questions = subject === "english-language" ? 60 * yearDiff : 40 * yearDiff;
    
    for (var i = from; i < to; i++) {
      const questions = await fetchQuestions(subject, "jamb", i);
      qObj[`year_${i}`] = questions;
      no_of_questions_fetched += questions.length;
      progress = ((no_of_questions_fetched / total_no_of_questions) * 100);
      
      console.log(`${no_of_questions_fetched} of ${total_no_of_questions} (${progress.toFixed(2)}%)`);
    }
    
    const beautified = JSON.stringify(qObj, null, 2);
    
    const subjectName = subject === "english-language" ? "ENGLISH" : subject.toUpperCase();
    
    const contents = `const ${subjectName} = ${beautified}\n\n export default ${subjectName};`;
    
    saveAsFile(`${subject}.js`, contents);
  });
}

fetchJambPastQuestions(1978, 2025);

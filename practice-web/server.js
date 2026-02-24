const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { marked } = require('marked');

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const APP_DOMAIN = process.env.APP_DOMAIN || 'saa-practice.local';
const PRACTICES_DIR = process.env.PRACTICES_DIR
  ? path.resolve(process.env.PRACTICES_DIR)
  : path.resolve(__dirname, 'practices');
const EXAM_FILE = 'S-practice-exam.md';
const EXAM_DURATION_SECONDS = 130 * 60;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function slugFromFilename(filename) {
  return filename.replace(/\.md$/i, '').toLowerCase();
}

function titleFromMarkdown(filename, content) {
  const firstHeading = content.match(/^\s*#\s+(.+)$/m);
  if (firstHeading) {
    return firstHeading[1].trim();
  }
  return filename.replace(/\.md$/i, '');
}

function parseExam(content) {
  const questionRegex = /###\s*Câu\s*(\d+)\s*\n([\s\S]*?)(?=\n---\n)/g;
  const answerRegex = /\*\*Câu\s*(\d+)\s*:\s*([A-D])\*\*/g;

  const answers = new Map();
  let answerMatch;
  while ((answerMatch = answerRegex.exec(content)) !== null) {
    answers.set(Number(answerMatch[1]), answerMatch[2]);
  }

  const questions = [];
  let questionMatch;
  while ((questionMatch = questionRegex.exec(content)) !== null) {
    const number = Number(questionMatch[1]);
    const block = questionMatch[2].trim();

    const optionRegex = /\*\*([A-D])\.\*\*\s*([\s\S]*?)(?=\n\n\*\*[A-D]\.\*\*|$)/g;
    const options = {};
    let optionMatch;
    while ((optionMatch = optionRegex.exec(block)) !== null) {
      options[optionMatch[1]] = optionMatch[2].trim();
    }

    const questionText = block
      .replace(/\*\*[A-D]\.\*\*[\s\S]*?(?=\n\n\*\*[A-D]\.\*\*|$)/g, '')
      .trim();

    if (questionText && Object.keys(options).length === 4) {
      questions.push({
        number,
        question: questionText,
        options,
        correctAnswer: answers.get(number) || null,
      });
    }
  }

  return questions.sort((a, b) => a.number - b.number);
}

app.get('/api/config', (req, res) => {
  res.json({
    appDomain: APP_DOMAIN,
    examDurationSeconds: EXAM_DURATION_SECONDS,
  });
});

app.get('/api/docs', async (req, res) => {
  try {
    const files = await fs.readdir(PRACTICES_DIR);
    const markdownFiles = files.filter((file) => file.toLowerCase().endsWith('.md'));

    const docs = await Promise.all(
      markdownFiles.map(async (filename) => {
        const fullPath = path.join(PRACTICES_DIR, filename);
        const content = await fs.readFile(fullPath, 'utf8');
        return {
          filename,
          slug: slugFromFilename(filename),
          title: titleFromMarkdown(filename, content),
          isExam: filename === EXAM_FILE,
        };
      })
    );

    docs.sort((a, b) => {
      if (a.isExam && !b.isExam) return -1;
      if (!a.isExam && b.isExam) return 1;
      return a.filename.localeCompare(b.filename);
    });

    res.json(docs);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load markdown files.', error: error.message });
  }
});

app.get('/api/docs/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const files = await fs.readdir(PRACTICES_DIR);
    const matched = files.find(
      (file) => file.toLowerCase().endsWith('.md') && slugFromFilename(file) === slug.toLowerCase()
    );

    if (!matched) {
      return res.status(404).json({ message: 'Document not found.' });
    }

    const content = await fs.readFile(path.join(PRACTICES_DIR, matched), 'utf8');
    const html = marked.parse(content);

    res.json({
      filename: matched,
      slug,
      title: titleFromMarkdown(matched, content),
      markdown: content,
      html,
      isExam: matched === EXAM_FILE,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load document.', error: error.message });
  }
});

app.get('/api/exam', async (req, res) => {
  try {
    const examContent = await fs.readFile(path.join(PRACTICES_DIR, EXAM_FILE), 'utf8');
    const questions = parseExam(examContent);

    res.json({
      totalQuestions: questions.length,
      examDurationSeconds: EXAM_DURATION_SECONDS,
      questions: questions.map(({ correctAnswer, ...question }) => question),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to parse exam.', error: error.message });
  }
});

app.post('/api/exam/score', async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ message: 'Invalid answers payload.' });
    }

    const examContent = await fs.readFile(path.join(PRACTICES_DIR, EXAM_FILE), 'utf8');
    const questions = parseExam(examContent);

    let correct = 0;
    const details = questions.map((question) => {
      const userAnswer = answers[String(question.number)] || null;
      const isCorrect = userAnswer === question.correctAnswer;
      if (isCorrect) correct += 1;
      return {
        number: question.number,
        userAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
      };
    });

    const total = questions.length;
    const scaledScore = Math.round((correct / total) * 1000);
    const passed = scaledScore >= 720;

    res.json({
      total,
      correct,
      incorrect: total - correct,
      scaledScore,
      passed,
      details,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to calculate exam score.', error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`AWS SAA Practice app running at http://${APP_DOMAIN}:${PORT}`);
  console.log(`Fallback local URL: http://localhost:${PORT}`);
});

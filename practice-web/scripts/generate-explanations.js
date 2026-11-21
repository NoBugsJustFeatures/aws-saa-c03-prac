#!/usr/bin/env node
// practice-web/scripts/generate-explanations.js
//
// One-off, offline: asks a local OpenAI-compatible gateway (OmniRoute) to
// explain each dump question, caches the text in data/explanations.json
// (keyed by dump number) and patches it into data/quizzes/*.json. The deployed
// site never calls an LLM; it only serves the saved text.
//
//   docker compose up -d omniroute        # then connect providers at :20128
//   node scripts/generate-explanations.js [--limit 20] [--concurrency 2]
// Resumable: questions already in the cache are skipped.
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'data');
const QUIZ_DIR = path.join(DATA, 'quizzes');
const CACHE = path.join(DATA, 'explanations.json');
const BASE = (process.env.OMNIROUTE_URL || 'http://localhost:20128').replace(/\/$/, '');
const MODEL = process.env.OMNIROUTE_MODEL || 'auto';
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const LIMIT = arg('limit', Infinity);
const CONCURRENCY = arg('concurrency', 2);

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1) + '\n');

function loadQuestions() {
  const byNo = new Map();
  for (const f of fs.readdirSync(QUIZ_DIR).filter((x) => x.endsWith('.json'))) {
    for (const q of JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), 'utf8')).questions) {
      if (q.dumpNo && !byNo.has(q.dumpNo)) byNo.set(q.dumpNo, q);
    }
  }
  return [...byNo.values()].sort((a, b) => a.dumpNo - b.dumpNo);
}

function prompt(q) {
  const opts = Object.entries(q.options).map(([k, v]) => `${k}. ${v}`).join('\n');
  return `You are tutoring someone for the AWS Certified Solutions Architect Associate (SAA-C03) exam.
Question:
${q.question}

${opts}

The correct answer is: ${q.correctAnswers.join(', ')}.

Write a short explanation in plain English (max 130 words) in exactly this shape:
Why it is correct: <one or two sentences naming the requirement in the question that decides it>
Why the others are wrong: <one short clause per wrong option, starting with its letter>
Exam tip: <one short sentence about the keyword or pattern to remember>
Do not restate the question. Do not use markdown.`;
}

async function ask(q, attempt = 1) {
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk_omniroute' },
      body: JSON.stringify({ model: MODEL, temperature: 0.2, messages: [{ role: 'user', content: prompt(q) }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.json()).choices?.[0]?.message?.content?.trim();
    if (!text || text.length < 60 || !/Why it is correct/i.test(text)) throw new Error('unusable reply');
    return text;
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return ask(q, attempt + 1);
  }
}

function patchQuizzes() {
  for (const f of fs.readdirSync(QUIZ_DIR).filter((x) => x.endsWith('.json'))) {
    const p = path.join(QUIZ_DIR, f);
    const quiz = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const q of quiz.questions) if (cache[q.dumpNo]) q.explanation = cache[q.dumpNo];
    fs.writeFileSync(p, JSON.stringify(quiz, null, 2) + '\n');
  }
}

async function main() {
  const todo = loadQuestions().filter((q) => !cache[q.dumpNo]).slice(0, LIMIT);
  console.log(`${todo.length} to generate via ${BASE} (model ${MODEL}), ${Object.keys(cache).length} cached`);
  let done = 0, failed = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const q = queue.shift();
      try { cache[q.dumpNo] = await ask(q); save(); done++; }
      catch (e) { failed++; console.error(`#${q.dumpNo} failed: ${e.message}`); }
      if ((done + failed) % 10 === 0) console.log(`${done} done, ${failed} failed`);
    }
  }));
  patchQuizzes();
  console.log(`finished: ${done} generated, ${failed} failed, ${Object.keys(cache).length} cached total`);
}
main();

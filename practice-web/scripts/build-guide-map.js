#!/usr/bin/env node
// Maps every quiz question to the study-guide sections (practices/*.md) that
// cover it. Pure keyword retrieval (TF-IDF), no LLM. Output: data/guide-map.json
//   { "<slug>:<number>": [ { doc, h, title, heading }, ... ] }
// `h` is the index of the heading among all headings of the rendered doc (code
// fences skipped); the client tags rendered headings with the same index.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRACTICES = path.join(ROOT, 'practices');
const QUIZZES = path.join(ROOT, 'data', 'quizzes');
const OUT = path.join(ROOT, 'data', 'guide-map.json');
const SKIP = new Set(['README.md', 'SUMMARY.md', 'S-practice-exam.md', '00-tong-quan-overview.md']);
const MAX_RESULTS = 3;
const MAX_PER_DOC = 2;

const STOP = new Set(('a an the and or of to in on for with by from at as is are be been was were it its this that these those ' +
  'which what who how when where why will would should could can may must not no yes if then than so such into over after before ' +
  'under using use used uses has have had do does did company application applications solution solutions solutions architect ' +
  'requirement requirements least most more less new existing need needs needed want wants following each all any both also ' +
  'one two three four five only data amazon aws service services based while during between across within without ' +
  'cost-effective operational overhead meet meets provide provides allow allows ensure ensures able create created ' +
  'configure configured set run runs running choose option options correct answer').split(/\s+/));

function tokens(text) {
  const out = [];
  const words = String(text).toLowerCase().replace(/[`*_#>|()[\]{},;:"'!?]/g, ' ').split(/\s+/);
  for (const w of words) {
    const t = w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (t.length < 2 || STOP.has(t) || /^\d+$/.test(t)) continue;
    out.push(t);
  }
  const bigrams = [];
  for (let i = 0; i < out.length - 1; i++) bigrams.push(out[i] + ' ' + out[i + 1]);
  return { uni: out, bi: bigrams };
}

function parseDoc(filename) {
  const lines = fs.readFileSync(path.join(PRACTICES, filename), 'utf8').split('\n');
  let docTitle = filename;
  const sections = [];
  let cur = null;
  let fence = false;
  let hIndex = -1;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      hIndex++;
      const level = m[1].length;
      const heading = m[2].replace(/[*`]/g, '').trim();
      if (level === 1 && hIndex === 0) docTitle = heading;
      // Sections are h2/h3; h4+ text folds into the enclosing section.
      if (level >= 2 && level <= 3) {
        cur = { doc: filename.replace(/\.md$/i, '').toLowerCase(), h: hIndex, heading, body: [] };
        sections.push(cur);
        continue;
      }
    }
    if (cur) cur.body.push(line);
  }
  return sections.map((s) => ({ ...s, title: docTitle, text: s.body.join('\n') }));
}

const sections = fs.readdirSync(PRACTICES)
  .filter((f) => f.endsWith('.md') && !SKIP.has(f))
  .flatMap(parseDoc)
  .filter((s) => s.text.trim().length > 80);

// Index: per-section term frequencies (heading counts x4), document frequency.
const df = new Map();
for (const s of sections) {
  const tf = new Map();
  const add = (list, w) => list.forEach((t) => tf.set(t, (tf.get(t) || 0) + w));
  const body = tokens(s.text);
  const head = tokens(s.heading);
  add(body.uni, 1); add(body.bi, 1.5);
  add(head.uni, 4); add(head.bi, 6);
  s.tf = tf;
  s.len = Math.max(body.uni.length, 40);
  for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
}
const N = sections.length;
const idf = (t) => Math.log(1 + N / (df.get(t) || N));

function score(qTerms, s) {
  let sum = 0;
  for (const [t, w] of qTerms) {
    const f = s.tf.get(t);
    if (!f) continue;
    sum += w * idf(t) * (1 + Math.log(f));
  }
  return sum / Math.pow(s.len, 0.25);
}

function match(q) {
  const qTerms = new Map();
  const addAll = (text, w) => {
    const t = tokens(text);
    t.uni.forEach((x) => qTerms.set(x, (qTerms.get(x) || 0) + w));
    t.bi.forEach((x) => qTerms.set(x, (qTerms.get(x) || 0) + w * 1.5));
  };
  addAll(q.question, 1);
  const correct = new Set(q.correctAnswers || []);
  for (const [k, v] of Object.entries(q.options || {})) addAll(v, correct.has(k) ? 2 : 0.6);

  const ranked = sections
    .map((s) => ({ s, sc: score(qTerms, s) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc);
  if (!ranked.length) return [];
  const top = ranked[0].sc;
  const perDoc = new Map();
  const out = [];
  for (const { s, sc } of ranked) {
    if (out.length >= MAX_RESULTS || sc < top * 0.55) break;
    const n = perDoc.get(s.doc) || 0;
    if (n >= MAX_PER_DOC) continue;
    perDoc.set(s.doc, n + 1);
    out.push({ doc: s.doc, h: s.h, title: s.title, heading: s.heading });
  }
  return out;
}

const map = {};
let total = 0;
let mapped = 0;
for (const f of fs.readdirSync(QUIZZES).filter((x) => x.endsWith('.json'))) {
  const quiz = JSON.parse(fs.readFileSync(path.join(QUIZZES, f), 'utf8'));
  for (const q of quiz.questions || []) {
    total++;
    const key = `${quiz.slug}:${q.number}`;
    const m = match(q);
    if (m.length) { map[key] = m; mapped++; }
  }
}
fs.writeFileSync(OUT, JSON.stringify(map));
console.log(`Guide sections: ${sections.length}; questions: ${total}; mapped: ${mapped}; file: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);

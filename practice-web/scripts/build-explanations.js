#!/usr/bin/env node
// practice-web/scripts/build-explanations.js
//
// Rule-based (no LLM) explanations for the dump quizzes. Run AFTER
// build-quizzes.js (that script rewrites the quiz JSON without explanations):
//   node practice-web/scripts/build-explanations.js
//
// For each question it combines two things from the study guides in practices/:
//   1. Keyword hints  - phrases in the question text that match rows of
//      M-keywords-mapping.md ("lowest latency" -> CloudFront, DAX ...).
//   2. Service notes  - for every AWS service named in a correct option, the
//      "concept" paragraph of that service's section in the core guides.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRACTICES = path.join(ROOT, 'practices');
const QUIZ_DIR = path.join(ROOT, 'data', 'quizzes');

const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();

// ── 1. keyword table ──────────────────────────────────────────────────────
function loadKeywords() {
  const rows = [];
  for (const file of ['M-keywords-mapping.md']) {
    const text = fs.readFileSync(path.join(PRACTICES, file), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\|\s*\*\*"([^"]+)"\*\*\s*\|\s*([^|]+)\|\s*([^|]*)\|/);
      if (m) rows.push({ phrase: m[1].toLowerCase(), services: clean(m[2]), why: clean(m[3]) });
    }
  }
  return rows;
}

// ── 2. service sections from the core guides ───────────────────────────────
function loadServices() {
  const services = [];
  const files = fs.readdirSync(PRACTICES).filter((f) => /^(0[1-9]|1[0-3])-/.test(f));
  for (const file of files) {
    const lines = fs.readFileSync(path.join(PRACTICES, file), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].match(/^##\s+(?:\S+\s+)?([A-Z][A-Z0-9 &/\-]+?)(?:\s*\(([^)]+)\))?\s*$/);
      if (!h) continue;
      const names = [h[1], h[2]].filter(Boolean).map((n) => clean(n));
      // concept text: first meaningful lines until the next ### / ## / table
      const body = [];
      for (let j = i + 1; j < lines.length && body.length < 3; j++) {
        const l = lines[j];
        if (/^##\s/.test(l)) break;
        if (/^###\s/.test(l) && body.length) break;
        if (/^(#|\||```|---|>|\s*$)/.test(l)) continue;
        body.push(clean(l.replace(/^[-*]\s+/, '')));
      }
      if (body.length) services.push({ file, names, note: body.join(' ') });
    }
  }
  return services;
}

function aliasesFor(name) {
  const out = new Set([name.toLowerCase()]);
  out.add(name.toLowerCase().replace(/^(amazon|aws)\s+/, ''));
  return [...out].filter((a) => a.length >= 3);
}

function matchServices(text, services) {
  const t = text.toLowerCase();
  const hits = [];
  for (const svc of services) {
    const al = svc.names.flatMap(aliasesFor);
    if (al.some((a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t))) hits.push(svc);
  }
  return hits;
}

const norm = (t) => t.toLowerCase().replace(/amazon |aws /g, '');
const docLink = (name) =>
  `https://docs.aws.amazon.com/search/doc-search.html?searchPath=documentation&searchQuery=${encodeURIComponent(name.replace(/^(AMAZON|AWS)\s+/i, ''))}`;

// Most specific service names first; drop a service whose name is contained in
// another matched one (e.g. "VPC" next to "VPC Peering") and generic words.
function bestServices(text, services, limit) {
  const hits = matchServices(text, services)
    .filter((s, i, arr) => arr.findIndex((x) => x.names[0] === s.names[0]) === i);
  const generic = new Set(['AMAZON VPC']);
  const specific = hits.filter((h) => !generic.has(h.names[0]) || hits.length === 1);
  return specific.sort((a, b) => b.names[0].length - a.names[0].length).slice(0, limit);
}

function explain(q, keywords, services) {
  const parts = [];
  const qt = q.question.toLowerCase();
  const correctText = norm(q.correctAnswers.map((l) => q.options[l] || '').join(' '));

  // Keyword hint only counts when its services show up in the correct answer.
  const kw = keywords.filter((k) => {
    if (!qt.includes(k.phrase)) return false;
    const names = k.services.replace(/\([^)]*\)/g, '').split(/,|\//).map((n) => norm(n).trim()).filter((n) => n.length >= 3);
    return names.some((n) => correctText.includes(n));
  }).slice(0, 2);

  parts.push(`Correct answer: ${q.correctAnswers.join(', ')}`);
  for (const k of kw) parts.push(`Clue: "${k.phrase}" points to ${k.services}${k.why ? ` (${k.why})` : ''}.`);

  const used = new Set();
  const good = [];
  for (const l of q.correctAnswers) {
    for (const svc of bestServices(q.options[l] || '', services, 2)) {
      if (used.has(svc.names[0]) || good.length >= 3) continue;
      used.add(svc.names[0]);
      good.push(svc);
    }
  }
  if (good.length) {
    parts.push('Why it fits:');
    for (const svc of good) parts.push(`- ${svc.names[0]}: ${svc.note}`);
  }

  const bad = [];
  for (const l of Object.keys(q.options)) {
    if (q.correctAnswers.includes(l)) continue;
    for (const svc of bestServices(q.options[l] || '', services, 1)) {
      if (used.has(svc.names[0]) || bad.some((b) => b.svc.names[0] === svc.names[0]) || bad.length >= 3) continue;
      bad.push({ l, svc });
    }
  }
  if (bad.length) {
    parts.push('What the other options use:');
    for (const { l, svc } of bad) parts.push(`- ${l}: ${svc.names[0]}. ${svc.note}`);
  }

  if (good.length) parts.push(`Read more: ${docLink(good[0].names[0])}`);
  const useful = kw.length > 0 || good.length > 0;
  return { text: parts.join('\n'), hasKw: kw.length > 0, hasNotes: good.length > 0, useful };
}

const keywords = loadKeywords();
const services = loadServices();
if (process.argv.includes('--sample')) {
  for (const [file, from] of [['01-compute-services', 0], ['04-networking-services', 5], ['03-database-services', 9]]) {
    const quiz = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, `${file}.json`), 'utf8'));
    for (const q of quiz.questions.slice(from, from + 2)) {
      console.log('Q:', q.question.slice(0, 160).replace(/\n/g, ' '));
      console.log(explain(q, keywords, services).text, '\n-----');
    }
  }
  process.exit(0);
}
let total = 0, withKw = 0, withNotes = 0, withEither = 0;
for (const f of fs.readdirSync(QUIZ_DIR).filter((x) => x.endsWith('.json'))) {
  const p = path.join(QUIZ_DIR, f);
  const quiz = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const q of quiz.questions) {
    const e = explain(q, keywords, services);
    total++; if (e.hasKw) withKw++; if (e.hasNotes) withNotes++; if (e.hasKw || e.hasNotes) withEither++;
    q.explanation = e.useful ? e.text : null;
  }
  if (process.argv.includes('--write')) fs.writeFileSync(p, JSON.stringify(quiz, null, 2) + '\n');
}
console.log(`keywords: ${keywords.length}, services: ${services.length}`);
console.log(`questions ${total}; keyword hint ${withKw}; study notes ${withNotes}; either ${withEither}`);

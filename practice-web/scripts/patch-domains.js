#!/usr/bin/env node
// Adds/refreshes the `domain` field on every question in data/quizzes/*.json.
const fs = require('fs');
const path = require('path');
const { classifyDomain } = require('./lib/domain');
const DIR = path.resolve(__dirname, '..', 'data', 'quizzes');
const seen = new Map(); const counts = {};
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const p = path.join(DIR, f);
  const quiz = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const q of quiz.questions) {
    q.domain = classifyDomain(q);
    if (q.dumpNo && !seen.has(q.dumpNo)) { seen.set(q.dumpNo, q.domain); counts[q.domain] = (counts[q.domain] || 0) + 1; }
  }
  fs.writeFileSync(p, JSON.stringify(quiz, null, 2) + '\n');
}
console.log('unique questions by domain:', counts, 'total', seen.size);

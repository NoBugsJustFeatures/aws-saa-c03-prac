#!/usr/bin/env node
// practice-web/scripts/build-quizzes.js
//
// One-time generator: parses the AWS SAA-C03 exam dump .docx files,
// classifies each question by AWS service, and writes one JSON file
// per quiz slug to practice-web/data/quizzes/. Run manually:
//   node practice-web/scripts/build-quizzes.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { extractDocxText } = require('./lib/extract-docx');
const { parseDump } = require('./lib/parse-dump');
const { classify, CATEGORIES } = require('./lib/classify');
const { dedupeQuestions, seededSample } = require('./lib/utils');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ZIP_PATH = path.join(REPO_ROOT, 'exam-dumps', 'drive-download-20260919T121110Z-1-001.zip');
const EXTRACT_DIR = path.join(REPO_ROOT, 'exam-dumps', '.extracted');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data', 'quizzes');
const MAX_PER_QUIZ = 60;
const SEED = 20260919;

// Exact duplicate of PART-2.docx (verified by md5sum during investigation).
const SKIP_FILES = new Set(['AWS Certified Solutions Architect – Associate (SAA-C03) - PART-2 (1).docx']);

// Architecture-guide quizzes draw from the already-classified core pools
// rather than running a second classifier. `null` means "even sample
// across all 12 core categories."
const ARCH_GUIDE_SOURCES = {
  'a-nen-tang-kien-truc': ['01-compute-services', '04-networking-services', '06-management-governance'],
  'b-bao-mat-compliance': ['05-security-services'],
  'c-kien-truc-web-app': ['01-compute-services', '04-networking-services', '03-database-services'],
  'd-kien-truc-luu-tru': ['02-storage-services', '10-migration-transfer'],
  'e-kien-truc-database': ['03-database-services'],
  'k-kich-ban-thi': null,
};

function extractZip() {
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  execSync(`unzip -o -q "${ZIP_PATH}" -d "${EXTRACT_DIR}"`);
}

function loadAllQuestions() {
  extractZip();
  const files = fs.readdirSync(EXTRACT_DIR).filter((f) => f.endsWith('.docx') && !SKIP_FILES.has(f));
  let all = [];
  let malformedTotal = 0;
  for (const file of files) {
    const text = extractDocxText(path.join(EXTRACT_DIR, file));
    const { questions, malformed } = parseDump(text, file);
    all = all.concat(questions);
    malformedTotal += malformed.length;
  }
  console.log(`Extracted ${all.length} parsed questions from ${files.length} files (${malformedTotal} dropped as malformed).`);
  const deduped = dedupeQuestions(all);
  console.log(`${deduped.length} unique after dedupe.\n`);
  return deduped;
}

function buildCoreCategoryPools(questions) {
  const pools = { '13-other-services': [], '14-so-sanh-services': [] };
  for (const cat of CATEGORIES) pools[cat.slug] = [];
  for (const q of questions) {
    const { primary } = classify(q);
    pools[primary].push(q);
  }
  return pools;
}

function hashSlug(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return h;
}

function toQuizQuestion(q, index) {
  return {
    number: index + 1,
    question: q.question,
    options: q.options,
    correctAnswers: q.correctAnswers,
    explanation: null,
  };
}

function writeQuiz(slug, pool) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const sampled = seededSample(pool, MAX_PER_QUIZ, SEED + hashSlug(slug));
  const payload = {
    slug,
    totalQuestions: sampled.length,
    questions: sampled.map(toQuizQuestion),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, `${slug}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  return { written: sampled.length, pool: pool.length };
}

function main() {
  const questions = loadAllQuestions();
  const pools = buildCoreCategoryPools(questions);

  console.log('--- Core service quizzes ---');
  for (const cat of CATEGORIES) {
    const { written, pool } = writeQuiz(cat.slug, pools[cat.slug]);
    console.log(`${cat.slug}: ${written} written (pool: ${pool})`);
  }
  for (const slug of ['13-other-services', '14-so-sanh-services']) {
    const { written, pool } = writeQuiz(slug, pools[slug]);
    console.log(`${slug}: ${written} written (pool: ${pool})`);
  }

  console.log('\n--- Architecture guide quizzes ---');
  const allCoreSlugs = CATEGORIES.map((c) => c.slug);
  for (const [archSlug, sourceSlugs] of Object.entries(ARCH_GUIDE_SOURCES)) {
    const sources = sourceSlugs || allCoreSlugs;
    const combinedPool = dedupeQuestions(sources.flatMap((s) => pools[s] || []));
    const { written, pool } = writeQuiz(archSlug, combinedPool);
    console.log(`${archSlug}: ${written} written (pool: ${pool}, sources: ${sources.join(', ')})`);
  }

  console.log('\n--- Spot-check: sample of "13-other-services" (catch-all) ---');
  for (const q of pools['13-other-services'].slice(0, 8)) {
    console.log(`  [${q.source} #${q.number}] ${q.question.slice(0, 100).replace(/\n/g, ' ')}...`);
  }
}

main();

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
const { classify, CATEGORIES, scoreCategories } = require('./lib/classify');
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

// Some core categories can end up with an empty primary pool: a category's
// keywords may appear throughout the dump, but never as the single
// highest-scoring category for any individual question (e.g. CloudFormation
// questions on the SAA-C03 exam are usually framed around the compute/
// management resources being deployed, not around CloudFormation itself).
// Rather than ship an empty quiz (or reintroduce placeholder content), we
// backfill from the full question set ranked by that category's own raw
// keyword score, keeping the quiz 100% real dump content even though these
// questions weren't any question's argmax category.
function backfillEmptyPools(pools, questions) {
  for (const cat of CATEGORIES) {
    if (pools[cat.slug].length === 0) {
      const ranked = questions
        .map((q) => ({ q, score: scoreCategories(q)[cat.slug] }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.q);
      console.log(`${cat.slug}: primary pool was empty, backfilled ${ranked.length} questions by raw keyword score`);
      pools[cat.slug] = ranked;
    }
  }
}

function hashSlug(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return h;
}

// Generated once by scripts/generate-explanations.js (keyed by dump number).
const EXPLANATIONS_PATH = path.resolve(__dirname, '..', 'data', 'explanations.json');
const EXPLANATIONS = fs.existsSync(EXPLANATIONS_PATH) ? JSON.parse(fs.readFileSync(EXPLANATIONS_PATH, 'utf8')) : {};

function toQuizQuestion(q, index) {
  return {
    number: index + 1,
    dumpNo: q.number, // original question number in the exam dump (1-1019)
    question: q.question,
    options: q.options,
    correctAnswers: q.correctAnswers,
    explanation: EXPLANATIONS[q.number] || null,
  };
}

// Core topic quizzes keep every question; only the arch-guide quizzes are sampled.
function writeQuiz(slug, pool, max = MAX_PER_QUIZ) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const sampled = seededSample(pool, max, SEED + hashSlug(slug));
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
  backfillEmptyPools(pools, questions);

  // Safety net: the plan requires every quiz to ship with real content. If a
  // category is still empty after backfilling by raw keyword score (e.g. a
  // future re-run against different dump content has zero keyword hits for
  // some category), fail loudly before writing any files rather than
  // silently shipping an empty {totalQuestions: 0, questions: []} quiz.
  const emptyCategories = CATEGORIES.filter((cat) => pools[cat.slug].length === 0);
  if (emptyCategories.length > 0) {
    throw new Error(`Categories still empty after backfill: ${emptyCategories.map((c) => c.slug).join(', ')}`);
  }

  console.log('--- Core service quizzes ---');
  for (const cat of CATEGORIES) {
    const { written, pool } = writeQuiz(cat.slug, pools[cat.slug], Infinity);
    console.log(`${cat.slug}: ${written} written (pool: ${pool})`);
  }
  for (const slug of ['13-other-services', '14-so-sanh-services']) {
    const { written, pool } = writeQuiz(slug, pools[slug], Infinity);
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

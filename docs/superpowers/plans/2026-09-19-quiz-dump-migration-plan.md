# Quiz Dump Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the missing per-topic Quiz feature (dashboard, quiz UI, doc reader), replace all 20 quiz question banks with real AWS SAA-C03 exam-dump questions classified by topic, and add multi-select ("Choose two") support end-to-end.

**Architecture:** A one-time Node build script parses the 5 exam-dump `.docx` files into structured questions, classifies each by AWS service keywords into one of 14 core-service categories (plus a comparison catch-all), and writes one JSON file per quiz slug under `practice-web/data/quizzes/`. `server.js` gets two new routes that serve those files and score submissions (single- and multi-answer). `public/` is replaced with the real frontend recovered from the live Vercel deployment, extended to support multi-select quiz questions.

**Tech Stack:** Node.js (Express, already in use), vanilla JS frontend (no framework, already in use), Node's built-in `node:test` + `assert` for tests (no new dependency — project has none today), system `unzip` CLI (already available) for `.docx` extraction.

**Spec:** `docs/superpowers/specs/2026-09-19-quiz-dump-migration-design.md`

## Global Constraints

- Do not modify `S-practice-exam.md`, `/api/exam`, or `/api/exam/score` — the existing 65-question timed exam is explicitly out of scope.
- No new npm dependencies — extraction/parsing/classification all use Node built-ins + the system `unzip` CLI.
- `explanation` is `null` for all dump-sourced questions — never fabricate explanation text.
- Do not run `vercel --prod` or any deploy command — deployment is explicitly gated on the user granting Vercel MCP access later; this plan stops at local verification.
- Max 60 questions per quiz, seeded/reproducible sampling when a category pool exceeds that.
- All 20 quiz slugs get dump-sourced content: `01-compute-services` … `14-so-sanh-services`, plus `a-nen-tang-kien-truc`, `b-bao-mat-compliance`, `c-kien-truc-web-app`, `d-kien-truc-luu-tru`, `e-kien-truc-database`, `k-kich-ban-thi`.

---

## File Structure

- Create `practice-web/scripts/lib/extract-docx.js` — pull plain text out of a `.docx`.
- Create `practice-web/scripts/lib/extract-docx.test.js`
- Create `practice-web/scripts/lib/parse-dump.js` — turn extracted text into structured `{question, options, correctAnswers}` records.
- Create `practice-web/scripts/lib/parse-dump.test.js`
- Create `practice-web/scripts/lib/classify.js` — keyword dictionary + category scoring.
- Create `practice-web/scripts/lib/classify.test.js`
- Create `practice-web/scripts/lib/utils.js` — dedupe + seeded sampling.
- Create `practice-web/scripts/lib/utils.test.js`
- Create `practice-web/scripts/build-quizzes.js` — CLI orchestration script (run manually, not part of the served app).
- Create `practice-web/data/quizzes/*.json` — 20 generated quiz files (build output, committed).
- Modify `practice-web/server.js` — extend `/api/docs`, add `GET /api/quiz/:slug` and `POST /api/quiz/:slug/score`.
- Modify `practice-web/public/index.html`, `practice-web/public/app.js`, `practice-web/public/styles.css` — replace with the recovered live frontend, then extend `app.js` for multi-select.
- Modify `.gitignore` (repo root) — ignore `exam-dumps/` (raw proprietary dump `.docx`/`.zip`, not meant to be committed) and the build script's scratch extraction folder.

---

### Task 1: DOCX text extraction

**Files:**
- Create: `practice-web/scripts/lib/extract-docx.js`
- Test: `practice-web/scripts/lib/extract-docx.test.js`

**Interfaces:**
- Produces: `extractParagraphsFromXml(xml: string): string[]` — pure, one array entry per `<w:p>` paragraph's joined text.
- Produces: `extractDocxText(filePath: string): string` — shells out to `unzip -p <file> word/document.xml`, then joins `extractParagraphsFromXml` output with `\n`.

- [ ] **Step 1: Write the failing test**

```js
// practice-web/scripts/lib/extract-docx.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractParagraphsFromXml } = require('./extract-docx');

test('extractParagraphsFromXml joins text runs within each paragraph', () => {
  const xml = `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:r><w:t>Question  1</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Hello &amp; </w:t></w:r><w:r><w:t>World</w:t></w:r></w:p>
    <w:p></w:p>
  </w:body></w:document>`;
  const lines = extractParagraphsFromXml(xml);
  assert.deepEqual(lines, ['Question  1', 'Hello & World', '']);
});

test('extractParagraphsFromXml unescapes xml entities', () => {
  const xml = `<w:p><w:r><w:t>A &lt;tag&gt; &quot;quoted&quot; &apos;text&apos;</w:t></w:r></w:p>`;
  const lines = extractParagraphsFromXml(xml);
  assert.deepEqual(lines, [`A <tag> "quoted" 'text'`]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test practice-web/scripts/lib/extract-docx.test.js`
Expected: FAIL — `extractParagraphsFromXml` is not a function (module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

```js
// practice-web/scripts/lib/extract-docx.js
const { execSync } = require('child_process');

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractParagraphsFromXml(xml) {
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const textRunRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const paragraphs = xml.match(paraRegex) || [];
  return paragraphs.map((p) => {
    let text = '';
    let m;
    textRunRegex.lastIndex = 0;
    while ((m = textRunRegex.exec(p)) !== null) {
      text += m[1];
    }
    return unescapeXml(text);
  });
}

function extractDocxText(filePath) {
  const xml = execSync(`unzip -p "${filePath}" word/document.xml`, {
    maxBuffer: 1024 * 1024 * 50,
  }).toString('utf8');
  return extractParagraphsFromXml(xml).join('\n');
}

module.exports = { extractParagraphsFromXml, extractDocxText };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test practice-web/scripts/lib/extract-docx.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add practice-web/scripts/lib/extract-docx.js practice-web/scripts/lib/extract-docx.test.js
git commit -m "$(cat <<'EOF'
Add docx text extraction for exam dump parsing

Regex-based extraction of word/document.xml paragraphs via the system
unzip CLI — no new npm dependency needed. Validated byte-identical to
a reference Python/ElementTree extraction during design.
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Dump question parsing

**Files:**
- Create: `practice-web/scripts/lib/parse-dump.js`
- Test: `practice-web/scripts/lib/parse-dump.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 directly (operates on already-extracted text strings).
- Produces: `parseDump(rawText: string, sourceLabel: string): {questions: Question[], malformed: {number:number, reason:string}[]}` where `Question = {source: string, number: number, question: string, options: {A:string,B:string,C:string,D:string}, correctAnswers: string[]}`.

- [ ] **Step 1: Write the failing test**

```js
// practice-web/scripts/lib/parse-dump.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDump } = require('./parse-dump');

test('parses a normal single-answer question', () => {
  const raw = `
Question  1
A company needs low-latency storage.
Which service should it use?
A. Amazon S3
B. Amazon EBS ✅
C. Amazon Glacier
D. AWS Snowball

Question  2
Placeholder for boundary.
A. x
B. y
C. z
D. w ✅
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].number, 1);
  assert.deepEqual(questions[0].correctAnswers, ['B']);
  assert.equal(questions[0].options.B, 'Amazon EBS');
  assert.equal(questions[0].question, 'A company needs low-latency storage.\nWhich service should it use?');
});

test('parses a multi-select ("Choose two") question', () => {
  const raw = `
Question  5
Which combination of solutions will resolve the errors? (Choose two.)
A. Change the target type. ✅
B. Do nothing.
C. Enable detailed monitoring. ✅
D. Delete the load balancer.
`;
  const { questions } = parseDump(raw, 'test-part');
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].correctAnswers, ['A', 'C']);
});

test('recovers options that run together without a separating space', () => {
  const raw = `
Question  7
Which combination should a solutions architect recommend?
A. Amazon CloudFront and Amazon S3 ✅B. AWS Lambda and Amazon DynamoDBC. Application Load Balancer and ECSD. API Gateway and Kinesis
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].correctAnswers, ['A']);
  assert.equal(questions[0].options.A, 'Amazon CloudFront and Amazon S3');
  assert.equal(questions[0].options.B, 'AWS Lambda and Amazon DynamoDB');
  assert.equal(questions[0].options.C, 'Application Load Balancer and ECS');
  assert.equal(questions[0].options.D, 'API Gateway and Kinesis');
});

test('drops a block where the option separator is unrecoverably lost', () => {
  const raw = `
Question  9
Some question text.
A. First optionB. Second optionC. ThirdD without a boundary at all ✅
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(questions.length, 0);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].number, 9);
});

test('drops a block with no correct-answer marker', () => {
  const raw = `
Question  10
Some question text.
A. First
B. Second
C. Third
D. Fourth
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(questions.length, 0);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].reason, 'empty-q-or-no-answer');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test practice-web/scripts/lib/parse-dump.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
// practice-web/scripts/lib/parse-dump.js
function findAllMarkers(text, letter) {
  const re = new RegExp(`(?<![A-Za-z])${letter}\\.\\s+`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m.index);
  return out;
}

// Locates the 4 option markers by scanning from the END of the block
// backward (last D, then last C before that D, then last B before that
// C, then last A before that B). Options sometimes run together with no
// separating space ("...group.B. Use a...") which breaks a forward/
// line-anchored search; false-positive letter-period matches (a sentence
// starting "A company...") cluster in the question prose near the start,
// not near the real options at the end, so anchoring from the end avoids
// them.
function locateOptions(block) {
  const dPositions = findAllMarkers(block, 'D');
  if (!dPositions.length) return null;
  const idxD = dPositions[dPositions.length - 1];

  const cPositions = findAllMarkers(block, 'C').filter((i) => i < idxD);
  if (!cPositions.length) return null;
  const idxC = cPositions[cPositions.length - 1];

  const bPositions = findAllMarkers(block, 'B').filter((i) => i < idxC);
  if (!bPositions.length) return null;
  const idxB = bPositions[bPositions.length - 1];

  const aPositions = findAllMarkers(block, 'A').filter((i) => i < idxB);
  if (!aPositions.length) return null;
  const idxA = aPositions[aPositions.length - 1];

  return {
    questionText: block.slice(0, idxA).trim(),
    raw: {
      A: block.slice(idxA + 2, idxB).trim(),
      B: block.slice(idxB + 2, idxC).trim(),
      C: block.slice(idxC + 2, idxD).trim(),
      D: block.slice(idxD + 2).trim(),
    },
  };
}

function parseDump(rawText, sourceLabel) {
  const questions = [];
  const malformed = [];
  const blockRegex = /\nQuestion\s+(\d+)\s*\n([\s\S]*?)(?=\nQuestion\s+\d+\s*\n|$)/g;
  const text = `\n${rawText.trim()}\n`;
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    const number = Number(m[1]);
    const block = m[2].trim();
    const located = locateOptions(block);
    if (!located) {
      malformed.push({ number, reason: 'no-option-markers' });
      continue;
    }

    const options = {};
    const correctAnswers = [];
    for (const letter of ['A', 'B', 'C', 'D']) {
      let optText = located.raw[letter];
      if (optText.includes('✅')) {
        correctAnswers.push(letter);
        optText = optText.replace(/✅/g, '').trim();
      }
      options[letter] = optText;
    }

    if (!located.questionText || correctAnswers.length < 1) {
      malformed.push({ number, reason: 'empty-q-or-no-answer' });
      continue;
    }

    questions.push({
      source: sourceLabel,
      number,
      question: located.questionText,
      options,
      correctAnswers,
    });
  }
  return { questions, malformed };
}

module.exports = { parseDump };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test practice-web/scripts/lib/parse-dump.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add practice-web/scripts/lib/parse-dump.js practice-web/scripts/lib/parse-dump.test.js
git commit -m "$(cat <<'EOF'
Add exam dump question parser

Parses Question-N blocks into structured question/options/
correctAnswers records. Locates option markers by scanning backward
from the end of each block, since some dumps run options together
without a separating space between them.
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Category classification

**Files:**
- Create: `practice-web/scripts/lib/classify.js`
- Test: `practice-web/scripts/lib/classify.test.js`

**Interfaces:**
- Consumes: `Question` shape from Task 2 (`{question, options: {A,B,C,D}, correctAnswers}`; `source`/`number` not used here).
- Produces: `CATEGORIES: {slug: string, keywords: string[]}[]` (12 entries, service-based). `scoreCategories(question): Record<string, number>`. `classify(question): {primary: string, scores: Record<string, number>}` — `primary` is one of the 12 `CATEGORIES` slugs, or `'13-other-services'`, or `'14-so-sanh-services'`.

- [ ] **Step 1: Write the failing test**

```js
// practice-web/scripts/lib/classify.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('./classify');

test('classifies an EC2/Auto Scaling question as compute', () => {
  const q = {
    question: 'An application runs on Amazon EC2 instances behind an Application Load Balancer with Auto Scaling.',
    options: {
      A: 'Use a simple scaling policy',
      B: 'Use a target tracking policy on the Auto Scaling group',
      C: 'Use AWS Lambda to poll CloudWatch',
      D: 'Use Amazon SQS to buffer requests',
    },
    correctAnswers: ['B'],
  };
  assert.equal(classify(q).primary, '01-compute-services');
});

test('classifies an S3/Storage Gateway question as storage', () => {
  const q = {
    question: 'A company needs low-latency access to data stored in Amazon S3 from an on-premises application.',
    options: {
      A: 'Configure an Amazon S3 File Gateway',
      B: 'Use AWS Lambda',
      C: 'Use Amazon RDS',
      D: 'Use Amazon SQS',
    },
    correctAnswers: ['A'],
  };
  assert.equal(classify(q).primary, '02-storage-services');
});

test('weights keywords found in the correct answer higher than distractors', () => {
  const q = {
    question: 'A company wants a fully managed relational database with automatic failover.',
    options: {
      A: 'Deploy Amazon RDS Multi-AZ for Aurora',
      B: 'Deploy on Amazon EC2 with a custom script and Amazon S3 backups behind an Application Load Balancer with EC2 Auto Scaling',
      C: 'Use AWS Lambda with DynamoDB',
      D: 'Use Amazon EC2 Spot Instances',
    },
    correctAnswers: ['A'],
  };
  // Option B mentions more compute keywords in raw count (EC2 x2, S3, ALB,
  // Auto Scaling), but the CORRECT option (A) is squarely database
  // (RDS, Multi-AZ, Aurora) — the 2x weighting on the correct answer's
  // text should still win it for database.
  assert.equal(classify(q).primary, '03-database-services');
});

test('falls back to other-services when no keywords match', () => {
  const q = {
    question: 'A company wants to reduce paperwork.',
    options: { A: 'Do a thing', B: 'Do another thing', C: 'Do a third thing', D: 'Do nothing' },
    correctAnswers: ['A'],
  };
  assert.equal(classify(q).primary, '13-other-services');
});

test('routes a question spanning 3+ categories to the comparison bucket', () => {
  const q = {
    question: 'Compare storage, compute, and networking options for this workload.',
    options: {
      A: 'Amazon S3 storage with EBS volumes and VPC endpoints and CloudFront and Direct Connect',
      B: 'Amazon EC2 with Auto Scaling and Application Load Balancer and Lambda and ECS and Fargate',
      C: 'Amazon VPC with Route 53 and Transit Gateway and NAT Gateway and Direct Connect and VPC Peering',
      D: 'None of the above',
    },
    correctAnswers: ['A', 'B'],
  };
  assert.equal(classify(q).primary, '14-so-sanh-services');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test practice-web/scripts/lib/classify.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
// practice-web/scripts/lib/classify.js
const CATEGORIES = [
  {
    slug: '01-compute-services',
    keywords: ['ec2', 'amazon ec2', 'aws lambda', ' lambda', 'amazon ecs', ' ecs ', 'amazon eks', ' eks ',
      'fargate', 'elastic beanstalk', 'lightsail', 'aws batch', 'auto scaling', 'autoscaling',
      'application load balancer', ' alb', 'network load balancer', ' nlb', 'gateway load balancer',
      'placement group', 'spot instance', 'reserved instance', 'on-demand instance', 'dedicated host',
      'ec2 instance', 'amazon machine image', ' ami', 'outposts', 'wavelength', 'local zone', 'nitro',
      'ec2 image builder'],
  },
  {
    slug: '02-storage-services',
    keywords: ['amazon s3', ' s3 ', 's3 bucket', 'elastic block store', ' ebs', 'elastic file system',
      ' efs', 'amazon fsx', ' fsx', 'storage gateway', 'glacier', 'snowball', 'snowcone', 'snowmobile',
      's3 transfer acceleration', 'multipart upload', 'file gateway', 'volume gateway', 'tape gateway',
      's3 glacier', 'cross-region replication', 'storage class'],
  },
  {
    slug: '03-database-services',
    keywords: ['amazon rds', ' rds ', 'aurora', 'dynamodb', 'elasticache', 'redshift', 'documentdb',
      'neptune', 'amazon keyspaces', 'qldb', 'quantum ledger', 'timestream', 'memorydb', 'rds proxy',
      'read replica', 'multi-az'],
  },
  {
    slug: '04-networking-services',
    keywords: ['amazon vpc', ' vpc ', 'subnet', 'route table', 'internet gateway', 'nat gateway',
      'route 53', 'cloudfront', 'direct connect', 'site-to-site vpn', 'transit gateway', 'privatelink',
      'vpc peering', 'global accelerator', 'elastic ip', 'network acl', 'vpc endpoint'],
  },
  {
    slug: '05-security-services',
    keywords: [' iam ', 'identity and access management', 'aws kms', 'key management service',
      'secrets manager', 'guardduty', ' waf', 'web application firewall', 'aws shield', 'cognito',
      'macie', 'security hub', 'amazon inspector', 'certificate manager', ' acm', 'directory service',
      'service control polic', 'iam identity center', 'security group', ' sts ', 'assume role'],
  },
  {
    slug: '06-management-governance',
    keywords: ['cloudwatch', 'cloudtrail', 'aws config', 'systems manager', 'aws organizations',
      'control tower', 'trusted advisor', 'service catalog', 'license manager', 'compute optimizer',
      'cost explorer', 'aws budgets', 'well-architected'],
  },
  {
    slug: '07-application-integration',
    keywords: ['amazon sqs', ' sqs ', 'simple queue service', 'amazon sns', ' sns ',
      'simple notification service', 'eventbridge', 'step functions', 'amazon mq', 'appflow',
      'simple workflow service'],
  },
  {
    slug: '08-developer-tools',
    keywords: ['codecommit', 'codebuild', 'codedeploy', 'codepipeline', 'cloudformation', 'aws cdk',
      'x-ray', 'cloud9', 'codeartifact', 'codestar', 'sam template', 'serverless application model'],
  },
  {
    slug: '09-analytics-bigdata',
    keywords: ['kinesis', 'amazon athena', 'aws glue', 'amazon emr', 'quicksight', 'lake formation',
      'opensearch', 'elasticsearch service', 'data pipeline', 'amazon msk',
      'managed streaming for kafka'],
  },
  {
    slug: '10-migration-transfer',
    keywords: ['database migration service', ' dms ', 'datasync', 'migration hub',
      'application discovery service', 'server migration service', 'transfer family', 'sftp',
      'snowball', 'snowcone', 'snowmobile'],
  },
  {
    slug: '11-api-integration',
    keywords: ['api gateway', 'appsync', 'graphql', 'rest api', 'websocket api'],
  },
  {
    slug: '12-ml-ai',
    keywords: ['sagemaker', 'rekognition', 'comprehend', 'amazon lex', 'amazon polly',
      'amazon translate', 'amazon forecast', 'textract', 'personalize', 'amazon kendra', 'transcribe'],
  },
];

function normalizeText(s) {
  return ` ${String(s).toLowerCase()} `;
}

function countKeywordHits(text, keywords) {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits += 1;
  }
  return hits;
}

function scoreCategories(question) {
  const fullText = normalizeText([question.question, ...Object.values(question.options)].join(' '));
  const correctText = normalizeText(
    question.correctAnswers.map((letter) => question.options[letter] || '').join(' ')
  );

  const scores = {};
  for (const cat of CATEGORIES) {
    const baseHits = countKeywordHits(fullText, cat.keywords);
    const correctHits = countKeywordHits(correctText, cat.keywords);
    scores[cat.slug] = baseHits + correctHits;
  }
  return scores;
}

function classify(question) {
  const scores = scoreCategories(question);
  const entries = Object.entries(scores);
  const maxScore = Math.max(...entries.map(([, s]) => s));

  if (maxScore === 0) {
    return { primary: '13-other-services', scores };
  }

  const topCategories = entries.filter(([, s]) => s >= maxScore * 0.8 && s > 0);
  if (topCategories.length >= 3) {
    return { primary: '14-so-sanh-services', scores };
  }

  for (const cat of CATEGORIES) {
    if (scores[cat.slug] === maxScore) {
      return { primary: cat.slug, scores };
    }
  }
  return { primary: '13-other-services', scores };
}

module.exports = { CATEGORIES, scoreCategories, classify };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test practice-web/scripts/lib/classify.test.js`
Expected: PASS (5 tests). If the weighting test fails, check the keyword lists for accidental overlap (e.g. "s3" matching inside another word) before changing the 0.8 threshold or weighting.

- [ ] **Step 5: Commit**

```bash
git add practice-web/scripts/lib/classify.js practice-web/scripts/lib/classify.test.js
git commit -m "$(cat <<'EOF'
Add AWS-service keyword classifier for exam dump questions

Scores each question against 12 core-service keyword lists, weighting
hits inside the correct answer's option text double. Questions with
no match fall back to other-services; questions scoring closely
across 3+ categories route to the comparison quiz.
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Dedupe and seeded sampling utilities

**Files:**
- Create: `practice-web/scripts/lib/utils.js`
- Test: `practice-web/scripts/lib/utils.test.js`

**Interfaces:**
- Consumes: `Question` shape from Task 2 (uses only `.question` for dedupe).
- Produces: `dedupeQuestions(questions: Question[]): Question[]`. `seededSample(array: any[], n: number, seed: number): any[]`.

- [ ] **Step 1: Write the failing test**

```js
// practice-web/scripts/lib/utils.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupeQuestions, seededSample } = require('./utils');

test('dedupeQuestions drops repeats with normalized-equal question text', () => {
  const qs = [
    { question: 'What  is   S3?', options: {}, correctAnswers: ['A'] },
    { question: 'what is s3?', options: {}, correctAnswers: ['B'] },
    { question: 'What is EC2?', options: {}, correctAnswers: ['A'] },
  ];
  const out = dedupeQuestions(qs);
  assert.equal(out.length, 2);
  assert.equal(out[0].correctAnswers[0], 'A'); // first occurrence kept
});

test('seededSample returns the whole array unshuffled when n >= length', () => {
  const arr = [1, 2, 3];
  assert.deepEqual(seededSample(arr, 5, 42), [1, 2, 3]);
});

test('seededSample returns exactly n items and is reproducible for the same seed', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const a = seededSample(arr, 10, 42);
  const b = seededSample(arr, 10, 42);
  assert.equal(a.length, 10);
  assert.deepEqual(a, b);
});

test('seededSample gives different results for different seeds', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const a = seededSample(arr, 10, 1);
  const b = seededSample(arr, 10, 2);
  assert.notDeepEqual(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test practice-web/scripts/lib/utils.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
// practice-web/scripts/lib/utils.js
function dedupeQuestions(questions) {
  const seen = new Set();
  const out = [];
  for (const q of questions) {
    const norm = q.question.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(q);
  }
  return out;
}

// Deterministic PRNG (mulberry32) so sampling is reproducible per seed.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSample(array, n, seed) {
  if (array.length <= n) return [...array];
  const rand = mulberry32(seed);
  const copy = [...array];
  for (let i = copy.length - 1; i >= copy.length - n; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(copy.length - n);
}

module.exports = { dedupeQuestions, seededSample };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test practice-web/scripts/lib/utils.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add practice-web/scripts/lib/utils.js practice-web/scripts/lib/utils.test.js
git commit -m "$(cat <<'EOF'
Add dedupe and seeded sampling utilities for quiz generation
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Build script orchestration — generate all 20 quiz files

**Files:**
- Create: `practice-web/scripts/build-quizzes.js`
- Modify: `.gitignore` (repo root, currently 6 lines)
- Create (generated, committed): `practice-web/data/quizzes/01-compute-services.json` … `practice-web/data/quizzes/k-kich-ban-thi.json` (20 files)

**Interfaces:**
- Consumes: `extractDocxText` (Task 1), `parseDump` (Task 2), `classify`/`CATEGORIES` (Task 3), `dedupeQuestions`/`seededSample` (Task 4).
- Produces: 20 files at `practice-web/data/quizzes/<slug>.json`, each `{slug: string, totalQuestions: number, questions: {number, question, options, correctAnswers, explanation: null}[]}`. Consumed by Task 6's server routes.

- [ ] **Step 1: Update `.gitignore`**

Read the current file first (it has 6 lines: `udemy/`, `practice-web/node_modules/`, `node_modules/`, `.env`, `npm-debug.log`, plus a trailing blank line), then add two lines:

```
exam-dumps/
```

(The raw `.docx`/`.zip` exam dumps are large and copyrighted — they stay local, matching how `udemy/` is already excluded. `practice-web/data/quizzes/*.json`, the *output* of processing them, is NOT ignored — it's committed since `server.js` reads it at runtime.)

- [ ] **Step 2: Write the build script**

```js
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
```

- [ ] **Step 3: Run the build script against the real dumps**

Run: `node practice-web/scripts/build-quizzes.js`

Expected: prints extraction/dedupe counts, then a per-slug written/pool count for all 20 slugs, then a sample of `13-other-services` questions. Read the "other-services" sample — if any of those 8 questions clearly belong to one of the 12 named categories (e.g. an obvious EC2 question), the keyword list for that category in Task 3 is missing an obvious term; go back and add it, then re-run this script (it's idempotent and safe to re-run — it overwrites `data/quizzes/*.json` deterministically for the same seed).

- [ ] **Step 4: Verify the output files**

Run: `ls practice-web/data/quizzes/ | wc -l` — expect `20`.
Run: `node -e "const d=require('./practice-web/data/quizzes/01-compute-services.json'); console.log(d.slug, d.totalQuestions, d.questions[0].question.slice(0,80))"` — expect a real, sensible compute-related question printed, not an error.

- [ ] **Step 5: Commit**

```bash
git add practice-web/scripts/build-quizzes.js practice-web/data/quizzes/ .gitignore
git commit -m "$(cat <<'EOF'
Generate all 20 quiz question banks from AWS exam dumps

Replaces the previous ChatGPT-generated placeholders (not present in
this repo's history) with real exam-dump questions, classified by
AWS service and capped at 60 per quiz. Raw dump .docx/.zip files are
gitignored; only the generated JSON is committed.
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Backend — extend `/api/docs`, add `GET /api/quiz/:slug`

**Files:**
- Modify: `practice-web/server.js`

**Interfaces:**
- Consumes: `practice-web/data/quizzes/<slug>.json` files from Task 5.
- Produces: `GET /api/docs` now returns `{filename, slug, title, isExam, isReference, hasQuiz}` per doc (was `{filename, slug, title, isExam}`). New route `GET /api/quiz/:slug` → `200 {slug, totalQuestions, questions}` or `404 {message}`.

- [ ] **Step 1: Add the quiz-file helpers and route**

In `practice-web/server.js`, after the existing `EXAM_DURATION_SECONDS` constant (line 15), add:

```js
const QUIZZES_DIR = path.resolve(__dirname, 'data', 'quizzes');

async function hasQuizFile(slug) {
  try {
    await fs.access(path.join(QUIZZES_DIR, `${slug}.json`));
    return true;
  } catch {
    return false;
  }
}

async function loadQuiz(slug) {
  const content = await fs.readFile(path.join(QUIZZES_DIR, `${slug}.json`), 'utf8');
  return JSON.parse(content);
}
```

Then replace the existing `app.get('/api/docs', ...)` handler (lines 79–107) with:

```js
app.get('/api/docs', async (req, res) => {
  try {
    const files = await fs.readdir(PRACTICES_DIR);
    const markdownFiles = files.filter((file) => file.toLowerCase().endsWith('.md'));

    const docs = await Promise.all(
      markdownFiles.map(async (filename) => {
        const fullPath = path.join(PRACTICES_DIR, filename);
        const content = await fs.readFile(fullPath, 'utf8');
        const slug = slugFromFilename(filename);
        const isExam = filename === EXAM_FILE;
        const hasQuiz = !isExam && (await hasQuizFile(slug));
        return {
          filename,
          slug,
          title: titleFromMarkdown(filename, content),
          isExam,
          isReference: !isExam && !hasQuiz,
          hasQuiz,
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
```

Then add, right after the `/api/docs/:slug` handler (after line 135, before `app.get('/api/exam', ...)`):

```js
app.get('/api/quiz/:slug', async (req, res) => {
  try {
    const quiz = await loadQuiz(req.params.slug);
    res.json(quiz);
  } catch (error) {
    res.status(404).json({ message: 'Quiz not found.' });
  }
});
```

- [ ] **Step 2: Write a smoke-test script for the new behavior**

No test framework runs the Express app itself today (`package.json` has no test script). Verify by starting the server and curling it — write this as a repeatable script rather than a one-off manual step:

```bash
# practice-web/scripts/smoke-test-quiz-api.sh
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

node server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT
sleep 1

echo "--- GET /api/docs (checking hasQuiz/isReference fields) ---"
curl -sf http://localhost:3000/api/docs | node -e '
  let data = "";
  process.stdin.on("data", d => data += d);
  process.stdin.on("end", () => {
    const docs = JSON.parse(data);
    const compute = docs.find(d => d.slug === "01-compute-services");
    const overview = docs.find(d => d.slug === "00-tong-quan-overview");
    const exam = docs.find(d => d.isExam);
    if (!compute || compute.hasQuiz !== true) throw new Error("01-compute-services should have hasQuiz=true");
    if (!overview || overview.isReference !== true) throw new Error("00-tong-quan-overview should have isReference=true");
    if (!exam || exam.hasQuiz !== false) throw new Error("exam doc should have hasQuiz=false");
    console.log("OK: /api/docs fields correct");
  });
'

echo "--- GET /api/quiz/01-compute-services ---"
curl -sf http://localhost:3000/api/quiz/01-compute-services | node -e '
  let data = "";
  process.stdin.on("data", d => data += d);
  process.stdin.on("end", () => {
    const quiz = JSON.parse(data);
    if (quiz.slug !== "01-compute-services") throw new Error("wrong slug");
    if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) throw new Error("no questions");
    if (!Array.isArray(quiz.questions[0].correctAnswers)) throw new Error("correctAnswers should be an array");
    console.log(`OK: /api/quiz/01-compute-services returned ${quiz.totalQuestions} questions`);
  });
'

echo "--- GET /api/quiz/does-not-exist (expect 404) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/quiz/does-not-exist)
if [ "$STATUS" != "404" ]; then echo "FAIL: expected 404, got $STATUS"; exit 1; fi
echo "OK: unknown quiz slug returns 404"

echo "All smoke tests passed."
```

- [ ] **Step 3: Run the smoke test to verify it fails, then passes**

Run: `chmod +x practice-web/scripts/smoke-test-quiz-api.sh && practice-web/scripts/smoke-test-quiz-api.sh`

Before Step 1's edits: FAIL (`hasQuiz`/`isReference` undefined, `/api/quiz/*` returns 404 HTML from the catch-all route, so the JSON parse throws).
After Step 1's edits: PASS, prints the three OK lines plus "All smoke tests passed."

(If you're implementing this task in order, Step 1 already happened before this smoke test exists — run the script now to confirm the *already-applied* change works, rather than re-verifying a pre-change failure.)

- [ ] **Step 4: Commit**

```bash
git add practice-web/server.js practice-web/scripts/smoke-test-quiz-api.sh
git commit -m "$(cat <<'EOF'
Extend /api/docs and add GET /api/quiz/:slug

/api/docs now reports hasQuiz and isReference per doc, derived from
whether a matching data/quizzes/<slug>.json file exists — no
hardcoded doc lists to keep in sync. New route serves a quiz's full
question set (answers included; untimed study mode).
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Backend — `POST /api/quiz/:slug/score` (single + multi-select scoring)

**Files:**
- Modify: `practice-web/server.js`
- Modify: `practice-web/scripts/smoke-test-quiz-api.sh`

**Interfaces:**
- Consumes: `loadQuiz(slug)` from Task 6.
- Produces: `POST /api/quiz/:slug/score` body `{answers: {[questionNumber: string]: string | string[]}}` → `200 {total, correct, incorrect, percentage, details: {number, question, userAnswer, correctAnswers, isCorrect, explanation}[]}` or `404`/`400`.

- [ ] **Step 1: Add the scoring route**

In `practice-web/server.js`, add right after the `GET /api/quiz/:slug` route from Task 6:

```js
function normalizeAnswer(a) {
  if (Array.isArray(a)) return [...a].sort();
  if (a === null || a === undefined || a === '') return [];
  return [a];
}

function answersEqual(a, b) {
  const na = normalizeAnswer(a);
  const nb = normalizeAnswer(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

app.post('/api/quiz/:slug/score', async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ message: 'Invalid answers payload.' });
    }

    const quiz = await loadQuiz(req.params.slug);
    let correct = 0;
    const details = quiz.questions.map((q) => {
      const userAnswer = answers[String(q.number)] ?? null;
      const isCorrect = answersEqual(userAnswer, q.correctAnswers);
      if (isCorrect) correct += 1;
      return {
        number: q.number,
        question: q.question,
        userAnswer,
        correctAnswers: q.correctAnswers,
        isCorrect,
        explanation: q.explanation || null,
      };
    });

    const total = quiz.questions.length;
    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;

    res.json({ total, correct, incorrect: total - correct, percentage, details });
  } catch (error) {
    res.status(404).json({ message: 'Quiz not found.' });
  }
});
```

- [ ] **Step 2: Extend the smoke test**

Append to `practice-web/scripts/smoke-test-quiz-api.sh` (before the final `echo "All smoke tests passed."` line):

```bash
echo "--- POST /api/quiz/01-compute-services/score (single-answer scoring) ---"
QUIZ_JSON=$(curl -sf http://localhost:3000/api/quiz/01-compute-services)
FIRST_ANSWER=$(echo "$QUIZ_JSON" | node -e '
  let data=""; process.stdin.on("data",d=>data+=d); process.stdin.on("end",()=>{
    const q = JSON.parse(data).questions[0];
    console.log(JSON.stringify({ [q.number]: q.correctAnswers[0] }));
  });
')
SCORE=$(curl -sf -X POST http://localhost:3000/api/quiz/01-compute-services/score \
  -H "Content-Type: application/json" \
  -d "{\"answers\": $FIRST_ANSWER}")
echo "$SCORE" | node -e '
  let data=""; process.stdin.on("data",d=>data+=d); process.stdin.on("end",()=>{
    const r = JSON.parse(data);
    if (r.correct !== 1) throw new Error("expected exactly 1 correct answer, got " + r.correct);
    console.log("OK: single-answer scoring counted the known-correct answer as correct");
  });
'

echo "--- Multi-select scoring: exact-set match required ---"
MULTI_SLUG=$(node -e '
  const fs = require("fs");
  for (const f of fs.readdirSync("practice-web/data/quizzes")) {
    const d = JSON.parse(fs.readFileSync(`practice-web/data/quizzes/${f}`, "utf8"));
    const multi = d.questions.find(q => q.correctAnswers.length > 1);
    if (multi) { console.log(d.slug); process.exit(0); }
  }
  process.exit(1);
' || echo "")
if [ -n "$MULTI_SLUG" ]; then
  MULTI_QUIZ=$(curl -sf "http://localhost:3000/api/quiz/$MULTI_SLUG")
  MULTI_Q=$(echo "$MULTI_QUIZ" | node -e '
    let data=""; process.stdin.on("data",d=>data+=d); process.stdin.on("end",()=>{
      const q = JSON.parse(data).questions.find(q => q.correctAnswers.length > 1);
      console.log(JSON.stringify(q));
    });
  ')
  PARTIAL_ANSWER=$(echo "$MULTI_Q" | node -e '
    let data=""; process.stdin.on("data",d=>data+=d); process.stdin.on("end",()=>{
      const q = JSON.parse(data);
      console.log(JSON.stringify({ [q.number]: [q.correctAnswers[0]] })); // only 1 of 2 correct letters
    });
  ')
  FULL_ANSWER=$(echo "$MULTI_Q" | node -e '
    let data=""; process.stdin.on("data",d=>data+=d); process.stdin.on("end",()=>{
      const q = JSON.parse(data);
      console.log(JSON.stringify({ [q.number]: q.correctAnswers }));
    });
  ')
  PARTIAL_SCORE=$(curl -sf -X POST "http://localhost:3000/api/quiz/$MULTI_SLUG/score" -H "Content-Type: application/json" -d "{\"answers\": $PARTIAL_ANSWER}")
  FULL_SCORE=$(curl -sf -X POST "http://localhost:3000/api/quiz/$MULTI_SLUG/score" -H "Content-Type: application/json" -d "{\"answers\": $FULL_ANSWER}")
  echo "$PARTIAL_SCORE" | node -e '
    let data=""; process.stdin.on("data",d=>data+=d); process.stdin.on("end",()=>{
      if (JSON.parse(data).correct !== 0) throw new Error("a partial multi-select answer must NOT count as correct");
      console.log("OK: partial multi-select answer scored as incorrect");
    });
  '
  echo "$FULL_SCORE" | node -e '
    let data=""; process.stdin.on("data",d=>data+=d); process.stdin.on("end",()=>{
      if (JSON.parse(data).correct !== 1) throw new Error("the exact correct set must count as correct");
      console.log("OK: exact multi-select answer set scored as correct");
    });
  '
else
  echo "SKIP: no multi-select question found in any generated quiz (unexpected — check classify.js)"
fi
```

- [ ] **Step 3: Run the smoke test**

Run: `practice-web/scripts/smoke-test-quiz-api.sh`
Expected: all OK lines print, ending with "All smoke tests passed." If the multi-select block prints SKIP, stop and investigate — Task 5's build output should contain multi-select questions in several quizzes (105 were parsed); a SKIP here means something upstream silently dropped them.

- [ ] **Step 4: Commit**

```bash
git add practice-web/server.js practice-web/scripts/smoke-test-quiz-api.sh
git commit -m "$(cat <<'EOF'
Add POST /api/quiz/:slug/score with multi-select support

Scoring now normalizes both single-letter and array answers and
requires an exact set match for multi-select questions (AWS's own
all-or-nothing convention for "choose two" questions).
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend — ship the recovered baseline UI

**Files:**
- Modify: `practice-web/public/index.html`
- Modify: `practice-web/public/app.js`
- Modify: `practice-web/public/styles.css`

**Interfaces:**
- Consumes: `GET /api/config`, `/api/docs`, `/api/docs/:slug`, `/api/quiz/:slug`, `/api/quiz/:slug/score`, `/api/exam`, `/api/exam/score` (all from Tasks 6–7 plus existing exam routes).
- Produces: a working dashboard/doc-reader/quiz/exam UI, matching the live deployment exactly (single-select only at this step — multi-select is Task 9).

This task ships the three files **exactly as recovered** from the live deployment during investigation (already fetched and saved to the scratchpad this session) — no modification yet. This is deliberately a separate, revertible step from Task 9's multi-select work, so a regression in either is easy to isolate.

- [ ] **Step 1: Copy the recovered files into place**

```bash
cp /tmp/claude-1000/-home-kaitovu-projects-aws-saa-c03-prac/a8dbdd40-99b0-4880-8e9b-1a76e10cd26a/scratchpad/live-index.html practice-web/public/index.html
cp /tmp/claude-1000/-home-kaitovu-projects-aws-saa-c03-prac/a8dbdd40-99b0-4880-8e9b-1a76e10cd26a/scratchpad/live-app.js practice-web/public/app.js
cp /tmp/claude-1000/-home-kaitovu-projects-aws-saa-c03-prac/a8dbdd40-99b0-4880-8e9b-1a76e10cd26a/scratchpad/live-styles.css practice-web/public/styles.css
```

If the scratchpad files are no longer available (different session), re-fetch them instead:

```bash
curl -s https://practice-web-aws.vercel.app/ -o practice-web/public/index.html
curl -s https://practice-web-aws.vercel.app/app.js -o practice-web/public/app.js
curl -s https://practice-web-aws.vercel.app/styles.css -o practice-web/public/styles.css
```

Either way, open `practice-web/public/index.html` afterward and confirm the `<link>`/`<script>` tags point to `/styles.css` and `/app.js` (no query-string cache-busters like `?v=3` need to be stripped — Express's `express.static` serves the same file regardless of query string, so leaving them is harmless).

- [ ] **Step 2: Start the server and verify manually with curl**

Run: `cd practice-web && node server.js &` then:

```bash
curl -sf http://localhost:3000/ | grep -q 'id="app"' && echo "OK: index.html served"
curl -sf http://localhost:3000/app.js | grep -q 'renderDashboard' && echo "OK: app.js served"
curl -sf http://localhost:3000/styles.css | grep -q 'quiz-option' && echo "OK: styles.css served"
```

Expected: all three OK lines.

- [ ] **Step 3: Browser verification (webapp-testing skill)**

Use the `webapp-testing` skill's Playwright helper to load `http://localhost:3000/`, confirm:
- The dashboard renders with "CORE SERVICE GUIDES" and "ARCHITECTURE GUIDES" sections, each doc card showing a "Not started" badge and Quiz/Read buttons.
- The "0/20 Quizzes completed" counter is visible.
- Clicking "Quiz" on `01-compute-services` navigates to `#/quiz/01-compute-services`, shows the intro screen, and clicking "Start Quiz" shows a real compute question (not a placeholder) with 4 options.
- Selecting an option immediately reveals correct/incorrect styling (existing single-select behavior, unchanged).
- Stop the dev server afterward (`kill %1` or equivalent).

- [ ] **Step 4: Commit**

```bash
git add practice-web/public/index.html practice-web/public/app.js practice-web/public/styles.css
git commit -m "$(cat <<'EOF'
Recover and ship the missing quiz dashboard/UI

This frontend existed only on a live Vercel deployment that was never
pushed to this repo (deployed from a local folder, not git-connected).
Recovered byte-for-byte via HTTP from the live site's static assets.
Multi-select UI support follows in the next commit.
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Frontend — multi-select quiz UI

**Files:**
- Modify: `practice-web/public/app.js`

**Interfaces:**
- Consumes: `q.correctAnswers: string[]` from `GET /api/quiz/:slug` (Task 6). `state.quizAnswers[number]` becomes `string | string[]`.
- Produces: multi-select questions render checkboxes + a "Check answer" button instead of auto-revealing radios; scoring/result display handles both shapes uniformly via a new `answersMatch` client helper.

- [ ] **Step 1: Add the `answersMatch` helper**

In `practice-web/public/app.js`, add near the top (after the `esc` helper, around line 46):

```js
function answersMatch(a, b) {
  const na = (Array.isArray(a) ? a : a ? [a] : []).slice().sort();
  const nb = (Array.isArray(b) ? b : b ? [b] : []).slice().sort();
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}
```

- [ ] **Step 2: Update `renderQuizQuestion` to branch on single vs. multi-select**

Replace the existing `renderQuizQuestion` function's option-building and nav-button-building logic (the parts that reference `q.correctAnswer` singular) to use `q.correctAnswers` (array) and branch on `q.correctAnswers.length > 1`:

```js
function renderQuizQuestion() {
  const questions = state.quiz.questions;
  const q = questions[state.quizIndex];
  const total = questions.length;
  const answered = state.quizRevealed[String(q.number)];
  const userAnswer = state.quizAnswers[String(q.number)];
  const isMulti = q.correctAnswers.length > 1;
  const selectedSet = new Set(Array.isArray(userAnswer) ? userAnswer : userAnswer ? [userAnswer] : []);
  const pct = Math.round((state.quizIndex / total) * 100);

  const navBtns = questions.map((qi, i) => {
    let cls = 'qnav-btn';
    if (i === state.quizIndex) {
      cls += ' active';
    } else if (state.quizRevealed[String(qi.number)]) {
      const userAns = state.quizAnswers[String(qi.number)];
      const hasAnswer = Array.isArray(userAns) ? userAns.length > 0 : Boolean(userAns);
      if (!hasAnswer) cls += ' skipped';
      else if (answersMatch(userAns, qi.correctAnswers)) cls += ' correct';
      else cls += ' incorrect';
    }
    return `<button class="${cls}" data-qi="${i}">${i + 1}</button>`;
  }).join('');

  const optionHtml = ['A', 'B', 'C', 'D'].map(key => {
    let cls = 'quiz-option';
    const isCorrectOption = q.correctAnswers.includes(key);
    const isSelected = selectedSet.has(key);
    if (answered) {
      cls += ' answered';
      if (isCorrectOption) cls += ' correct';
      else if (isSelected) cls += ' incorrect';
    } else if (isSelected) {
      cls += ' selected';
    }
    const inputType = isMulti ? 'checkbox' : 'radio';
    return `
      <label class="${cls}" data-key="${key}">
        <input type="${inputType}" name="quiz-opt" value="${key}" ${isSelected ? 'checked' : ''} ${answered ? 'disabled' : ''}>
        <span class="quiz-option-key">${key}</span>
        <span class="quiz-option-text">${esc(q.options[key] || '')}</span>
      </label>`;
  }).join('');

  let feedback = '';
  if (answered) {
    const isCorrect = answersMatch(userAnswer, q.correctAnswers);
    const icon = isCorrect ? '&#10004;' : '&#10008;';
    const correctLabel = q.correctAnswers.join(', ');
    const label = isCorrect ? 'Correct!' : `Incorrect &mdash; Correct answer: <strong>${correctLabel}</strong>`;
    feedback = `
      <div class="quiz-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="quiz-feedback-header">${icon} ${label}</div>
        ${q.explanation ? `<div class="quiz-feedback-explanation">${esc(q.explanation)}</div>` : ''}
      </div>`;
  }

  const isLast = state.quizIndex === total - 1;
  const allAnswered = questions.every(qi => state.quizRevealed[String(qi.number)]);
  const hasSelection = selectedSet.size > 0;

  app.innerHTML = `
    <div class="quiz-layout">
      <div>
        <div class="quiz-card">
          <div class="quiz-card-header">
            <span class="quiz-q-label">Question ${state.quizIndex + 1} of ${total}${isMulti ? ' &middot; Choose ' + q.correctAnswers.length : ''}</span>
            <span class="tag tag-blue">${esc(state.docs.find(d => d.slug === state.quizSlug)?.title || '')}</span>
          </div>
          <div class="quiz-question-text">${esc(q.question)}</div>
          <div class="quiz-options">${optionHtml}</div>
          ${feedback}
          <div class="quiz-nav-actions">
            <button class="btn btn-ghost" id="quizPrev" ${state.quizIndex === 0 ? 'disabled' : ''}>&#8592; Prev</button>
            <div style="display:flex;gap:8px">
              ${!answered && isMulti ? `<button class="btn btn-primary" id="quizCheckAnswer" ${hasSelection ? '' : 'disabled'}>Check answer</button>` : ''}
              ${!answered && !isMulti ? `<button class="btn btn-ghost" id="quizSkip">Skip</button>` : ''}
              ${answered && !isLast ? `<button class="btn btn-primary" id="quizNext">Next &#8594;</button>` : ''}
              ${answered && isLast ? `<button class="btn btn-success" id="quizFinish">See Results</button>` : ''}
              ${!answered && isLast && allAnswered ? `<button class="btn btn-success" id="quizFinish">See Results</button>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="quiz-sidebar">
        <div class="quiz-sidebar-title">Progress</div>
        <div class="quiz-progress-text">${Object.keys(state.quizRevealed).length} / ${total} answered</div>
        <div class="quiz-progress-track" style="margin-bottom:12px">
          <div class="quiz-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="quiz-nav-grid">${navBtns}</div>
        <a class="btn btn-ghost" href="#/dashboard" style="width:100%;justify-content:center;font-size:13px">Exit Quiz</a>
      </div>
    </div>
  `;

  bindQuizEvents(questions);
}
```

- [ ] **Step 3: Update `bindQuizEvents` to branch on single vs. multi-select**

Replace the option-click and skip-button parts of `bindQuizEvents`:

```js
function bindQuizEvents(questions) {
  const q = questions[state.quizIndex];
  const isMulti = q.correctAnswers.length > 1;

  document.querySelectorAll('.quiz-option:not(.answered)').forEach(opt => {
    opt.addEventListener('click', () => {
      const key = opt.dataset.key;
      if (isMulti) {
        const current = Array.isArray(state.quizAnswers[String(q.number)]) ? state.quizAnswers[String(q.number)].slice() : [];
        const idx = current.indexOf(key);
        if (idx === -1) current.push(key); else current.splice(idx, 1);
        state.quizAnswers[String(q.number)] = current;
      } else {
        state.quizAnswers[String(q.number)] = key;
        state.quizRevealed[String(q.number)] = true;
      }
      renderQuizQuestion();
    });
  });

  document.getElementById('quizCheckAnswer')?.addEventListener('click', () => {
    state.quizRevealed[String(q.number)] = true;
    renderQuizQuestion();
  });

  // Nav buttons
  document.querySelectorAll('.qnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.quizIndex = Number(btn.dataset.qi);
      renderQuizQuestion();
    });
  });

  document.getElementById('quizPrev')?.addEventListener('click', () => {
    state.quizIndex = Math.max(0, state.quizIndex - 1);
    renderQuizQuestion();
  });

  document.getElementById('quizNext')?.addEventListener('click', () => {
    state.quizIndex = Math.min(questions.length - 1, state.quizIndex + 1);
    renderQuizQuestion();
  });

  document.getElementById('quizSkip')?.addEventListener('click', () => {
    state.quizRevealed[String(q.number)] = true;
    const next = questions.findIndex((qi, i) => i > state.quizIndex && !state.quizRevealed[String(qi.number)]);
    if (next !== -1) state.quizIndex = next;
    renderQuizQuestion();
  });

  document.getElementById('quizFinish')?.addEventListener('click', submitQuiz);
}
```

- [ ] **Step 4: Update `renderQuizResult`'s detail rendering for array answers**

In `renderQuizResult`, replace the `detailsHtml` mapping (references `d.correctAnswer` singular from the old contract; the server now sends `d.correctAnswers` array from Task 7):

```js
  const detailsHtml = r.details.map(d => {
    const userWrong = d.userAnswer && !d.isCorrect;
    const userAnswerLabel = Array.isArray(d.userAnswer) ? (d.userAnswer.join(', ') || '—') : (d.userAnswer || '—');
    const correctLabel = Array.isArray(d.correctAnswers) ? d.correctAnswers.join(', ') : d.correctAnswers;
    return `
      <div class="detail-item">
        <div class="detail-item-header">
          <span class="detail-status">${d.isCorrect ? '&#10004;' : '&#10008;'}</span>
          <span class="detail-q">${esc(d.question)}</span>
        </div>
        <div class="detail-answers">
          <span class="detail-answer ${userWrong ? 'your-wrong' : ''}">
            Your answer: <strong>${esc(userAnswerLabel)}</strong>
          </span>
          ${!d.isCorrect ? `<span class="detail-answer correct-ans">Correct: <strong>${esc(correctLabel)}</strong></span>` : ''}
        </div>
        ${d.explanation ? `<div class="detail-explanation">${esc(d.explanation)}</div>` : ''}
      </div>`;
  }).join('');
```

- [ ] **Step 5: Browser verification (webapp-testing skill)**

Start `node practice-web/server.js`, use Playwright to:
- Open a quiz slug known to contain a multi-select question (from Task 7's smoke test, e.g. whichever `$MULTI_SLUG` it found — check `practice-web/data/quizzes/*.json` for a `correctAnswers.length > 1` entry if unsure).
- Navigate to that question, confirm checkboxes render (not radio buttons) and "Check answer" is disabled until at least one is checked.
- Select only one of the two correct options, click "Check answer" — confirm it's marked incorrect and both correct options are highlighted green.
- Retry the quiz, select exactly the correct set, click "Check answer" — confirm it's marked correct.
- Complete the quiz and confirm the result screen renders the multi-select question's answers as comma-joined text, not `[object Object]` or similar.
- Re-verify a single-select quiz (e.g. `01-compute-services`) still auto-reveals on click with no "Check answer" button — confirming Task 9 didn't regress Task 8's baseline.

- [ ] **Step 6: Commit**

```bash
git add practice-web/public/app.js
git commit -m "$(cat <<'EOF'
Add multi-select support to the quiz UI

Questions with more than one correct answer now render checkboxes
and a "Check answer" button instead of auto-revealing on the first
click. Scoring uses exact-set matching client-side (answersMatch),
mirroring the server's POST /api/quiz/:slug/score logic.
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Full regression pass and final verification

**Files:** none (verification only)

**Interfaces:** consumes the complete app from Tasks 1–9.

- [ ] **Step 1: Run every automated check in sequence**

```bash
cd practice-web
node --test scripts/lib/*.test.js
./scripts/smoke-test-quiz-api.sh
```

Expected: all `node:test` suites pass, smoke test script ends with "All smoke tests passed."

- [ ] **Step 2: Full browser walkthrough (webapp-testing skill)**

With `node server.js` running, use Playwright to walk through, in order:
1. Dashboard loads, shows "0/20" (or reflects any quizzes already completed during Steps 5–9 testing — that's expected state carried in `localStorage`).
2. Open `01-compute-services` guide via "Read" — confirm the markdown renders as HTML with a working "Take Quiz" button.
3. Complete a full single-select quiz end to end (all questions, both correct and incorrect answers), confirm the result screen shows a percentage and pass/fail styling, and the dashboard now shows that quiz's score badge.
4. Complete a full multi-select-containing quiz end to end.
5. Open the **existing 65-question exam** (`#/exam`) — confirm it still starts, the timer counts down, submitting produces a scaled `/1000` score, and this path was untouched by any of the above (no console errors, no broken layout).
6. Check the browser console for any JS errors across all of the above — zero tolerance.

- [ ] **Step 3: Confirm the exam path's data file is untouched**

Run: `git status practice-web/practices/S-practice-exam.md` — expect no output (clean, unmodified) since this file was never touched by any task in this plan.

- [ ] **Step 4: Final commit (if Step 2's manual testing revealed any fixes)**

If Steps 1–3 are all clean, there's nothing to commit here — Task 9's commit is the final state. If manual testing surfaced a bug, fix it, re-run Steps 1–2, then:

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix issue found during end-to-end verification: <describe>
EOF
)
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Report status to the user**

Summarize: what's now working locally, the final per-quiz question counts from Task 5's build output, and an explicit reminder that deployment to Vercel is intentionally not done — it's gated on the user granting Vercel MCP access, per the spec's scope section.

---

## Explicitly out of scope (do not implement)

- Anything touching `S-practice-exam.md` or `/api/exam*`.
- Running `vercel --prod`, `vercel deploy`, `vercel link`, or any other deploy command.
- Writing explanation text for dump-sourced questions.
- Any visual redesign beyond what Task 9 needs for multi-select — Task 8's recovered baseline is the target design as-is.

import { mountChatWidget, explainCurrent } from './chatbot.js';

const app = document.getElementById('app');

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  config: null,
  docs: [],

  // Quiz (per-doc, study mode)
  quiz: null,
  quizSlug: null,
  quizStep: 'intro', // 'intro' | 'question' | 'result'
  quizIndex: 0,
  quizAnswers: {},   // { questionNumber: letter }
  quizRevealed: {},  // { questionNumber: true } — answered questions
  quizResult: null,

  // Main timed exam
  exam: null,
  examStarted: false,
  examIndex: 0,
  examAnswers: {},
  examEndAt: null,
  examTimerId: null,
  examResult: null,

  // Daily drill (small random sets, e.g. 5 questions/day)
  drillStep: 'setup', // 'setup' | 'question' | 'result'
  drillForm: { topics: [], singleTopic: '', scope: 'mixed', count: 5, mode: 'random' }, // scope: 'mixed' | 'single', mode: 'random' | 'unseen' | 'seen'
  drillSet: [],
  drillIndex: 0,
  drillAnswers: {},
  drillRevealed: {},
  drillResult: null,
  drillNotice: '',
};

const EXAM_STORE = 'saa_exam_v1';
const QUIZ_PROGRESS = 'saa_quiz_progress_v1';
const DRILL_HISTORY = 'saa_drill_history_v1';
const DRILL_SESSIONS = 'saa_drill_sessions_v1';

// ── Chat context ───────────────────────────────────────────────────────────
// Tracks what the user is currently looking at, for the chatbot widget.
// Reset at the top of route() and set by the view renderers below.
let chatContext = null;
export function getChatContext() { return chatContext; }
export function getChatConfig() { return state.config?.chat || null; }

// ── Helpers ────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.message || 'Request failed');
  }
  return r.json();
}

// Opens a web search for the question, where people discuss the answer.
function lookupUrl(q) {
  const words = String(q.question || '').replace(/\s+/g, ' ').split(' ').slice(0, 18).join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(`SAA-C03 "${words}" examtopics OR examprepper`);
}
function lookupLink(q) {
  return `<a class="btn btn-ghost" href="${lookupUrl(q)}" target="_blank" rel="noopener noreferrer">Look up this question</a>`;
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function setHash(h) { if (location.hash !== h) location.hash = h; }

function answersMatch(a, b) {
  const na = (Array.isArray(a) ? a : a ? [a] : []).slice().sort();
  const nb = (Array.isArray(b) ? b : b ? [b] : []).slice().sort();
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtTime(secs) {
  const s = Math.max(0, secs);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

// Quiz progress stored per slug in localStorage
function quizProgress() {
  try { return JSON.parse(localStorage.getItem(QUIZ_PROGRESS) || '{}'); }
  catch { return {}; }
}

function saveQuizProgress(slug, data) {
  const all = quizProgress();
  all[slug] = { ...all[slug], ...data };
  localStorage.setItem(QUIZ_PROGRESS, JSON.stringify(all));
}

function getQuizScore(slug) {
  return quizProgress()[slug] || null;
}

// Count completed quizzes
function completedCount(docs) {
  const prog = quizProgress();
  return docs.filter(d => d.hasQuiz && prog[d.slug]).length;
}

// ── Drill / question history ───────────────────────────────────────────────
// Tracks every question the user has seen (collected/answered) across both
// per-topic quizzes and daily drills, so drills can sample:
//   random — any question,  unseen — never collected,  seen — already collected
// Key: `${slug}:${number}` → { attempts, correct, lastAt, lastCorrect }
function drillHistory() {
  try { return JSON.parse(localStorage.getItem(DRILL_HISTORY) || '{}'); }
  catch { return {}; }
}

function drillSessions() {
  try { return JSON.parse(localStorage.getItem(DRILL_SESSIONS) || '[]'); }
  catch { return []; }
}

function saveDrillSession(r, mode) {
  try {
    const all = drillSessions();
    all.unshift({
      id: Date.now(), at: new Date().toISOString(), mode,
      total: r.total, correct: r.correct, percentage: r.percentage,
      details: r.details.map(d => ({
        slug: d.slug, number: d.number, topic: d.topic, question: d.question,
        options: d.options, userAnswer: d.userAnswer, correctAnswers: d.correctAnswers, isCorrect: d.isCorrect,
      })),
    });
    localStorage.setItem(DRILL_SESSIONS, JSON.stringify(all.slice(0, 60)));
  } catch { /* storage full/blocked — best effort */ }
}

function historyKey(slug, number) {
  return `${slug}:${number}`;
}

function isSeen(slug, number) {
  return Boolean(drillHistory()[historyKey(slug, number)]);
}

function markSeen(slug, number, wasCorrect) {
  try {
    const all = drillHistory();
    const key = historyKey(slug, number);
    const prev = all[key] || { attempts: 0, correct: 0 };
    all[key] = {
      attempts: prev.attempts + 1,
      correct: prev.correct + (wasCorrect ? 1 : 0),
      lastAt: new Date().toISOString(),
      lastCorrect: Boolean(wasCorrect),
    };
    localStorage.setItem(DRILL_HISTORY, JSON.stringify(all));
  } catch { /* storage full/blocked — history is best-effort */ }
}

function seenStats(slugs) {
  const hist = drillHistory();
  let seen = 0, total = 0;
  const perSlug = {};
  for (const slug of slugs) {
    const quiz = quizCache[slug];
    const n = quiz ? quiz.questions.length : 0;
    perSlug[slug] = { seen: 0, total: n };
    total += n;
  }
  for (const key of Object.keys(hist)) {
    const idx = key.lastIndexOf(':');
    const slug = key.slice(0, idx);
    if (slug in perSlug) {
      perSlug[slug].seen += 1;
      seen += 1;
    }
  }
  return { seen, total, perSlug };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Cache of fetched quizzes so drill setup doesn't refetch on every keystroke
const quizCache = {};

// ── Exam persistence ────────────────────────────────────────────────────────
function saveExam() {
  localStorage.setItem(EXAM_STORE, JSON.stringify({
    examStarted: state.examStarted,
    examIndex: state.examIndex,
    examAnswers: state.examAnswers,
    examEndAt: state.examEndAt,
    examResult: state.examResult,
  }));
}

function loadExam() {
  try {
    const d = JSON.parse(localStorage.getItem(EXAM_STORE) || 'null');
    if (!d) return;
    state.examStarted = Boolean(d.examStarted);
    state.examIndex = Number(d.examIndex || 0);
    state.examAnswers = d.examAnswers && typeof d.examAnswers === 'object' ? d.examAnswers : {};
    state.examEndAt = d.examEndAt || null;
    state.examResult = d.examResult || null;
  } catch { localStorage.removeItem(EXAM_STORE); }
}

function clearExam() {
  localStorage.removeItem(EXAM_STORE);
  state.examStarted = false;
  state.examIndex = 0;
  state.examAnswers = {};
  state.examEndAt = null;
  state.examResult = null;
}

// ── Timer ──────────────────────────────────────────────────────────────────
function stopTimer() {
  if (state.examTimerId) { clearInterval(state.examTimerId); state.examTimerId = null; }
}

function examSecsLeft() {
  if (!state.examEndAt) return state.config?.examDurationSeconds ?? 0;
  return Math.round((state.examEndAt - Date.now()) / 1000);
}

function timerClass(s) {
  if (s <= 300) return 'timer danger';
  if (s <= 900) return 'timer warning';
  return 'timer';
}

function startTimer(onExpire) {
  stopTimer();
  state.examTimerId = setInterval(() => {
    const s = examSecsLeft();
    const el = document.getElementById('exam-timer');
    if (el) { el.className = timerClass(s); el.textContent = fmtTime(s); }
    if (s <= 0) { stopTimer(); onExpire(); }
  }, 1000);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function bootstrap() {
  app.innerHTML = '<div class="page-message"><p>Loading…</p></div>';
  const [config, docs] = await Promise.all([api('/api/config'), api('/api/docs')]);
  state.config = config;
  state.docs = docs;
  loadExam();
  route();
}

// ── Dashboard grouping ───────────────────────────────────────────────────────
// Scenario-based grouping (per practices/SUMMARY.md), layered on top of the
// existing numbered Core Service Guides rather than replacing them — both
// structures live in practices/ and both stay navigable.
const LETTER_GROUP = {
  A: 'foundation', B: 'security',
  C: 'patterns', D: 'patterns', E: 'patterns',
  K: 'examprep', L: 'examprep', M: 'examprep',
  P: 'reference', Q: 'reference', R: 'reference', T: 'reference',
};

// Matches a single capital letter followed by "-" (A-foo.md, B-bar.md, ...).
// README.md / SUMMARY.md deliberately don't match this (no hyphen after the
// first letter), so they fall through to the reference group instead of
// colliding with R-performance-benchmarks.md / S-practice-exam.md.
function letterPrefix(filename) {
  const m = filename.match(/^([A-Z])-/);
  return m ? m[1] : null;
}

function groupDocs(docs) {
  const groups = { foundation: [], security: [], patterns: [], examprep: [], reference: [] };
  for (const d of docs) {
    const letter = letterPrefix(d.filename);
    const key = (letter && LETTER_GROUP[letter]) || 'reference';
    groups[key].push(d);
  }
  return groups;
}

const ROADMAP = [
  {
    phase: 'Tuần 1-2', title: 'Foundation', hours: '15-20h', priority: 'required',
    note: 'Well-Architected Framework, Shared Responsibility Model, IAM & security basics (30% of the exam).',
    slugs: ['a-nen-tang-kien-truc', 'b-bao-mat-compliance'],
  },
  {
    phase: 'Tuần 3-4', title: 'Architecture Patterns', hours: '25-30h', priority: 'required',
    note: 'Compute, storage, and database patterns — redraw the architecture diagrams as you go.',
    slugs: ['c-kien-truc-web-app', 'd-kien-truc-luu-tru', 'e-kien-truc-database'],
  },
  {
    phase: 'Tuần 5', title: 'Exam Practice', hours: '20-25h', priority: 'important',
    note: '50+ real scenario questions, decision trees, and keyword mapping.',
    slugs: ['k-kich-ban-thi', 'l-quyet-dinh-nhanh', 'm-keywords-mapping'],
  },
  {
    phase: 'Tuần 6', title: 'Review & Mock Exams', hours: '10-15h', priority: 'review',
    note: 'Re-run the decision trees and scenarios, then take 3-4 full practice exams.',
    slugs: ['l-quyet-dinh-nhanh', 'm-keywords-mapping'],
  },
];

function roadmapPanel(docs) {
  const bySlug = Object.fromEntries(docs.map(d => [d.slug, d]));
  const phaseHtml = ROADMAP.map(phase => {
    const links = phase.slugs
      .map(slug => bySlug[slug])
      .filter(Boolean)
      .map(d => `<a class="roadmap-link" href="#/doc/${d.slug}">${esc(d.title)}</a>`)
      .join('');
    return `
      <div class="roadmap-phase">
        <div class="roadmap-phase-header">
          <span class="roadmap-phase-name">${esc(phase.phase)}</span>
          <span class="roadmap-priority roadmap-priority-${phase.priority}">${esc(phase.priority)}</span>
        </div>
        <div class="roadmap-phase-title">${esc(phase.title)}</div>
        <div class="roadmap-phase-hours">${esc(phase.hours)}</div>
        <p class="roadmap-phase-note">${esc(phase.note)}</p>
        <div class="roadmap-phase-links">${links}</div>
      </div>`;
  }).join('');

  return `
    <div class="section-group">
      <div class="section-header">Suggested Roadmap (6 weeks, ~70-90h total)</div>
      <div class="roadmap-track">${phaseHtml}</div>
    </div>`;
}

// ── Dashboard ──────────────────────────────────────────────────────────────
// One job: tell the learner what to do next. Topics are ranked weakest-first
// using the per-question history written by quizzes and drills.
function topicStats(slug) {
  const quiz = quizCache[slug];
  const total = quiz ? quiz.questions.length : 0;
  const hist = drillHistory();
  let seen = 0, right = 0, missed = 0;
  if (quiz) {
    for (const q of quiz.questions) {
      const h = hist[historyKey(slug, q.number)];
      if (!h) continue;
      seen += 1;
      if (h.lastCorrect) right += 1; else missed += 1;
    }
  }
  return { total, seen, right, missed };
}

async function renderDashboard() {
  const core = state.docs.filter(d => d.hasQuiz && /^\d/.test(d.filename));
  app.innerHTML = '<div class="page-message"><p>Loading…</p></div>';
  await Promise.all(core.map(d => ensureQuizCached(d.slug).catch(() => null)));
  if ((location.hash || '#/dashboard') !== '#/dashboard') return;

  const rows = core.map(d => ({ doc: d, ...topicStats(d.slug) }));
  const uniq = new Map(); // dump number -> { seen, missed }
  const hist0 = drillHistory();
  for (const d of core) {
    for (const q of (quizCache[d.slug]?.questions || [])) {
      const h = hist0[historyKey(d.slug, q.number)];
      const u = uniq.get(q.dumpNo ?? `${d.slug}:${q.number}`) || { seen: false, missed: false };
      if (h) { u.seen = true; if (!h.lastCorrect) u.missed = true; }
      uniq.set(q.dumpNo ?? `${d.slug}:${q.number}`, u);
    }
  }
  const totalQ = uniq.size;
  const seenQ = [...uniq.values()].filter(u => u.seen).length;
  const missedQ = [...uniq.values()].filter(u => u.missed).length;
  // Weakest first: most missed, then least seen.
  rows.sort((a, b) => (b.missed - a.missed) || (a.seen / (a.total || 1)) - (b.seen / (b.total || 1)));

  const studyDocs = state.docs.filter(d => !d.isExam);
  const coreGuides = studyDocs.filter(d => /^\d/.test(d.filename));
  const otherGuides = studyDocs.filter(d => !/^\d/.test(d.filename));

  const newCount = Math.max(0, 10 - Math.min(10, missedQ));
  const next = missedQ > 0
    ? {
        label: newCount > 0
          ? `Redo ${missedQ} missed + ${newCount} new`
          : 'Redo 10 missed questions',
        mode: 'mixed',
        hint: `${missedQ} missed in total`,
      }
    : { label: 'Drill 10 new questions', mode: 'unseen', hint: `${totalQ - seenQ} not seen yet` };

  const rowHtml = rows.map(r => {
    const pctSeen = r.total ? Math.round((r.seen / r.total) * 100) : 0;
    const pctRight = r.total ? Math.round((r.right / r.total) * 100) : 0;
    const title = r.doc.title.replace(/^[^A-Za-z0-9]+/, '').replace(/ - AWS SAA-C03$/i, '')
      .toLowerCase().replace(/(^|[\s&(])([a-zà-ỹ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Ml|Ai|Api)\b/g, w => w.toUpperCase());
    return `
      <a class="topic-row" href="#/drill/${r.doc.slug}">
        <span class="topic-name">${esc(title)}</span>
        <span class="topic-bar" aria-hidden="true">
          <span class="topic-bar-seen" style="width:${pctSeen}%"></span>
          <span class="topic-bar-right" style="width:${pctRight}%"></span>
        </span>
        <span class="topic-figs">${r.missed ? `<b class="topic-missed">${r.missed} missed</b>` : ''}${r.seen}/${r.total} seen</span>
      </a>`;
  }).join('');

  app.innerHTML = `
    <section class="home-next">
      <div class="next-card">
        <div class="next-text">
          <p class="next-progress">${seenQ} of ${totalQ} questions seen</p>
          <h1 class="next-title">${esc(next.label)}</h1>
          <p class="home-hint">${esc(next.hint)} &middot; about 10 minutes</p>
        </div>
        <button class="next-btn" id="homeCta">Start drill</button>
      </div>
      <p class="home-error" id="homeError" role="alert"></p>
    </section>

    <section class="home-section">
      <h2>Topics, weakest first</h2>
      <div class="topic-list">${rowHtml}</div>
    </section>

    <section class="home-section home-exam">
      <div>
        <h2>Mock exam</h2>
        <p>65 questions, 130 minutes, pass at 720 of 1000.</p>
      </div>
      <a class="btn btn-primary" href="#/exam">Start mock exam</a>
    </section>

    <details class="home-guides">
      <summary>Study guides (${studyDocs.length})</summary>
      <div class="doc-grid">${[...coreGuides, ...otherGuides].map(docCard).join('')}</div>
      ${roadmapPanel(state.docs)}
    </details>
  `;

  document.getElementById('homeCta').addEventListener('click', () => {
    const r = buildDrillSet(core.map(d => d.slug), 10, next.mode);
    if (r.error) { document.getElementById('homeError').textContent = r.error; return; }
    launchDrillSet(r.set, r.notice);
    setHash('#/drill');
  });
}

function docCard(doc) {
  const prog = getQuizScore(doc.slug);
  let badge = '';
  if (prog) {
    const cls = prog.percentage >= 70 ? 'pass' : 'fail';
    badge = `<span class="score-badge ${cls}">&#10003; ${prog.percentage}%</span>`;
  } else if (doc.hasQuiz) {
    badge = `<span class="score-badge pending">Not started</span>`;
  }

  const quizBtn = doc.hasQuiz
    ? `<a class="btn btn-primary" href="#/quiz/${doc.slug}">Quiz</a>`
    : '';

  const drillBtn = doc.hasQuiz
    ? `<a class="btn btn-ghost" href="#/drill/${doc.slug}" title="Drill N questions from this topic">Drill</a>`
    : '';

  return `
    <div class="doc-card">
      <div class="doc-card-title">${esc(doc.title)}</div>
      <div class="doc-card-meta">
        <span class="doc-filename">${esc(doc.filename)}</span>
        ${badge}
      </div>
      <div class="doc-card-actions">
        <a class="btn btn-ghost" href="#/doc/${doc.slug}">Read</a>
        ${quizBtn}
        ${drillBtn}
      </div>
    </div>`;
}

// ── Doc view ───────────────────────────────────────────────────────────────
async function renderDoc(slug) {
  app.innerHTML = '<div class="page-message"><p>Loading…</p></div>';
  const doc = await api(`/api/docs/${encodeURIComponent(slug)}`);

  chatContext = {
    type: 'doc',
    title: doc.title,
    markdown: doc.markdown.length > 6000 ? doc.markdown.slice(0, 6000) : doc.markdown,
  };

  const quizBtn = doc.hasQuiz
    ? `<a class="btn btn-primary" href="#/quiz/${doc.slug}">Take Quiz</a>`
    : (doc.isExam ? `<a class="btn btn-primary" href="#/exam">Start Exam</a>` : '');

  app.innerHTML = `
    <div class="doc-view-header">
      <div>
        <h1 class="doc-view-title">${esc(doc.title)}</h1>
        <span class="doc-filename" style="font-size:12px;color:var(--text-dim)">${esc(doc.filename)}</span>
      </div>
      <div class="doc-view-actions">
        <a class="btn btn-ghost" href="#/dashboard">&#8592; Back</a>
        ${quizBtn}
      </div>
    </div>
    <div class="doc-body">${doc.html}</div>
  `;
  markDiagramBlocks();
}

// Box-drawing / tree-drawing characters used throughout the ASCII diagrams
// and decision trees (P-architecture-diagrams.md, L-quyet-dinh-nhanh.md).
// A code block containing several of these is a diagram, not a code sample —
// give it a distinct, wider, more legible treatment.
const DIAGRAM_CHAR_RE = /[┌┐└┘├┤┬┴┼─│▼▲►◄]/g;
function markDiagramBlocks() {
  document.querySelectorAll('.doc-body pre').forEach(pre => {
    const text = pre.textContent || '';
    const hits = text.match(DIAGRAM_CHAR_RE);
    if (hits && hits.length >= 4) pre.classList.add('diagram-block');
  });
}

// ── Quiz ───────────────────────────────────────────────────────────────────
async function renderQuiz(slug) {
  if (!state.quiz || state.quizSlug !== slug) {
    app.innerHTML = '<div class="page-message"><p>Loading…</p></div>';
    state.quiz = await api(`/api/quiz/${encodeURIComponent(slug)}`);
    quizCache[slug] = state.quiz;
    state.quizSlug = slug;
    state.quizStep = 'intro';
    state.quizIndex = 0;
    state.quizAnswers = {};
    state.quizRevealed = {};
    state.quizResult = null;
  }

  if (state.quizStep === 'intro') renderQuizIntro();
  else if (state.quizStep === 'result') renderQuizResult();
  else renderQuizQuestion();
}

function renderQuizIntro() {
  const doc = state.docs.find(d => d.slug === state.quizSlug);
  const title = doc ? doc.title : state.quizSlug;
  const n = state.quiz.totalQuestions;
  const prog = getQuizScore(state.quizSlug);
  const hist = drillHistory();
  const seenHere = state.quiz.questions.filter(q => hist[historyKey(state.quizSlug, q.number)]).length;

  const prevScore = prog
    ? `<p style="margin-top:12px;font-size:13px;color:var(--text-muted)">Previous best: <strong style="color:var(--text)">${prog.percentage}%</strong></p>`
    : '';

  app.innerHTML = `
    <div class="page-center" style="flex-direction:column;gap:16px">
      <div class="quiz-intro">
        <div class="quiz-intro-icon">&#128218;</div>
        <h2 class="quiz-intro-title">${esc(title)}</h2>
        <p class="quiz-intro-sub">Study mode &mdash; answers revealed after each question &middot; ${seenHere}/${n} collected</p>
        <div class="quiz-intro-stats">
          <div class="quiz-stat-item">
            <div class="quiz-stat-num">${n}</div>
            <div class="quiz-stat-label">Questions</div>
          </div>
          <div class="quiz-stat-item">
            <div class="quiz-stat-num">No</div>
            <div class="quiz-stat-label">Time Limit</div>
          </div>
          <div class="quiz-stat-item">
            <div class="quiz-stat-num">&#127775;</div>
            <div class="quiz-stat-label">Study Mode</div>
          </div>
        </div>
        ${prevScore}
        <button class="btn btn-primary" id="startQuizBtn" style="width:100%;justify-content:center;padding:12px">Start Full Quiz (${n})</button>
        <div style="margin-top:12px">
          <a class="btn btn-ghost" href="#/dashboard" style="width:100%;justify-content:center">Back to Dashboard</a>
        </div>
      </div>

      <div class="quiz-intro" style="padding:28px 40px">
        <h3 style="font-size:16px;margin-bottom:4px">Quick drill from this topic</h3>
        <p class="quiz-intro-sub" style="margin-bottom:16px">Pick N questions from <strong>${esc(title)}</strong> only</p>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input id="quickDrillCount" type="number" min="1" max="50" value="5" style="flex:0 0 90px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:15px;font-weight:700;padding:8px 12px">
          <select id="quickDrillMode" class="drill-select" style="flex:1">
            <option value="random">Random</option>
            <option value="unseen">Never collected (${n - seenHere} left)</option>
            <option value="seen" ${seenHere === 0 ? 'disabled' : ''}>Already collected (${seenHere})</option>
          </select>
        </div>
        <div id="quickDrillError" style="color:var(--danger);font-size:13px;min-height:18px;margin-bottom:8px"></div>
        <button class="btn btn-primary" id="quickDrillBtn" style="width:100%;justify-content:center;padding:12px">Drill this topic &rarr;</button>
      </div>
    </div>
  `;

  document.getElementById('startQuizBtn').addEventListener('click', () => {
    state.quizStep = 'question';
    state.quizIndex = 0;
    state.quizAnswers = {};
    state.quizRevealed = {};
    renderQuizQuestion();
  });

  document.getElementById('quickDrillBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('quickDrillError');
    const count = Math.max(1, Math.min(50, Number(document.getElementById('quickDrillCount').value) || 5));
    const mode = document.getElementById('quickDrillMode').value;
    quizCache[state.quizSlug] = state.quiz;
    const result = buildDrillSet([state.quizSlug], count, mode);
    if (result.error) { errEl.textContent = result.error; return; }
    state.drillForm.scope = 'single';
    state.drillForm.singleTopic = state.quizSlug;
    state.drillForm.topics = [state.quizSlug];
    state.drillForm.count = count;
    state.drillForm.mode = mode;
    launchDrillSet(result.set, result.notice);
    setHash('#/drill/' + state.quizSlug);
  });
}

function renderQuizQuestion() {
  const questions = state.quiz.questions;
  const q = questions[state.quizIndex];
  const total = questions.length;
  const answered = state.quizRevealed[String(q.number)];
  chatContext = answered
    ? { type: 'question', question: q.question, options: q.options, correctAnswers: q.correctAnswers, explanation: q.explanation }
    : { type: 'question', question: q.question, options: q.options };
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

  // Build option html — render however many options this specific question has
  const optionHtml = Object.keys(q.options).map(key => {
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

  // Feedback — shown after revealing
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
        <div class="feedback-actions">
          <button class="btn btn-ghost chat-explain-btn" id="quizExplainBtn" type="button">Explain this</button>
          ${lookupLink(q)}
        </div>
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

function bindQuizEvents(questions) {
  const q = questions[state.quizIndex];
  const isMulti = q.correctAnswers.length > 1;

  document.getElementById('quizExplainBtn')?.addEventListener('click', () => {
    explainCurrent();
  });

  // Option selection — single-select reveals immediately; multi-select accumulates
  // checked options until "Check answer" is clicked (answers included in study mode response)
  document.querySelectorAll('.quiz-option:not(.answered)').forEach(opt => {
    opt.addEventListener('click', (event) => {
      // Prevent the browser's default label→input click forwarding: without this,
      // clicking anywhere on the label except the tiny input itself dispatches a
      // second synthetic click (label click + forwarded input click), which would
      // double-toggle multi-select checkboxes and cancel the selection.
      event.preventDefault();
      const key = opt.dataset.key;
      if (isMulti) {
        const current = Array.isArray(state.quizAnswers[String(q.number)]) ? state.quizAnswers[String(q.number)].slice() : [];
        const idx = current.indexOf(key);
        if (idx === -1) current.push(key); else current.splice(idx, 1);
        state.quizAnswers[String(q.number)] = current;
      } else {
        state.quizAnswers[String(q.number)] = key;
        state.quizRevealed[String(q.number)] = true;
        markSeen(state.quizSlug, q.number, answersMatch(key, q.correctAnswers));
      }
      renderQuizQuestion();
    });
  });

  document.getElementById('quizCheckAnswer')?.addEventListener('click', () => {
    state.quizRevealed[String(q.number)] = true;
    markSeen(state.quizSlug, q.number, answersMatch(state.quizAnswers[String(q.number)], q.correctAnswers));
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
    markSeen(state.quizSlug, q.number, false); // skipped counts as collected, not correct
    // move to next unanswered or stay
    const next = questions.findIndex((qi, i) => i > state.quizIndex && !state.quizRevealed[String(qi.number)]);
    if (next !== -1) state.quizIndex = next;
    renderQuizQuestion();
  });

  document.getElementById('quizFinish')?.addEventListener('click', submitQuiz);
}

async function submitQuiz() {
  const result = await api(`/api/quiz/${encodeURIComponent(state.quizSlug)}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: state.quizAnswers }),
  });
  state.quizResult = result;
  state.quizStep = 'result';

  // Persist score
  saveQuizProgress(state.quizSlug, {
    percentage: result.percentage,
    correct: result.correct,
    total: result.total,
    lastAttempt: new Date().toISOString(),
  });

  renderQuizResult();
}

function renderQuizResult() {
  const r = state.quizResult;
  const doc = state.docs.find(d => d.slug === state.quizSlug);
  const pct = r.percentage;
  const pass = pct >= 70;

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

  app.innerHTML = `
    <div class="quiz-result">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <a class="btn btn-ghost" href="#/dashboard">&#8592; Dashboard</a>
        <span style="color:var(--text-muted);font-size:14px">${esc(doc?.title || state.quizSlug)}</span>
      </div>

      <div class="result-card">
        <div class="result-score ${pass ? 'pass' : 'fail'}">${pct}%</div>
        <div class="result-label">${pass ? '&#127881; Great job!' : '&#128218; Keep studying!'}</div>
        <div class="result-stats">
          <div class="result-stat">
            <div class="result-stat-num correct">${r.correct}</div>
            <div class="result-stat-label">Correct</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-num incorrect">${r.incorrect}</div>
            <div class="result-stat-label">Incorrect</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-num">${r.total}</div>
            <div class="result-stat-label">Total</div>
          </div>
        </div>
        <div class="result-actions">
          <button class="btn btn-ghost" id="retryQuizBtn">Retry Quiz</button>
          ${doc ? `<a class="btn btn-ghost" href="#/doc/${doc.slug}">Review Guide</a>` : ''}
          <a class="btn btn-primary" href="#/dashboard">Dashboard</a>
        </div>
      </div>

      <div class="result-details">${detailsHtml}</div>
    </div>
  `;

  document.getElementById('retryQuizBtn')?.addEventListener('click', () => {
    state.quizStep = 'intro';
    state.quiz = null; // Force reload
    renderQuiz(state.quizSlug);
  });
}

// ── Daily Drill (small random sets) ────────────────────────────────────────
async function ensureQuizCached(slug) {
  if (!quizCache[slug]) {
    quizCache[slug] = await api(`/api/quiz/${encodeURIComponent(slug)}`);
  }
  return quizCache[slug];
}

async function renderDrill() {
  if (state.drillStep === 'question') { renderDrillQuestion(); return; }
  if (state.drillStep === 'result') { renderDrillResult(); return; }
  await renderDrillSetup();
}

async function renderDrillSetup() {
  const quizzable = state.docs.filter(d => d.hasQuiz);
  if (!state.drillForm.topics.length) {
    state.drillForm.topics = quizzable.map(d => d.slug);
  }

  app.innerHTML = '<div class="page-message"><p>Loading topics…</p></div>';
  await Promise.all(quizzable.map(d => ensureQuizCached(d.slug).catch(() => null)));

  const stats = seenStats(quizzable.map(d => d.slug));
  const effTopics = state.drillForm.scope === 'single' && state.drillForm.singleTopic
    ? [state.drillForm.singleTopic]
    : state.drillForm.topics;
  const selected = new Set(state.drillForm.topics);
  const selStats = seenStats(effTopics.length ? effTopics : quizzable.map(d => d.slug));
  const selUnseen = selStats.total - selStats.seen;

  const topicRows = quizzable.map(d => {
    const s = stats.perSlug[d.slug] || { seen: 0, total: 0 };
    const unseen = s.total - s.seen;
    return `
      <label class="drill-topic">
        <input type="checkbox" data-topic="${esc(d.slug)}" ${selected.has(d.slug) ? 'checked' : ''}>
        <span class="drill-topic-title">${esc(d.title)}</span>
        <span class="drill-topic-count">${s.seen}/${s.total} seen</span>
      </label>`;
  }).join('');

  app.innerHTML = `
    <div class="drill-setup">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <a class="btn btn-ghost" href="#/dashboard">&#8592; Dashboard</a>
        <span style="color:var(--text-muted);font-size:14px">Daily Drill &middot; ${stats.seen}/${stats.total} collected overall</span>
      </div>

      <h1 class="doc-view-title" style="margin-bottom:6px">Daily Drill</h1>
      <p class="dashboard-sub" style="margin-bottom:20px">Pick how many questions, where from, and whether to see new or already-collected ones. Default is 5 random questions.</p>

      <div class="drill-card">
        <div class="drill-field">
          <label for="drillCount">Number of questions</label>
          <input id="drillCount" type="number" min="1" max="50" value="${state.drillForm.count}">
        </div>

        <div class="drill-field">
          <label>Collection mode</label>
          <div class="drill-modes">
            <label class="drill-mode ${state.drillForm.mode === 'random' ? 'active' : ''}">
              <input type="radio" name="drill-mode" value="random" ${state.drillForm.mode === 'random' ? 'checked' : ''}>
              <strong>Random</strong>
              <span>Any ${selStats.total} questions from selected topics</span>
            </label>
            <label class="drill-mode ${state.drillForm.mode === 'unseen' ? 'active' : ''}">
              <input type="radio" name="drill-mode" value="unseen" ${state.drillForm.mode === 'unseen' ? 'checked' : ''}>
              <strong>Never collected (${selUnseen} left)</strong>
              <span>Only questions you have never answered</span>
            </label>
            <label class="drill-mode ${state.drillForm.mode === 'seen' ? 'active' : ''}">
              <input type="radio" name="drill-mode" value="seen" ${state.drillForm.mode === 'seen' ? 'checked' : ''}>
              <strong>Already collected (${selStats.seen})</strong>
              <span>Review questions you answered before</span>
            </label>
          </div>
        </div>

        <div class="drill-field">
          <label>Topic scope</label>
          <div class="drill-modes">
            <label class="drill-mode ${state.drillForm.scope === 'mixed' ? 'active' : ''}">
              <input type="radio" name="drill-scope" value="mixed" ${state.drillForm.scope === 'mixed' ? 'checked' : ''}>
              <strong>Mixed topics</strong>
              <span>Pick any combination of topics below</span>
            </label>
            <label class="drill-mode ${state.drillForm.scope === 'single' ? 'active' : ''}">
              <input type="radio" name="drill-scope" value="single" ${state.drillForm.scope === 'single' ? 'checked' : ''}>
              <strong>Single specific topic</strong>
              <span>N questions from one topic only</span>
            </label>
          </div>
        </div>

        ${state.drillForm.scope === 'single' ? `
        <div class="drill-field">
          <label for="drillSingleTopic">Specific topic</label>
          <select id="drillSingleTopic" class="drill-select">
            ${quizzable.map(d => {
              const s = stats.perSlug[d.slug] || { seen: 0, total: 0 };
              return `<option value="${esc(d.slug)}" ${state.drillForm.singleTopic === d.slug ? 'selected' : ''}>${esc(d.title)} (${s.total - s.seen} unseen / ${s.total})</option>`;
            }).join('')}
          </select>
        </div>
        ` : `
        <div class="drill-field">
          <label>Topics (${state.drillForm.topics.length}/${quizzable.length} selected)</label>
          <div class="drill-actions-row">
            <button class="btn btn-ghost" id="drillAll" style="font-size:12px">Select all</button>
            <button class="btn btn-ghost" id="drillNone" style="font-size:12px">Clear</button>
          </div>
          <div class="drill-topics">${topicRows}</div>
        </div>
        `}

        <div id="drillError" style="color:var(--danger);font-size:13px;min-height:18px"></div>
        <button class="btn btn-primary" id="drillStart" style="width:100%;justify-content:center;padding:12px">Collect questions &rarr;</button>
      </div>
    </div>
  `;

  document.getElementById('drillCount').addEventListener('change', (e) => {
    const v = Math.max(1, Math.min(50, Number(e.target.value) || 5));
    state.drillForm.count = v;
    e.target.value = v;
  });

  document.querySelectorAll('input[name="drill-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      state.drillForm.mode = document.querySelector('input[name="drill-mode"]:checked').value;
      renderDrillSetup();
    });
  });

  document.querySelectorAll('input[name="drill-scope"]').forEach(r => {
    r.addEventListener('change', () => {
      state.drillForm.scope = document.querySelector('input[name="drill-scope"]:checked').value;
      if (state.drillForm.scope === 'single' && !state.drillForm.singleTopic) {
        state.drillForm.singleTopic = state.drillForm.topics[0] || quizzable[0]?.slug || '';
      }
      state.drillStep = 'setup';
      renderDrillSetup();
    });
  });

  document.getElementById('drillSingleTopic')?.addEventListener('change', (e) => {
    state.drillForm.singleTopic = e.target.value;
    renderDrillSetup();
  });

  document.querySelectorAll('[data-topic]').forEach(cb => {
    cb.addEventListener('change', () => {
      const slug = cb.dataset.topic;
      if (cb.checked) state.drillForm.topics.push(slug);
      else state.drillForm.topics = state.drillForm.topics.filter(s => s !== slug);
      renderDrillSetup();
    });
  });

  document.getElementById('drillAll')?.addEventListener('click', () => {
    state.drillForm.topics = quizzable.map(d => d.slug);
    renderDrillSetup();
  });
  document.getElementById('drillNone')?.addEventListener('click', () => {
    state.drillForm.topics = [];
    renderDrillSetup();
  });

  document.getElementById('drillStart').addEventListener('click', startDrill);
}

function effectiveDrillTopics() {
  if (state.drillForm.scope === 'single' && state.drillForm.singleTopic) {
    return [state.drillForm.singleTopic];
  }
  return state.drillForm.topics;
}

// Pure sampler shared by the drill setup page and single-topic quick drills.
// Returns { set, notice } or { error }.
function buildDrillSet(topicSlugs, count, mode) {
  const n = Math.max(1, Math.min(50, Number(count) || 5));
  if (!topicSlugs.length) return { error: 'Select at least one topic.' };

  const hist = drillHistory();
  let pool = [];
  for (const slug of topicSlugs) {
    const quiz = quizCache[slug];
    if (!quiz) continue;
    const title = state.docs.find(d => d.slug === slug)?.title || slug;
    for (const q of quiz.questions) {
      pool.push({ ...q, _slug: slug, _topic: title });
    }
  }
  if (!pool.length) return { error: 'No questions found for the selected topics.' };

  let notice = '';
  let set = [];
  if (mode === 'unseen') {
    const unseen = pool.filter(q => !hist[historyKey(q._slug, q.number)]);
    if (!unseen.length) return { error: 'No unseen questions left in these topics — try Random or Already collected mode.' };
    if (unseen.length < n) {
      notice = `Only ${unseen.length} unseen left — filled with ${n - unseen.length} random collected ones.`;
      set = shuffle([...unseen, ...shuffle(pool.filter(q => hist[historyKey(q._slug, q.number)])).slice(0, n - unseen.length)]);
    } else {
      set = shuffle(unseen).slice(0, n);
    }
  } else if (mode === 'seen') {
    const seen = pool.filter(q => hist[historyKey(q._slug, q.number)]);
    if (!seen.length) return { error: 'No collected questions yet — answer some quizzes or drills first, or use Random / Never collected mode.' };
    if (seen.length < n) {
      notice = `Only ${seen.length} collected questions available — set contains all of them.`;
      set = shuffle(seen);
    } else {
      set = shuffle(seen).slice(0, n);
    }
  } else if (mode === 'mixed') {
    // Missed questions first, topped up with unseen ones to reach n.
    const wrongQ = shuffle(pool.filter(q => hist[historyKey(q._slug, q.number)]?.lastCorrect === false)).slice(0, n);
    const taken = new Set(wrongQ.map(q => `${q._slug}:${q.number}`));
    const unseenQ = shuffle(pool.filter(q => !hist[historyKey(q._slug, q.number)] && !taken.has(`${q._slug}:${q.number}`)));
    const rest = shuffle(pool.filter(q => hist[historyKey(q._slug, q.number)]?.lastCorrect !== false && hist[historyKey(q._slug, q.number)]));
    set = shuffle([...wrongQ, ...unseenQ.slice(0, n - wrongQ.length), ...rest.slice(0, Math.max(0, n - wrongQ.length - unseenQ.length))]);
  } else if (mode === 'wrong') {
    const wrong = pool.filter(q => hist[historyKey(q._slug, q.number)]?.lastCorrect === false);
    if (!wrong.length) return { error: 'No missed questions right now.' };
    set = shuffle(wrong).slice(0, n);
  } else {
    set = shuffle(pool).slice(0, n);
  }
  return { set, notice };
}

function launchDrillSet(set, notice) {
  state.drillSet = set;
  state.drillNotice = notice || '';
  state.drillIndex = 0;
  state.drillAnswers = {};
  state.drillRevealed = {};
  state.drillResult = null;
  state.drillStep = 'question';
  renderDrillQuestion();
}

function startDrill() {
  const errEl = document.getElementById('drillError');
  const fail = (msg) => { if (errEl) errEl.textContent = msg; };

  const result = buildDrillSet(
    effectiveDrillTopics(),
    state.drillForm.count,
    state.drillForm.mode
  );
  if (result.error) return fail(result.error);
  launchDrillSet(result.set, result.notice);
}

function renderDrillQuestion() {
  const questions = state.drillSet;
  if (!questions.length) { state.drillStep = 'setup'; renderDrillSetup(); return; }
  const q = questions[state.drillIndex];
  const total = questions.length;
  const key = `${q._slug}:${q.number}`;
  const answered = state.drillRevealed[key];
  chatContext = answered
    ? { type: 'question', question: q.question, options: q.options, correctAnswers: q.correctAnswers, explanation: q.explanation }
    : { type: 'question', question: q.question, options: q.options };
  const userAnswer = state.drillAnswers[key];
  const isMulti = q.correctAnswers.length > 1;
  const selectedSet = new Set(Array.isArray(userAnswer) ? userAnswer : userAnswer ? [userAnswer] : []);
  const pct = Math.round((state.drillIndex / total) * 100);

  const navBtns = questions.map((qi, i) => {
    const k = `${qi._slug}:${qi.number}`;
    let cls = 'qnav-btn';
    if (i === state.drillIndex) cls += ' active';
    else if (state.drillRevealed[k]) {
      const ua = state.drillAnswers[k];
      const hasAnswer = Array.isArray(ua) ? ua.length > 0 : Boolean(ua);
      if (!hasAnswer) cls += ' skipped';
      else if (answersMatch(ua, qi.correctAnswers)) cls += ' correct';
      else cls += ' incorrect';
    }
    return `<button class="${cls}" data-di="${i}">${i + 1}</button>`;
  }).join('');

  const optionHtml = Object.keys(q.options).map(optKey => {
    let cls = 'quiz-option';
    const isCorrectOption = q.correctAnswers.includes(optKey);
    const isSelected = selectedSet.has(optKey);
    if (answered) {
      cls += ' answered';
      if (isCorrectOption) cls += ' correct';
      else if (isSelected) cls += ' incorrect';
    } else if (isSelected) {
      cls += ' selected';
    }
    const inputType = isMulti ? 'checkbox' : 'radio';
    return `
      <label class="${cls}" data-key="${optKey}">
        <input type="${inputType}" name="drill-opt" value="${optKey}" ${isSelected ? 'checked' : ''} ${answered ? 'disabled' : ''}>
        <span class="quiz-option-key">${optKey}</span>
        <span class="quiz-option-text">${esc(q.options[optKey] || '')}</span>
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
        <div class="feedback-actions">
          <button class="btn btn-ghost chat-explain-btn" id="drillExplainBtn" type="button">Explain this</button>
          ${lookupLink(q)}
        </div>
      </div>`;
  }

  const isLast = state.drillIndex === total - 1;
  const hasSelection = selectedSet.size > 0;

  app.innerHTML = `
    <div class="quiz-layout">
      <div>
        <div class="quiz-card">
          <div class="quiz-card-header">
            <span class="quiz-q-label">Drill ${state.drillIndex + 1} of ${total}${isMulti ? ' &middot; Choose ' + q.correctAnswers.length : ''} &middot; ${esc(state.drillForm.mode)}</span>
            <span class="tag tag-blue">${esc(q._topic)}</span>
          </div>
          ${state.drillNotice && state.drillIndex === 0 ? `<p style="font-size:13px;color:var(--warning);margin-bottom:12px">${esc(state.drillNotice)}</p>` : ''}
          <div class="quiz-question-text">${esc(q.question)}</div>
          <div class="quiz-options">${optionHtml}</div>
          ${feedback}
          <div class="quiz-nav-actions">
            <button class="btn btn-ghost" id="drillPrev" ${state.drillIndex === 0 ? 'disabled' : ''}>&#8592; Prev</button>
            <div style="display:flex;gap:8px">
              ${!answered && isMulti ? `<button class="btn btn-primary" id="drillCheck" ${hasSelection ? '' : 'disabled'}>Check answer</button>` : ''}
              ${!isLast ? `<button class="btn ${answered ? 'btn-primary' : 'btn-ghost'}" id="drillNext">Next &#8594;</button>` : ''}
              ${isLast ? `<button class="btn btn-success" id="drillFinish">Finish and see results</button>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="quiz-sidebar">
        <div class="quiz-sidebar-title">Progress</div>
        <div class="quiz-progress-text">${Object.keys(state.drillRevealed).length} / ${total} answered</div>
        <div class="quiz-progress-track" style="margin-bottom:12px">
          <div class="quiz-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="quiz-nav-grid">${navBtns}</div>
        <a class="btn btn-ghost" href="#/drill" id="drillExit" style="width:100%;justify-content:center;font-size:13px">New Drill</a>
      </div>
    </div>
  `;

  bindDrillEvents(questions);
}

function bindDrillEvents(questions) {
  const q = questions[state.drillIndex];
  const key = `${q._slug}:${q.number}`;
  const isMulti = q.correctAnswers.length > 1;

  document.getElementById('drillExplainBtn')?.addEventListener('click', () => {
    explainCurrent();
  });

  document.querySelectorAll('.quiz-option:not(.answered)').forEach(opt => {
    opt.addEventListener('click', (event) => {
      event.preventDefault();
      const optKey = opt.dataset.key;
      if (isMulti) {
        const current = Array.isArray(state.drillAnswers[key]) ? state.drillAnswers[key].slice() : [];
        const idx = current.indexOf(optKey);
        if (idx === -1) current.push(optKey); else current.splice(idx, 1);
        state.drillAnswers[key] = current;
      } else {
        state.drillAnswers[key] = optKey;
        state.drillRevealed[key] = true;
        markSeen(q._slug, q.number, answersMatch(optKey, q.correctAnswers));
      }
      renderDrillQuestion();
    });
  });

  document.getElementById('drillCheck')?.addEventListener('click', () => {
    state.drillRevealed[key] = true;
    markSeen(q._slug, q.number, answersMatch(state.drillAnswers[key], q.correctAnswers));
    renderDrillQuestion();
  });

  document.querySelectorAll('[data-di]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.drillIndex = Number(btn.dataset.di);
      renderDrillQuestion();
    });
  });

  document.getElementById('drillPrev')?.addEventListener('click', () => {
    state.drillIndex = Math.max(0, state.drillIndex - 1);
    renderDrillQuestion();
  });

  document.getElementById('drillNext')?.addEventListener('click', () => {
    state.drillIndex = Math.min(questions.length - 1, state.drillIndex + 1);
    renderDrillQuestion();
  });

  document.getElementById('drillSkip')?.addEventListener('click', () => {
    state.drillRevealed[key] = true;
    markSeen(q._slug, q.number, false);
    const next = questions.findIndex((qi, i) => i > state.drillIndex && !state.drillRevealed[`${qi._slug}:${qi.number}`]);
    if (next !== -1) state.drillIndex = next;
    renderDrillQuestion();
  });

  document.getElementById('drillFinish')?.addEventListener('click', submitDrill);
  document.getElementById('drillExit')?.addEventListener('click', (e) => {
    e.preventDefault();
    state.drillStep = 'setup';
    renderDrillSetup();
  });
}

function submitDrill() {
  let correct = 0;
  const details = state.drillSet.map((q) => {
    const key = `${q._slug}:${q.number}`;
    const userAnswer = state.drillAnswers[key] ?? null;
    const isCorrect = answersMatch(userAnswer, q.correctAnswers);
    if (isCorrect) correct += 1;
    return {
      topic: q._topic,
      slug: q._slug,
      number: q.number,
      question: q.question,
      options: q.options,
      userAnswer,
      correctAnswers: q.correctAnswers,
      isCorrect,
      explanation: q.explanation || null,
    };
  });
  // Unanswered questions count as missed, so they show up in "redo missed".
  for (const d of details) {
    if (!d.userAnswer || (Array.isArray(d.userAnswer) && !d.userAnswer.length)) markSeen(d.slug, d.number, false);
  }
  const total = details.length;
  state.drillResult = {
    total, correct, incorrect: total - correct,
    percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
    details,
  };
  saveDrillSession(state.drillResult, state.drillForm.mode);
  state.drillStep = 'result';
  renderDrillResult();
}

function renderDrillResult() {
  const r = state.drillResult;
  if (!r) { state.drillStep = 'setup'; renderDrillSetup(); return; }
  const pass = r.percentage >= 70;

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
          <span class="tag tag-gray" style="font-size:11px">${esc(d.topic)} #${d.number}</span>
          <span class="detail-answer ${userWrong ? 'your-wrong' : ''}">
            Your answer: <strong>${esc(userAnswerLabel)}</strong>
          </span>
          ${!d.isCorrect ? `<span class="detail-answer correct-ans">Correct: <strong>${esc(correctLabel)}</strong></span>` : ''}
        </div>
        ${d.explanation ? `<div class="detail-explanation">${esc(d.explanation)}</div>` : ''}
      </div>`;
  }).join('');

  app.innerHTML = `
    <div class="quiz-result">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <a class="btn btn-ghost" href="#/dashboard">&#8592; Dashboard</a>
        <span style="color:var(--text-muted);font-size:14px">Daily Drill &middot; ${esc(state.drillForm.mode)} &middot; ${r.total} questions</span>
      </div>

      <div class="result-card">
        <div class="result-score ${pass ? 'pass' : 'fail'}">${r.percentage}%</div>
        <div class="result-label">${pass ? '&#127881; Great job!' : '&#128218; Keep studying!'}</div>
        <div class="result-stats">
          <div class="result-stat"><div class="result-stat-num correct">${r.correct}</div><div class="result-stat-label">Correct</div></div>
          <div class="result-stat"><div class="result-stat-num incorrect">${r.incorrect}</div><div class="result-stat-label">Incorrect</div></div>
          <div class="result-stat"><div class="result-stat-num">${r.total}</div><div class="result-stat-label">Total</div></div>
        </div>
        <div class="result-actions">
          <button class="btn btn-ghost" id="drillRetry">New Drill</button>
          <button class="btn btn-primary" id="drillAgain">Repeat Same Topics</button>
        </div>
      </div>

      <div class="result-details">${detailsHtml}</div>
    </div>
  `;

  document.getElementById('drillRetry')?.addEventListener('click', () => {
    state.drillStep = 'setup';
    renderDrillSetup();
  });
  document.getElementById('drillAgain')?.addEventListener('click', () => {
    startDrill();
  });
}

// ── History ────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function ansLabel(a) { return Array.isArray(a) ? (a.join(', ') || 'none') : (a || 'none'); }

function renderHistory() {
  const sessions = drillSessions();
  // Latest attempt per question; keep the ones still wrong.
  const latest = new Map();
  for (const ses of sessions) {
    for (const d of ses.details) {
      const k = `${d.slug}:${d.number}`;
      if (!latest.has(k)) latest.set(k, { ...d, at: ses.at });
    }
  }
  const missed = [...latest.values()].filter(d => !d.isCorrect);

  const missedHtml = missed.map(d => `
    <div class="detail-item">
      <div class="detail-item-header"><span class="detail-status">&#10008;</span><span class="detail-q">${esc(d.question)}</span></div>
      <div class="detail-answers">
        <span class="tag tag-gray" style="font-size:11px">${esc(d.topic)} #${d.number}</span>
        <span class="detail-answer your-wrong">You chose: <strong>${esc(ansLabel(d.userAnswer))}</strong></span>
        <span class="detail-answer correct-ans">Correct: <strong>${esc(ansLabel(d.correctAnswers))}</strong></span>
      </div>
      ${d.options ? `<details class="hist-opts"><summary>Show options</summary>${Object.keys(d.options).map(k => `<p class="${(d.correctAnswers || []).includes(k) ? 'opt-correct' : ''}"><b>${k}.</b> ${esc(d.options[k])}</p>`).join('')}</details>` : ''}
    </div>`).join('');

  const sessionHtml = sessions.map(ses => `
    <details class="hist-session">
      <summary><span>${esc(fmtDate(ses.at))}</span><span>${ses.correct}/${ses.total} correct</span><span class="hist-pct ${ses.percentage >= 70 ? 'ok' : 'bad'}">${ses.percentage}%</span></summary>
      ${ses.details.map(d => `<p class="hist-line ${d.isCorrect ? 'ok' : 'bad'}">${d.isCorrect ? '&#10004;' : '&#10008;'} ${esc(d.question.slice(0, 140))}${d.question.length > 140 ? '…' : ''} <em>(${esc(d.topic)}, you: ${esc(ansLabel(d.userAnswer))}, correct: ${esc(ansLabel(d.correctAnswers))})</em></p>`).join('')}
    </details>`).join('');

  app.innerHTML = `
    <div class="home-section" style="max-width:820px;margin-top:32px">
      <h2>Still wrong (${missed.length})</h2>
      ${missed.length ? `<button class="next-btn" id="redoMissed" style="margin:8px 0 16px">Redo missed questions</button><p class="home-error" id="histError"></p>${missedHtml}` : '<p class="home-hint">Nothing to fix. Finish a drill and your mistakes appear here.</p>'}
    </div>
    <div class="home-section" style="max-width:820px">
      <h2>Past drills (${sessions.length})</h2>
      ${sessions.length ? sessionHtml : '<p class="home-hint">No drills yet. Results are saved in this browser after each drill.</p>'}
    </div>`;

  document.getElementById('redoMissed')?.addEventListener('click', async () => {
    const slugs = [...new Set(missed.map(d => d.slug))];
    await Promise.all(slugs.map(sl => ensureQuizCached(sl)));
    const r = buildDrillSet(slugs, 10, 'wrong');
    if (r.error) { document.getElementById('histError').textContent = r.error; return; }
    state.drillForm.mode = 'wrong';
    launchDrillSet(r.set, r.notice);
    setHash('#/drill');
  });
}

// ── Main Exam ──────────────────────────────────────────────────────────────
async function renderExam() {
  if (!state.exam) {
    app.innerHTML = '<div class="page-message"><p>Loading…</p></div>';
    state.exam = await api('/api/exam');
  }

  if (state.examResult) { renderExamResult(); return; }

  if (!state.examStarted) {
    stopTimer();
    app.innerHTML = `
      <div class="page-center">
        <div class="intro-box">
          <div class="intro-icon">&#9200;</div>
          <h2 class="intro-title">AWS SAA-C03 Practice Exam</h2>
          <p class="intro-sub">65 questions &middot; 130 minutes</p>
          <ul class="intro-features">
            <li>Timed exam — auto-submit at 00:00:00</li>
            <li>Question palette for quick navigation</li>
            <li>AWS 1000-point scoring scale</li>
            <li>Detailed results after submission</li>
          </ul>
          <button class="btn btn-primary" id="startExamBtn" style="width:100%;justify-content:center;padding:12px;font-size:15px">Start Exam</button>
          <div style="margin-top:10px">
            <a class="btn btn-ghost" href="#/dashboard" style="width:100%;justify-content:center">Back</a>
          </div>
        </div>
      </div>
    `;

    document.getElementById('startExamBtn').addEventListener('click', () => {
      state.examStarted = true;
      state.examIndex = 0;
      state.examAnswers = {};
      state.examResult = null;
      state.examEndAt = Date.now() + state.exam.examDurationSeconds * 1000;
      saveExam();
      renderExam();
    });
    return;
  }

  if (!state.examEndAt || examSecsLeft() <= 0) {
    state.examEndAt = Date.now() + state.exam.examDurationSeconds * 1000;
    saveExam();
  }

  const q = state.exam.questions[state.examIndex];
  const total = state.exam.totalQuestions;
  const selected = state.examAnswers[String(q.number)] || '';
  const answeredCount = Object.keys(state.examAnswers).length;

  const navBtns = state.exam.questions.map((qi, i) => {
    const ans = state.examAnswers[String(qi.number)];
    return `<button class="eq-btn ${i === state.examIndex ? 'active' : ''} ${ans ? 'answered' : ''}" data-ei="${i}">${qi.number}</button>`;
  }).join('');

  const optionHtml = ['A', 'B', 'C', 'D'].map(key => `
    <label class="exam-option ${selected === key ? 'selected' : ''}" data-key="${key}">
      <input type="radio" name="exam-opt" value="${key}" ${selected === key ? 'checked' : ''}>
      <span class="exam-option-key">${key}</span>
      <span class="exam-option-text">${esc(q.options[key] || '')}</span>
    </label>`).join('');

  app.innerHTML = `
    <div class="exam-layout">
      <div>
        <div class="exam-q-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <span style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Question ${state.examIndex + 1} / ${total}</span>
            <span class="tag tag-gray">Q${q.number}</span>
          </div>
          <div class="exam-question-text">${esc(q.question)}</div>
          <div class="exam-options">${optionHtml}</div>
          <div class="exam-nav-actions">
            <button class="btn btn-ghost" id="examPrev" ${state.examIndex === 0 ? 'disabled' : ''}>&#8592; Prev</button>
            <div style="display:flex;gap:8px">
              <button class="btn btn-ghost" id="examNext" ${state.examIndex === total - 1 ? 'disabled' : ''}>Next &#8594;</button>
              <button class="btn btn-primary" id="submitExamBtn">Submit</button>
            </div>
          </div>
        </div>
      </div>
      <div class="exam-sidebar">
        <div style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-align:center">Time Remaining</div>
        <div id="exam-timer" class="${timerClass(examSecsLeft())}">${fmtTime(examSecsLeft())}</div>
        <div style="font-size:12px;color:var(--text-dim);text-align:center;margin-bottom:10px">Auto-submits at 00:00:00</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Answered: <strong style="color:var(--text)">${answeredCount}/${total}</strong></div>
        <div class="exam-q-grid">${navBtns}</div>
        <button class="btn btn-danger" id="resetExamBtn" style="width:100%;justify-content:center;margin-top:8px;font-size:13px">Reset Exam</button>
      </div>
    </div>
  `;

  startTimer(() => submitExam(true));
  bindExamEvents();
}

function bindExamEvents() {
  document.querySelectorAll('.exam-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const q = state.exam.questions[state.examIndex];
      state.examAnswers[String(q.number)] = opt.dataset.key;
      saveExam();
      renderExam();
    });
  });

  document.querySelectorAll('.eq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.examIndex = Number(btn.dataset.ei);
      saveExam();
      renderExam();
    });
  });

  document.getElementById('examPrev')?.addEventListener('click', () => {
    state.examIndex = Math.max(0, state.examIndex - 1);
    saveExam();
    renderExam();
  });

  document.getElementById('examNext')?.addEventListener('click', () => {
    state.examIndex = Math.min(state.exam.totalQuestions - 1, state.examIndex + 1);
    saveExam();
    renderExam();
  });

  document.getElementById('submitExamBtn')?.addEventListener('click', () => {
    if (window.confirm('Submit the exam now?')) submitExam(false);
  });

  document.getElementById('resetExamBtn')?.addEventListener('click', () => {
    if (window.confirm('Reset all progress and timer?')) {
      clearExam();
      renderExam();
    }
  });
}

async function submitExam(auto = false) {
  stopTimer();
  const result = await api('/api/exam/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: state.examAnswers }),
  });
  state.examResult = result;
  state.examStarted = false;
  saveExam();
  renderExamResult();
}

function renderExamResult() {
  const r = state.examResult;
  const pass = r.passed;

  const rows = r.details.map(d => `
    <tr>
      <td>${d.number}</td>
      <td>${d.userAnswer || '—'}</td>
      <td>${d.correctAnswer || '—'}</td>
      <td>${d.isCorrect ? '&#10004;' : '&#10008;'}</td>
    </tr>${d.explanation ? `
    <tr class="explain-row"><td colspan="4"><details${d.isCorrect ? '' : ' open'}><summary>Why ${esc(d.correctAnswer || '')} is correct</summary><div class="explain-text">${esc(d.explanation)}</div></details></td></tr>` : ''}`).join('');

  app.innerHTML = `
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <a class="btn btn-ghost" href="#/dashboard">&#8592; Dashboard</a>
        <span style="color:var(--text-muted);font-size:14px">Exam Result</span>
      </div>

      <div class="result-card">
        <div class="exam-result-score ${pass ? 'pass' : 'fail'}">${r.scaledScore}/1000</div>
        <div class="result-label">${pass ? '&#127881; PASS — Required: 720' : '&#128218; FAIL — Required: 720'}</div>
        <div class="result-stats">
          <div class="result-stat"><div class="result-stat-num correct">${r.correct}</div><div class="result-stat-label">Correct</div></div>
          <div class="result-stat"><div class="result-stat-num incorrect">${r.incorrect}</div><div class="result-stat-label">Incorrect</div></div>
          <div class="result-stat"><div class="result-stat-num">${r.total}</div><div class="result-stat-label">Total</div></div>
        </div>
        <div class="result-actions">
          <button class="btn btn-ghost" id="newAttemptBtn">New Attempt</button>
          <a class="btn btn-primary" href="#/dashboard">Dashboard</a>
        </div>
      </div>

      <div class="doc-body" style="padding:0;background:none;border:none">
        <table class="result-table">
          <thead>
            <tr>
              <th>Q#</th><th>Your Answer</th><th>Correct</th><th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('newAttemptBtn')?.addEventListener('click', () => {
    clearExam();
    renderExam();
  });
}

// ── Router ─────────────────────────────────────────────────────────────────
function route() {
  chatContext = null;
  const hash = location.hash || '#/dashboard';

  if (hash.startsWith('#/doc/')) {
    const slug = decodeURIComponent(hash.replace('#/doc/', '').trim());
    if (!slug) { setHash('#/dashboard'); return; }
    renderDoc(slug).catch(showError);
    return;
  }

  if (hash.startsWith('#/quiz/')) {
    const slug = decodeURIComponent(hash.replace('#/quiz/', '').trim());
    if (!slug) { setHash('#/dashboard'); return; }
    renderQuiz(slug).catch(showError);
    return;
  }

  if (hash.startsWith('#/drill/')) {
    const slug = decodeURIComponent(hash.replace('#/drill/', '').trim());
    if (slug && state.docs.some(d => d.slug === slug && d.hasQuiz)) {
      const switched = state.drillForm.singleTopic !== slug;
      state.drillForm.scope = 'single';
      state.drillForm.singleTopic = slug;
      state.drillForm.topics = [slug];
      if (switched || (state.drillStep !== 'question' && state.drillStep !== 'result')) {
        state.drillStep = 'setup';
      }
    }
    renderDrill().catch(showError);
    return;
  }

  if (hash === '#/drill') {
    if (state.drillStep !== 'question' && state.drillStep !== 'result') {
      state.drillStep = 'setup';
    }
    renderDrill().catch(showError);
    return;
  }

  if (hash === '#/history') {
    renderHistory();
    return;
  }

  if (hash === '#/exam') {
    renderExam().catch(showError);
    return;
  }

  renderDashboard().catch(showError);
}

function showError(err) {
  app.innerHTML = `
    <div class="page-message">
      <h3>Something went wrong</h3>
      <p>${esc(err.message || 'Unknown error')}</p>
      <div style="margin-top:16px"><a class="btn btn-ghost" href="#/dashboard">Back to Dashboard</a></div>
    </div>`;
}

window.addEventListener('hashchange', () => {
  // Reset quiz state when navigating away from a quiz to a different quiz
  const hash = location.hash || '';
  if (!hash.startsWith('#/quiz/') && state.quizStep !== 'intro') {
    // Keep state.quiz but reset step so new quiz loads fresh
  }
  route();
});

window.addEventListener('beforeunload', stopTimer);

mountChatWidget({ getContext: getChatContext, getConfig: getChatConfig });
bootstrap().catch(showError);

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
};

const EXAM_STORE = 'saa_exam_v1';
const QUIZ_PROGRESS = 'saa_quiz_progress_v1';

// ── Helpers ────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.message || 'Request failed');
  }
  return r.json();
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function setHash(h) { if (location.hash !== h) location.hash = h; }

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

// ── Dashboard ──────────────────────────────────────────────────────────────
function renderDashboard() {
  const quizzable = state.docs.filter(d => d.hasQuiz);
  const done = completedCount(state.docs);
  const total = quizzable.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const examDoc = state.docs.find(d => d.isExam);
  const studyDocs = state.docs.filter(d => !d.isExam && !d.isReference);
  const refDocs = state.docs.filter(d => !d.isExam && d.isReference);

  // Group study docs: numbered (00-14) vs lettered (A-E, K...)
  const coreGuides = studyDocs.filter(d => /^\d/.test(d.filename));
  const archGuides = studyDocs.filter(d => /^[A-Za-z]/.test(d.filename));

  app.innerHTML = `
    <div class="dashboard-hero">
      <h1 class="dashboard-title">AWS SAA-C03 Practice</h1>
      <p class="dashboard-sub">Study guides, per-topic quizzes, and a full timed practice exam.</p>

      <div class="progress-bar-wrap">
        <div>
          <div class="progress-stat">${done}/${total}</div>
          <div class="progress-label">Quizzes completed</div>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div style="font-size:13px;color:var(--text-muted);font-weight:600">${pct}%</div>
      </div>
    </div>

    <div class="exam-card">
      <div class="exam-card-info">
        <div class="exam-card-badge">AWS Certification Practice</div>
        <h2>Solutions Architect &mdash; Associate</h2>
        <p>SAA-C03 &middot; Full timed exam simulation</p>
        <div class="exam-card-chips">
          <span class="exam-chip">65 Questions</span>
          <span class="exam-chip">130 min</span>
          <span class="exam-chip">Pass score: 720 / 1000</span>
          <span class="exam-chip">Auto-submit</span>
        </div>
      </div>
      <a class="btn btn-primary" href="#/exam" style="flex-shrink:0">Start Exam &rarr;</a>
    </div>

    ${coreGuides.length ? `
    <div class="section-group">
      <div class="section-header">Core Service Guides (${coreGuides.length})</div>
      <div class="doc-grid">${coreGuides.map(docCard).join('')}</div>
    </div>` : ''}

    ${archGuides.length ? `
    <div class="section-group">
      <div class="section-header">Architecture Guides (${archGuides.length})</div>
      <div class="doc-grid">${archGuides.map(docCard).join('')}</div>
    </div>` : ''}

    ${refDocs.length ? `
    <div class="section-group">
      <div class="section-header">Reference & Cheat Sheets (${refDocs.length})</div>
      <div class="doc-grid">${refDocs.map(docCard).join('')}</div>
    </div>` : ''}
  `;
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
      </div>
    </div>`;
}

// ── Doc view ───────────────────────────────────────────────────────────────
async function renderDoc(slug) {
  app.innerHTML = '<div class="page-message"><p>Loading…</p></div>';
  const doc = await api(`/api/docs/${encodeURIComponent(slug)}`);

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
}

// ── Quiz ───────────────────────────────────────────────────────────────────
async function renderQuiz(slug) {
  if (!state.quiz || state.quizSlug !== slug) {
    app.innerHTML = '<div class="page-message"><p>Loading…</p></div>';
    state.quiz = await api(`/api/quiz/${encodeURIComponent(slug)}`);
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

  const prevScore = prog
    ? `<p style="margin-top:12px;font-size:13px;color:var(--text-muted)">Previous best: <strong style="color:var(--text)">${prog.percentage}%</strong></p>`
    : '';

  app.innerHTML = `
    <div class="page-center">
      <div class="quiz-intro">
        <div class="quiz-intro-icon">&#128218;</div>
        <h2 class="quiz-intro-title">${esc(title)}</h2>
        <p class="quiz-intro-sub">Study mode &mdash; answers revealed after each question</p>
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
        <button class="btn btn-primary" id="startQuizBtn" style="width:100%;justify-content:center;padding:12px">Start Quiz</button>
        <div style="margin-top:12px">
          <a class="btn btn-ghost" href="#/dashboard" style="width:100%;justify-content:center">Back to Dashboard</a>
        </div>
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
}

function renderQuizQuestion() {
  const questions = state.quiz.questions;
  const q = questions[state.quizIndex];
  const total = questions.length;
  const answered = state.quizRevealed[String(q.number)];
  const userAnswer = state.quizAnswers[String(q.number)];
  const pct = Math.round((state.quizIndex / total) * 100);

  const navBtns = questions.map((qi, i) => {
    let cls = 'qnav-btn';
    if (i === state.quizIndex) {
      cls += ' active';
    } else if (state.quizRevealed[String(qi.number)]) {
      const userAns = state.quizAnswers[String(qi.number)];
      if (!userAns) cls += ' skipped';
      else if (userAns === qi.correctAnswer) cls += ' correct';
      else cls += ' incorrect';
    }
    return `<button class="${cls}" data-qi="${i}">${i + 1}</button>`;
  }).join('');

  // Build option html — use q.correctAnswer (from server, always present in study mode)
  const optionHtml = ['A', 'B', 'C', 'D'].map(key => {
    let cls = 'quiz-option';
    if (answered) {
      cls += ' answered';
      if (key === q.correctAnswer) cls += ' correct';
      else if (key === userAnswer && key !== q.correctAnswer) cls += ' incorrect';
    } else if (key === userAnswer) {
      cls += ' selected';
    }
    return `
      <label class="${cls}" data-key="${key}">
        <input type="radio" name="quiz-opt" value="${key}" ${answered ? 'disabled' : ''}>
        <span class="quiz-option-key">${key}</span>
        <span class="quiz-option-text">${esc(q.options[key] || '')}</span>
      </label>`;
  }).join('');

  // Feedback — shown after revealing
  let feedback = '';
  if (answered && userAnswer) {
    const isCorrect = userAnswer === q.correctAnswer;
    const icon = isCorrect ? '&#10004;' : '&#10008;';
    const label = isCorrect ? 'Correct!' : `Incorrect &mdash; Correct answer: <strong>${q.correctAnswer}</strong>`;
    feedback = `
      <div class="quiz-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="quiz-feedback-header">${icon} ${label}</div>
        ${q.explanation ? `<div class="quiz-feedback-explanation">${esc(q.explanation)}</div>` : ''}
      </div>`;
  }

  const isLast = state.quizIndex === total - 1;
  const allAnswered = questions.every(qi => state.quizRevealed[String(qi.number)]);

  app.innerHTML = `
    <div class="quiz-layout">
      <div>
        <div class="quiz-card">
          <div class="quiz-card-header">
            <span class="quiz-q-label">Question ${state.quizIndex + 1} of ${total}</span>
            <span class="tag tag-blue">${esc(state.docs.find(d => d.slug === state.quizSlug)?.title || '')}</span>
          </div>
          <div class="quiz-question-text">${esc(q.question)}</div>
          <div class="quiz-options">${optionHtml}</div>
          ${feedback}
          <div class="quiz-nav-actions">
            <button class="btn btn-ghost" id="quizPrev" ${state.quizIndex === 0 ? 'disabled' : ''}>&#8592; Prev</button>
            <div style="display:flex;gap:8px">
              ${!answered ? `<button class="btn btn-ghost" id="quizSkip">Skip</button>` : ''}
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
  // Option selection — reveal immediately (answers included in study mode response)
  document.querySelectorAll('.quiz-option:not(.answered)').forEach(opt => {
    opt.addEventListener('click', () => {
      const key = opt.dataset.key;
      const q = questions[state.quizIndex];
      state.quizAnswers[String(q.number)] = key;
      state.quizRevealed[String(q.number)] = true;
      renderQuizQuestion();
    });
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
    const q = questions[state.quizIndex];
    state.quizRevealed[String(q.number)] = true;
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
    return `
      <div class="detail-item">
        <div class="detail-item-header">
          <span class="detail-status">${d.isCorrect ? '&#10004;' : '&#10008;'}</span>
          <span class="detail-q">${esc(d.question)}</span>
        </div>
        <div class="detail-answers">
          <span class="detail-answer ${userWrong ? 'your-wrong' : ''}">
            Your answer: <strong>${d.userAnswer || '—'}</strong>
          </span>
          ${!d.isCorrect ? `<span class="detail-answer correct-ans">Correct: <strong>${d.correctAnswer}</strong></span>` : ''}
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
    </tr>`).join('');

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

  if (hash === '#/exam') {
    renderExam().catch(showError);
    return;
  }

  renderDashboard();
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

bootstrap().catch(showError);

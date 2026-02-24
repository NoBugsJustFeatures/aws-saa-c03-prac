const app = document.getElementById('app');
const domainBadge = document.getElementById('domainBadge');

const examStoreKey = 'saa_c03_exam_state_v1';

const state = {
  config: null,
  docs: [],
  currentDoc: null,
  exam: null,
  examStarted: false,
  currentQuestionIndex: 0,
  answers: {},
  endAt: null,
  timerId: null,
  result: null,
};

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(data.message || 'Request failed');
  }
  return response.json();
}

function escapeHtml(input) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function countdownText(totalSeconds) {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

function setHash(hash) {
  if (location.hash !== hash) {
    location.hash = hash;
  }
}

function saveExamState() {
  localStorage.setItem(
    examStoreKey,
    JSON.stringify({
      examStarted: state.examStarted,
      currentQuestionIndex: state.currentQuestionIndex,
      answers: state.answers,
      endAt: state.endAt,
      result: state.result,
    })
  );
}

function loadExamState() {
  const raw = localStorage.getItem(examStoreKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.examStarted = Boolean(parsed.examStarted);
    state.currentQuestionIndex = Number(parsed.currentQuestionIndex || 0);
    state.answers = parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {};
    state.endAt = parsed.endAt || null;
    state.result = parsed.result || null;
  } catch {
    localStorage.removeItem(examStoreKey);
  }
}

function clearExamState() {
  localStorage.removeItem(examStoreKey);
  state.examStarted = false;
  state.currentQuestionIndex = 0;
  state.answers = {};
  state.endAt = null;
  state.result = null;
}

function renderLoading() {
  app.innerHTML = '<section class="panel">Loading...</section>';
}

async function bootstrap() {
  renderLoading();
  const [config, docs] = await Promise.all([api('/api/config'), api('/api/docs')]);
  state.config = config;
  state.docs = docs;
  domainBadge.textContent = config.appDomain;
  loadExamState();
  route();
}

function renderDashboard() {
  const practiceDocs = state.docs.filter((doc) => !doc.isExam);
  const examDoc = state.docs.find((doc) => doc.isExam);

  app.innerHTML = `
    <section class="panel" style="margin-bottom:14px;">
      <div class="row">
        <div>
          <h2 style="margin:0;">Practice Dashboard</h2>
          <p style="margin:6px 0 0;color:var(--muted);">Choose any markdown topic or start the full SAA-C03 timed exam.</p>
        </div>
        <a class="btn" href="#/exam">Start Practice Exam</a>
      </div>
    </section>

    <section class="panel" style="margin-bottom:14px;">
      <div class="row">
        <div>
          <h3 style="margin:0 0 6px;">Official Practice Exam</h3>
          <p style="margin:0;color:var(--muted);">${examDoc ? escapeHtml(examDoc.title) : 'S-practice-exam.md'} · 65 questions · 130 minutes</p>
        </div>
        <a class="btn secondary" href="#/doc/${examDoc ? examDoc.slug : 's-practice-exam'}">Read markdown</a>
      </div>
    </section>

    <section class="grid grid-3">
      ${practiceDocs
        .map(
          (doc) => `
          <article class="card">
            <h3>${escapeHtml(doc.title)}</h3>
            <p>${escapeHtml(doc.filename)}</p>
            <div style="margin-top:12px;">
              <a class="btn secondary" href="#/doc/${doc.slug}">Open</a>
            </div>
          </article>
      `
        )
        .join('')}
    </section>
  `;
}

async function renderDoc(slug) {
  renderLoading();
  const doc = await api(`/api/docs/${encodeURIComponent(slug)}`);
  state.currentDoc = doc;

  app.innerHTML = `
    <section class="panel">
      <div class="row" style="margin-bottom:12px;">
        <h2 style="margin:0;">${escapeHtml(doc.title)}</h2>
        <div>
          <a class="btn secondary" href="#/dashboard">Back Dashboard</a>
          ${doc.isExam ? '<a class="btn" href="#/exam" style="margin-left:8px;">Start Exam</a>' : ''}
        </div>
      </div>
      <div class="badge" style="margin-bottom:10px;">${escapeHtml(doc.filename)}</div>
      <article class="doc-body">${doc.html}</article>
    </section>
  `;
}

function getRemainingSeconds() {
  if (!state.endAt) return state.config.examDurationSeconds;
  return Math.round((state.endAt - Date.now()) / 1000);
}

function timerClass(secondsLeft) {
  if (secondsLeft <= 300) return 'timer danger';
  if (secondsLeft <= 900) return 'timer warning';
  return 'timer';
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function startTimer(onExpire) {
  stopTimer();
  state.timerId = setInterval(() => {
    const remaining = getRemainingSeconds();
    const timerEl = document.getElementById('timer');
    if (timerEl) {
      timerEl.className = timerClass(remaining);
      timerEl.textContent = countdownText(remaining);
    }
    if (remaining <= 0) {
      stopTimer();
      onExpire();
    }
  }, 1000);
}

function currentQuestion() {
  return state.exam.questions[state.currentQuestionIndex];
}

function examAnsweredCount() {
  return Object.keys(state.answers).length;
}

function renderExamQuestion() {
  const question = currentQuestion();
  if (!question) return '<p>No question available.</p>';

  const selected = state.answers[String(question.number)] || '';

  return `
    <article class="panel exam-question-card">
      <div class="row exam-question-head">
        <h3 class="exam-question-title">Question ${question.number}</h3>
        <span class="badge">${state.currentQuestionIndex + 1}/${state.exam.totalQuestions}</span>
      </div>
      <p class="exam-question-text">${escapeHtml(question.question)}</p>
      <div class="exam-options-wrap">
      ${['A', 'B', 'C', 'D']
        .map(
          (key) => `
          <label class="option option-card ${selected === key ? 'selected' : ''}">
            <input type="radio" name="option" value="${key}" ${selected === key ? 'checked' : ''} />
            <span class="option-letter">${key}.</span>
            <span class="option-text">${escapeHtml(question.options[key] || '')}</span>
          </label>
      `
        )
        .join('')}
      </div>
      <div class="row exam-actions-row">
        <button id="prevBtn" class="secondary" ${state.currentQuestionIndex === 0 ? 'disabled' : ''}>Previous</button>
        <div class="exam-actions-right">
          <button id="nextBtn" class="secondary" ${state.currentQuestionIndex === state.exam.totalQuestions - 1 ? 'disabled' : ''}>Next</button>
          <button id="submitBtn" class="success" style="margin-left:8px;">Submit</button>
        </div>
      </div>
    </article>
  `;
}

function renderQuestionNav() {
  return `
    <aside class="panel exam-nav">
      <div class="row exam-nav-head">
        <h3 class="exam-nav-title">SAA-C03 Timer</h3>
        <span class="badge">130m</span>
      </div>
      <div id="timer" class="${timerClass(getRemainingSeconds())}">${countdownText(getRemainingSeconds())}</div>
      <p class="exam-nav-sub">Auto-submit when timer reaches 00:00:00</p>
      <p class="exam-answered">Answered: ${examAnsweredCount()}/${state.exam.totalQuestions}</p>
      <div class="question-grid">
        ${state.exam.questions
          .map((q, index) => {
            const active = state.currentQuestionIndex === index ? 'active' : '';
            const answered = state.answers[String(q.number)] ? 'answered' : '';
            return `<button class="q-btn ${active} ${answered}" data-q-index="${index}">${q.number}</button>`;
          })
          .join('')}
      </div>
      <button id="resetExamBtn" class="warning" style="margin-top:12px;width:100%;">Reset Exam</button>
    </aside>
  `;
}

async function submitExam(autoSubmit = false) {
  if (!autoSubmit) {
    const proceed = window.confirm('Submit now?');
    if (!proceed) return;
  }
  stopTimer();

  const result = await api('/api/exam/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: state.answers }),
  });

  state.result = result;
  state.examStarted = false;
  saveExamState();
  renderExam();
}

function bindExamEvents() {
  document.querySelectorAll('.q-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.currentQuestionIndex = Number(btn.dataset.qIndex);
      saveExamState();
      renderExam();
    });
  });

  document.querySelectorAll('input[name="option"]').forEach((input) => {
    input.addEventListener('change', () => {
      const q = currentQuestion();
      state.answers[String(q.number)] = input.value;
      saveExamState();
      renderExam();
    });
  });

  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');
  const resetExamBtn = document.getElementById('resetExamBtn');

  prevBtn?.addEventListener('click', () => {
    state.currentQuestionIndex = Math.max(0, state.currentQuestionIndex - 1);
    saveExamState();
    renderExam();
  });

  nextBtn?.addEventListener('click', () => {
    state.currentQuestionIndex = Math.min(state.exam.totalQuestions - 1, state.currentQuestionIndex + 1);
    saveExamState();
    renderExam();
  });

  submitBtn?.addEventListener('click', () => submitExam(false));

  resetExamBtn?.addEventListener('click', () => {
    const ok = window.confirm('Reset exam progress and timer?');
    if (!ok) return;
    clearExamState();
    renderExam();
  });
}

function renderResult() {
  const result = state.result;
  const examDoc = state.docs.find((d) => d.isExam);

  app.innerHTML = `
    <section class="panel">
      <div class="row">
        <h2 style="margin:0;">Exam Result</h2>
        <div>
          <a class="btn secondary" href="#/doc/${examDoc ? examDoc.slug : 's-practice-exam'}">Review Markdown</a>
          <button id="newAttemptBtn" class="btn" style="margin-left:8px;">New Attempt</button>
        </div>
      </div>

      <p class="result ${result.passed ? 'pass' : 'fail'}" style="font-size:18px;font-weight:700;">
        ${result.passed ? 'PASS' : 'FAIL'} · ${result.scaledScore}/1000 (required: 720)
      </p>
      <p style="color:var(--muted)">
        Correct: ${result.correct}/${result.total} · Incorrect: ${result.incorrect}
      </p>

      <table class="table">
        <thead>
          <tr>
            <th>Question</th>
            <th>Your Answer</th>
            <th>Correct</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${result.details
            .map(
              (d) => `
            <tr>
              <td>${d.number}</td>
              <td>${d.userAnswer || '-'}</td>
              <td>${d.correctAnswer || '-'}</td>
              <td>${d.isCorrect ? '✅' : '❌'}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `;

  document.getElementById('newAttemptBtn')?.addEventListener('click', () => {
    clearExamState();
    renderExam();
  });
}

async function renderExam() {
  if (!state.exam) {
    renderLoading();
    state.exam = await api('/api/exam');
  }

  if (state.result) {
    renderResult();
    return;
  }

  if (!state.examStarted) {
    stopTimer();
    app.innerHTML = `
      <section class="panel exam-intro">
        <h2 class="exam-intro-title">AWS SAA-C03 Practice Exam</h2>
        <p class="exam-intro-sub">65 questions · Exact exam timer: 130 minutes (02:10:00)</p>
        <ul class="exam-intro-list">
          <li>Full timed mode with automatic submission at 00:00:00</li>
          <li>Question palette for navigation</li>
          <li>Score on AWS 1000-point scale</li>
        </ul>
        <button id="startExamBtn" class="exam-start-btn">Start Exam</button>
      </section>
    `;

    document.getElementById('startExamBtn')?.addEventListener('click', () => {
      state.examStarted = true;
      state.currentQuestionIndex = 0;
      state.answers = {};
      state.result = null;
      state.endAt = Date.now() + state.exam.examDurationSeconds * 1000;
      saveExamState();
      renderExam();
    });
    return;
  }

  if (!state.endAt || getRemainingSeconds() <= 0) {
    state.endAt = Date.now() + state.exam.examDurationSeconds * 1000;
    saveExamState();
  }

  app.innerHTML = `
    <section class="exam-layout">
      ${renderQuestionNav()}
      ${renderExamQuestion()}
    </section>
  `;

  startTimer(() => submitExam(true));
  bindExamEvents();
}

function route() {
  const hash = location.hash || '#/dashboard';

  if (hash.startsWith('#/doc/')) {
    const slug = decodeURIComponent(hash.replace('#/doc/', '').trim());
    if (!slug) {
      setHash('#/dashboard');
      return;
    }
    renderDoc(slug).catch(showError);
    return;
  }

  if (hash === '#/exam') {
    renderExam().catch(showError);
    return;
  }

  renderDashboard();
}

function showError(error) {
  app.innerHTML = `
    <section class="panel">
      <h3 style="margin-top:0;">Error</h3>
      <p>${escapeHtml(error.message || 'Unknown error')}</p>
      <a class="btn secondary" href="#/dashboard">Back Dashboard</a>
    </section>
  `;
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => stopTimer());

bootstrap().catch(showError);

# Tailnet Study Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating, context-aware chatbot to practice-web that talks directly to a tailnet-only OmniRoute instance, plus an "Explain this answer" quick action.

**Architecture:** Browser calls OmniRoute's OpenAI-compatible endpoint directly over its Tailscale HTTPS hostname — no Vercel backend involved in the LLM call. `server.js` only exposes the configured base URL/model via `/api/config`. `app.js` tracks a `chatContext` describing the current doc/question; a new `chatbot.js` module owns the widget UI and the send pipeline.

**Tech Stack:** Plain Node/Express (`server.js`), vanilla JS ES modules (`public/app.js`, new `public/chatbot.js`), no build step, no test framework (verification is manual/curl-based, matching existing repo conventions).

**Spec:** `docs/superpowers/specs/2026-10-05-tailnet-chatbot-design.md`

## Global Constraints

- No new public backend proxy for the LLM call — the browser calls OmniRoute directly.
- No persistent server-side chat storage — history lives in `sessionStorage` only, per tab.
- No streaming responses, no multi-turn summarization, no auth system.
- At most the last 6 history turns are sent per request.
- Doc markdown context is truncated to 6000 characters before being sent.
- Each request uses an ~4000ms `AbortController` timeout; no automatic retry on failure.
- A question's chat context must never include `correctAnswers`/`explanation` before that question is revealed.

## Review Focus

- `OMNIROUTE_URL` unset → widget must render a clear "not configured" state, never throw or silently no-op. (Task 1, Task 3)
- Pre-reveal question context must not contain the answer — verified by inspecting the object built in `renderQuizQuestion`/`renderDrillQuestion` before reveal. (Task 2)
- Doc markdown over 6000 chars must be truncated in the actual request payload, not just in the stored context. (Task 3)
- Clicking Send twice quickly (or pressing Enter repeatedly) while a request is in flight must not fire concurrent requests against the free-tier provider. (Task 3)
- `mountChatWidget()` must be idempotent: since the widget is appended to `document.body` and intentionally persists across SPA route changes (it is never unmounted), any accidental repeat call (e.g. if bootstrap logic changes later) must not duplicate the floating button/panel in the DOM. (Task 3)

---

## Task 1: Backend config endpoint

**Files:**
- Modify: `practice-web/server.js:1-16` (env var block), `practice-web/server.js:89-94` (`/api/config` handler)

**Interfaces:**
- Produces: `GET /api/config` now returns `{ appDomain, examDurationSeconds, chat: { baseUrl: string|null, model: string } }`

- [ ] **Step 1: Add the two new env vars next to the existing config constants**

In `practice-web/server.js`, right after the existing `const APP_DOMAIN = ...` line (around line 10), add:

```js
const OMNIROUTE_URL = process.env.OMNIROUTE_URL || null;
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || 'auto';
```

- [ ] **Step 2: Extend the `/api/config` handler**

Replace:

```js
app.get('/api/config', (req, res) => {
  res.json({
    appDomain: APP_DOMAIN,
    examDurationSeconds: EXAM_DURATION_SECONDS,
  });
});
```

with:

```js
app.get('/api/config', (req, res) => {
  res.json({
    appDomain: APP_DOMAIN,
    examDurationSeconds: EXAM_DURATION_SECONDS,
    chat: {
      baseUrl: OMNIROUTE_URL,
      model: OMNIROUTE_MODEL,
    },
  });
});
```

- [ ] **Step 3: Verify manually**

Run:
```bash
cd practice-web
node server.js &
sleep 1
curl -s http://localhost:3000/api/config
OMNIROUTE_URL="https://example.ts.net:20128" OMNIROUTE_MODEL="auto" node -e "
  process.env.PORT = 3001;
  require('./server.js');
" &
sleep 1
curl -s http://localhost:3001/api/config
kill %1 %2 2>/dev/null
```
Expected: first call returns `"chat":{"baseUrl":null,"model":"auto"}`; second call returns `"chat":{"baseUrl":"https://example.ts.net:20128","model":"auto"}`.

- [ ] **Step 4: Commit**

```bash
cd practice-web
git add server.js
git commit -m "Add chat config (OmniRoute base URL/model) to /api/config"
```

---

## Task 2: Context tracking in app.js

**Files:**
- Modify: `practice-web/public/app.js` (top-level state near line 35, `route()` at line 1531, `renderDoc` at line 437, `renderQuizQuestion` at line 574, `renderDrillQuestion` at line 1074)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `export function getChatContext()` returning one of:
  - `null`
  - `{ type: 'doc', title: string, markdown: string }`
  - `{ type: 'question', question: string, options: Record<string,string> }` (unrevealed)
  - `{ type: 'question', question: string, options: Record<string,string>, correctAnswers: string[], explanation?: string }` (revealed)

- [ ] **Step 1: Add the context variable and getter**

In `practice-web/public/app.js`, right after the `const state = { ... };` block (after line 35), add:

```js
// ── Chat context ───────────────────────────────────────────────────────────
// Tracks what the user is currently looking at, for the chatbot widget.
// Reset at the top of route() and set by the view renderers below.
let chatContext = null;
export function getChatContext() { return chatContext; }
export function getChatConfig() { return state.config?.chat || null; }
```

- [ ] **Step 2: Reset context at the top of `route()`**

In `route()` (line 1531), change:

```js
function route() {
  const hash = location.hash || '#/dashboard';
```

to:

```js
function route() {
  chatContext = null;
  const hash = location.hash || '#/dashboard';
```

- [ ] **Step 3: Set doc context in `renderDoc`**

In `renderDoc` (line 437), after `const doc = await api(...)` and before building `quizBtn`, add:

```js
  chatContext = {
    type: 'doc',
    title: doc.title,
    markdown: doc.markdown.length > 6000 ? doc.markdown.slice(0, 6000) : doc.markdown,
  };
```

- [ ] **Step 4: Set question context in `renderQuizQuestion`**

In `renderQuizQuestion` (line 574), after the line `const answered = state.quizRevealed[String(q.number)];` add:

```js
  chatContext = answered
    ? { type: 'question', question: q.question, options: q.options, correctAnswers: q.correctAnswers, explanation: q.explanation }
    : { type: 'question', question: q.question, options: q.options };
```

- [ ] **Step 5: Set question context in `renderDrillQuestion`**

In `renderDrillQuestion` (line 1074), after the line `const answered = state.drillRevealed[key];` add:

```js
  chatContext = answered
    ? { type: 'question', question: q.question, options: q.options, correctAnswers: q.correctAnswers, explanation: q.explanation }
    : { type: 'question', question: q.question, options: q.options };
```

- [ ] **Step 6: Verify manually**

Run `node --check practice-web/public/app.js` — expected: no output (syntax OK, `export` keywords parse fine under `--check` even though it's meant for module loading, since Node treats `.js` files with top-level `export` as a syntax error unless parsed as a module — if this errors, add `"type": "module"` is NOT an option here since the file is served directly to the browser and already uses `type="module"` in a `<script>` tag, not loaded by Node directly; instead verify with:
```bash
cd practice-web
node -e "new Function(require('fs').readFileSync('public/app.js','utf8').replace(/^export /gm, ''))" 
```
Expected: no output (syntax parses once top-level `export` keywords are stripped for this throwaway check).

Then confirm by reading: open `public/app.js` and check each of the four edit points landed at the right place (getter near line ~36, reset in `route()`, and the two `chatContext = ...` assignments) before moving on.

- [ ] **Step 7: Commit**

```bash
cd practice-web
git add public/app.js
git commit -m "Track current doc/question context for the chat widget"
```

---

## Task 3: Chatbot widget module

**Files:**
- Create: `practice-web/public/chatbot.js`
- Modify: `practice-web/public/app.js` (import + mount call near the bottom, line ~1599)

**Interfaces:**
- Consumes: `getChatContext()`, `getChatConfig()` from Task 2.
- Produces: `export function mountChatWidget()`, `export function explainCurrent()` (used by Task 5).

- [ ] **Step 1: Create the widget module**

Create `practice-web/public/chatbot.js`:

```js
import { getChatConfig, getChatContext } from './app.js';

const HISTORY_KEY = 'saa_chat_history_v1';
const MAX_HISTORY_TURNS = 6;
const REQUEST_TIMEOUT_MS = 4000;
const SYSTEM_PROMPT =
  'You are a concise AWS SAA-C03 study assistant embedded in a practice app. ' +
  'Use any provided context about the current question or reading section. ' +
  "If you're not sure about an AWS fact, say so rather than guessing. Keep answers short.";

let panelOpen = false;
let sending = false;
let activeAbort = null;

function loadHistory() {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // sessionStorage unavailable (private mode, quota) — history just won't persist
  }
}

let history = loadHistory();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function buildContextMessage() {
  const ctx = getChatContext();
  if (!ctx) return null;
  if (ctx.type === 'doc') {
    return { role: 'system', content: `The user is currently reading this study section titled "${ctx.title}":\n\n${ctx.markdown}` };
  }
  if (ctx.type === 'question') {
    const optionsText = Object.entries(ctx.options).map(([k, v]) => `${k}. ${v}`).join('\n');
    let content = `The user is looking at this practice question:\n${ctx.question}\n${optionsText}`;
    if (ctx.correctAnswers) {
      content += `\n\nThe correct answer(s): ${ctx.correctAnswers.join(', ')}`;
      if (ctx.explanation) content += `\nExplanation shown to the user: ${ctx.explanation}`;
    }
    return { role: 'system', content };
  }
  return null;
}

function renderMessages() {
  const list = document.getElementById('chatMessages');
  if (!list) return;
  list.innerHTML = history.length
    ? history.map((m) => `
      <div class="chat-msg chat-msg-${m.role}">
        <div class="chat-msg-bubble">${esc(m.content)}</div>
      </div>`).join('')
    : '<div class="chat-empty">Ask a question about what you&rsquo;re studying.</div>';
  list.scrollTop = list.scrollHeight;
}

function setStatus(text, isError) {
  const el = document.getElementById('chatStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'chat-status' + (isError ? ' chat-status-error' : '');
}

function setSendDisabled(disabled) {
  const btn = document.getElementById('chatSendBtn');
  if (btn) btn.disabled = disabled;
}

async function sendMessage(text) {
  if (sending) return;
  const config = getChatConfig();
  if (!config || !config.baseUrl) {
    setStatus('Chatbot not configured.', true);
    return;
  }

  sending = true;
  setSendDisabled(true);

  history.push({ role: 'user', content: text });
  saveHistory(history);
  renderMessages();
  setStatus('Thinking…', false);

  const contextMessage = buildContextMessage();
  const recent = history.slice(-MAX_HISTORY_TURNS);
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (contextMessage) messages.push(contextMessage);
  messages.push(...recent);

  activeAbort = new AbortController();
  const timeoutId = setTimeout(() => activeAbort.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model || 'auto', messages }),
      signal: activeAbort.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('Empty response');
    history.push({ role: 'assistant', content: reply });
    saveHistory(history);
    renderMessages();
    setStatus('', false);
  } catch {
    setStatus("Can't reach the chatbot — connect to Tailscale and try again.", true);
  } finally {
    clearTimeout(timeoutId);
    activeAbort = null;
    sending = false;
    setSendDisabled(false);
  }
}

function openPanel() {
  panelOpen = true;
  document.getElementById('chatWidgetRoot')?.classList.add('chat-open');
  renderMessages();
  const config = getChatConfig();
  if (!config || !config.baseUrl) setStatus('Chatbot not configured.', true);
}

function closePanel() {
  panelOpen = false;
  document.getElementById('chatWidgetRoot')?.classList.remove('chat-open');
  if (activeAbort) activeAbort.abort();
}

function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

export function mountChatWidget() {
  if (document.getElementById('chatWidgetRoot')) return;

  const div = document.createElement('div');
  div.id = 'chatWidgetRoot';
  div.className = 'chat-widget';
  div.innerHTML = `
    <button class="chat-fab" id="chatToggleBtn" type="button" aria-label="Open chatbot">&#128172;</button>
    <div class="chat-panel">
      <div class="chat-panel-header">
        <span>Study Chat</span>
        <button class="chat-close" id="chatCloseBtn" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-status" id="chatStatus"></div>
      <form class="chat-input-row" id="chatForm">
        <input type="text" id="chatInput" placeholder="Ask about AWS..." autocomplete="off" />
        <button type="submit" class="btn btn-primary" id="chatSendBtn">Send</button>
      </form>
    </div>
  `;
  document.body.appendChild(div);

  document.getElementById('chatToggleBtn').addEventListener('click', togglePanel);
  document.getElementById('chatCloseBtn').addEventListener('click', closePanel);
  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendMessage(text);
  });
}

export function explainCurrent() {
  const ctx = getChatContext();
  if (!ctx || ctx.type !== 'question' || !ctx.correctAnswers) return;
  if (!panelOpen) openPanel();
  sendMessage(`Briefly explain why ${ctx.correctAnswers.join(', ')} is/are correct and the other options are wrong.`);
}
```

- [ ] **Step 2: Import and mount it from app.js**

In `practice-web/public/app.js`, add near the top (line 1, before `const app = document.getElementById('app');`):

```js
import { mountChatWidget } from './chatbot.js';
```

Then at the very end of the file, right before the final `bootstrap().catch(showError);` line, add:

```js
mountChatWidget();
```

- [ ] **Step 3: Verify manually**

```bash
cd practice-web
node --check public/chatbot.js || true   # expected: Node will report top-level `import`/`export` as a syntax error under plain --check — that's expected for an ES module file, not a real failure
```
Since this file is only ever loaded by the browser as an ES module (never by Node directly), the real check is: start the dev server, open the app in a browser, and confirm the DevTools console shows no module-loading errors, exactly one chat button renders bottom-right (inspect the DOM — only one `#chatWidgetRoot` element), and clicking it opens an empty panel with "Chatbot not configured." (since `OMNIROUTE_URL` isn't set locally). Navigate between dashboard/doc/quiz/drill a few times and confirm the button/panel is still the single original element (check `document.querySelectorAll('#chatWidgetRoot').length === 1` in the console), never duplicated.

```bash
cd practice-web
npm run dev &
sleep 1
curl -s http://localhost:3000/ | grep -o 'app.js[^"]*\|chatbot.js[^"]*'
kill %1 2>/dev/null
```
Expected: confirms `index.html`/`app.js` reference resolves; then do the actual browser check described above before committing.

- [ ] **Step 4: Commit**

```bash
cd practice-web
git add public/chatbot.js public/app.js
git commit -m "Add floating chatbot widget talking directly to OmniRoute"
```

---

## Task 4: Widget styling

**Files:**
- Modify: `practice-web/public/styles.css` (append new rules at end of file)

**Interfaces:**
- Consumes: class names from Task 3's markup (`chat-widget`, `chat-fab`, `chat-panel`, `chat-open`, `chat-panel-header`, `chat-close`, `chat-messages`, `chat-msg`, `chat-msg-user`, `chat-msg-assistant`, `chat-msg-bubble`, `chat-empty`, `chat-status`, `chat-status-error`, `chat-input-row`).

- [ ] **Step 1: Append widget styles**

Append to `practice-web/public/styles.css`:

```css
/* ── Chat widget ──────────────────────────────────────────────────────────── */
.chat-widget { position: fixed; bottom: 20px; right: 20px; z-index: 60; }

.chat-fab {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--accent, #2563eb); color: #fff; border: none;
  font-size: 22px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.25);
}

.chat-panel {
  display: none; flex-direction: column;
  position: absolute; bottom: 64px; right: 0;
  width: 320px; max-height: 440px;
  background: var(--surface, #161b22); border: 1px solid var(--border, #30363d);
  border-radius: 10px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}

.chat-widget.chat-open .chat-panel { display: flex; }

.chat-panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; font-weight: 600; border-bottom: 1px solid var(--border, #30363d);
}

.chat-close { background: none; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; }

.chat-messages { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; min-height: 160px; }

.chat-empty { color: var(--text-dim); font-size: 13px; }

.chat-msg { display: flex; }
.chat-msg-user { justify-content: flex-end; }
.chat-msg-assistant { justify-content: flex-start; }

.chat-msg-bubble {
  max-width: 85%; padding: 6px 10px; border-radius: 8px; font-size: 13px; white-space: pre-wrap;
  background: var(--surface-2, #21262d); color: var(--text, #e6edf3);
}
.chat-msg-user .chat-msg-bubble { background: var(--accent, #2563eb); color: #fff; }

.chat-status { padding: 0 12px 6px; font-size: 12px; color: var(--text-dim); min-height: 16px; }
.chat-status-error { color: var(--danger, #f85149); }

.chat-input-row { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--border, #30363d); }
.chat-input-row input {
  flex: 1; background: var(--surface-2, #21262d); border: 1px solid var(--border, #30363d);
  color: var(--text, #e6edf3); border-radius: 6px; padding: 6px 8px; font-size: 13px;
}

.chat-explain-btn { margin-top: 8px; }
```

- [ ] **Step 2: Verify manually**

Reload the app in a browser (dev server already running from Task 3), click the chat button, confirm the panel opens below/above the button without clipping off-screen and text is readable in whatever theme (light/dark) the app currently uses.

- [ ] **Step 3: Commit**

```bash
cd practice-web
git add public/styles.css
git commit -m "Style the chatbot widget"
```

---

## Task 5: "Explain this answer" button

**Files:**
- Modify: `practice-web/public/app.js` — `renderQuizQuestion` (feedback block, line ~626-630) and `bindQuizEvents` (line 675+); `renderDrillQuestion` (feedback block, line ~1126-1130) and `bindDrillEvents` (line 1174+)

**Interfaces:**
- Consumes: `explainCurrent()` from Task 3.

- [ ] **Step 1: Import `explainCurrent` in app.js**

Change the import added in Task 3 to:

```js
import { mountChatWidget, explainCurrent } from './chatbot.js';
```

- [ ] **Step 2: Add the button to the quiz feedback block**

In `renderQuizQuestion`, change:

```js
    feedback = `
      <div class="quiz-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="quiz-feedback-header">${icon} ${label}</div>
        ${q.explanation ? `<div class="quiz-feedback-explanation">${esc(q.explanation)}</div>` : ''}
      </div>`;
```

to:

```js
    feedback = `
      <div class="quiz-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="quiz-feedback-header">${icon} ${label}</div>
        ${q.explanation ? `<div class="quiz-feedback-explanation">${esc(q.explanation)}</div>` : ''}
        <button class="btn btn-ghost chat-explain-btn" id="quizExplainBtn" type="button">Explain this</button>
      </div>`;
```

- [ ] **Step 3: Bind the quiz button**

In `bindQuizEvents`, add (anywhere after the function's existing `document.getElementById(...)` bindings):

```js
  document.getElementById('quizExplainBtn')?.addEventListener('click', () => {
    explainCurrent();
  });
```

- [ ] **Step 4: Add the button to the drill feedback block**

In `renderDrillQuestion`, change:

```js
    feedback = `
      <div class="quiz-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="quiz-feedback-header">${icon} ${label}</div>
        ${q.explanation ? `<div class="quiz-feedback-explanation">${esc(q.explanation)}</div>` : ''}
      </div>`;
```

to:

```js
    feedback = `
      <div class="quiz-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="quiz-feedback-header">${icon} ${label}</div>
        ${q.explanation ? `<div class="quiz-feedback-explanation">${esc(q.explanation)}</div>` : ''}
        <button class="btn btn-ghost chat-explain-btn" id="drillExplainBtn" type="button">Explain this</button>
      </div>`;
```

- [ ] **Step 5: Bind the drill button**

In `bindDrillEvents`, add (anywhere after the function's existing `document.getElementById(...)` bindings):

```js
  document.getElementById('drillExplainBtn')?.addEventListener('click', () => {
    explainCurrent();
  });
```

- [ ] **Step 6: Verify manually**

With the dev server running and `OMNIROUTE_URL` pointed at a reachable OmniRoute instance (or left unset to confirm the "not configured" path), answer a quiz question, click "Explain this", and confirm the chat panel opens and either shows a reply or the "not configured"/"can't reach" status — never a thrown JS error in the console. Repeat for a drill question.

- [ ] **Step 7: Commit**

```bash
cd practice-web
git add public/app.js
git commit -m "Add 'Explain this answer' quick action to quiz and drill questions"
```

---

## Task 6: End-to-end verification and deployment config

**Files:**
- None (verification + Vercel dashboard configuration only)

- [ ] **Step 1: Verify the CORS assumption against the real OmniRoute instance**

This step needs to run from a machine that can actually reach the home machine (the agent implementing this plan cannot do it from a sandboxed environment). With OmniRoute running and reachable over your tailnet:

```bash
curl -i -X OPTIONS "https://<your-machine>.<tailnet>.ts.net:20128/v1/chat/completions" \
  -H "Origin: https://practice-web-aws.vercel.app" \
  -H "Access-Control-Request-Method: POST"
```
Expected: response includes `Access-Control-Allow-Origin: *` (or the Vercel origin specifically). If it's missing, the widget's "can't reach the chatbot" path will fire for every real request even though the host is reachable — note this and add a small CORS-reflecting proxy in front of OmniRoute on the same machine (separate follow-up, out of this plan's scope per the spec).

- [ ] **Step 2: Set the production env vars**

In the Vercel project (`practice-web`, team `nobugsjustfeatures-projects`), add:
- `OMNIROUTE_URL` = `https://<your-machine>.<tailnet>.ts.net:20128`
- `OMNIROUTE_MODEL` = the free model/tier you want as default (e.g. `auto`)

- [ ] **Step 3: Full manual smoke test checklist**

On a device connected to the tailnet, against the deployed site:
- [ ] Chat button renders on dashboard, doc, quiz, and drill pages.
- [ ] On a doc page, open chat and ask a question about that doc's content — reply should reference it.
- [ ] On an unrevealed quiz question, open chat — confirm (via browser DevTools network tab) the request payload has no `correctAnswers`/explanation text anywhere.
- [ ] Reveal a question, click "Explain this" — reply addresses the right option.
- [ ] Disconnect from Tailscale (or point `OMNIROUTE_URL` at an unreachable host temporarily) — confirm the "can't reach the chatbot" message appears within ~4s, not a hang.
- [ ] Reload the page mid-conversation — history persists (same tab) via `sessionStorage`; open a new tab — history is empty.

- [ ] **Step 4: Push the implementation commits**

```bash
cd /home/kaitovu/projects/aws-saa-c03-prac
git push origin main
```

// No import from './app.js' here on purpose: app.js is loaded by index.html
// as '/app.js?v=5', and a relative import from this file would resolve to
// the query-string-less '/app.js', which the browser's module map treats as
// a SEPARATE module instance — silently double-running the whole app (two
// `state` objects, two bootstrap() fetches, two hashchange listeners). The
// caller injects its context/config accessors into mountChatWidget() instead.
let getContextFn = () => null;
let getConfigFn = () => null;

const HISTORY_KEY = 'saa_chat_history_v1';
const MAX_HISTORY_TURNS = 6;
const REQUEST_TIMEOUT_MS = 30000;
const SYSTEM_PROMPT =
  'You are a concise AWS SAA-C03 study assistant embedded in a practice app. ' +
  'Use any provided context about the current question or reading section. ' +
  "If you're not sure about an AWS fact, say so rather than guessing. Keep answers short.";

let panelOpen = false;
let sending = false;
let activeAbort = null;
let lastFailedText = null;

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
  const ctx = getContextFn();
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

function showRetry(show) {
  const btn = document.getElementById('chatRetryBtn');
  if (btn) btn.hidden = !show;
}

async function sendMessage(text, { isRetry = false } = {}) {
  if (sending) return;
  const config = getConfigFn();
  if (!config || !config.baseUrl) {
    setStatus('Chatbot not configured.', true);
    return;
  }

  sending = true;
  setSendDisabled(true);
  showRetry(false);

  if (!isRetry) {
    history.push({ role: 'user', content: text });
    saveHistory(history);
    renderMessages();
  }
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
    lastFailedText = null;
  } catch {
    lastFailedText = text;
    setStatus("Can't reach the chatbot — connect to Tailscale and try again.", true);
    showRetry(true);
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
  const config = getConfigFn();
  if (!config || !config.baseUrl) setStatus('Chatbot not configured.', true);
}

function closePanel() {
  // Deliberately does NOT abort an in-flight request: the request is already
  // bounded by REQUEST_TIMEOUT_MS, and aborting here would both waste the
  // free-tier provider call that's already in progress and mislabel it as a
  // connection failure when the user reopens the panel.
  panelOpen = false;
  document.getElementById('chatWidgetRoot')?.classList.remove('chat-open');
}

function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

export function mountChatWidget({ getContext, getConfig }) {
  getContextFn = getContext;
  getConfigFn = getConfig;

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
      <button class="btn btn-ghost chat-retry-btn" id="chatRetryBtn" type="button" hidden>Retry</button>
      <form class="chat-input-row" id="chatForm">
        <input type="text" id="chatInput" placeholder="Ask about AWS..." autocomplete="off" />
        <button type="submit" class="btn btn-primary" id="chatSendBtn">Send</button>
      </form>
    </div>
  `;
  document.body.appendChild(div);

  document.getElementById('chatToggleBtn').addEventListener('click', togglePanel);
  document.getElementById('chatCloseBtn').addEventListener('click', closePanel);
  document.getElementById('chatRetryBtn').addEventListener('click', () => {
    if (lastFailedText) sendMessage(lastFailedText, { isRetry: true });
  });
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
  const ctx = getContextFn();
  if (!ctx || ctx.type !== 'question' || !ctx.correctAnswers) return;
  if (!panelOpen) openPanel();
  sendMessage(`Briefly explain why ${ctx.correctAnswers.join(', ')} is/are correct and the other options are wrong.`);
}

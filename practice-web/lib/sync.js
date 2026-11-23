// Cross-device progress sync: merge logic + Upstash Redis (REST) storage.
const zlib = require('zlib');

const KEY = 'saa:sync:v1';
const MAX_SESSIONS = 60;

function restConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function isConfigured() { return Boolean(restConfig()); }

async function redis(cmd) {
  const cfg = restConfig();
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || `Redis HTTP ${r.status}`);
  return d.result;
}

async function load() {
  const raw = await redis(['GET', KEY]);
  if (!raw) return emptyBlob();
  return JSON.parse(zlib.gunzipSync(Buffer.from(raw, 'base64')).toString('utf8'));
}

async function save(blob) {
  await redis(['SET', KEY, zlib.gzipSync(JSON.stringify(blob)).toString('base64')]);
}

function emptyBlob() { return { history: {}, sessions: [], quiz: {} }; }

// Per-question history: keep the record with more attempts; the latest answer
// (lastAt / lastCorrect) always comes from whichever device answered last.
function mergeHistory(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, rb] of Object.entries(b)) {
    const ra = out[k];
    if (!ra) { out[k] = rb; continue; }
    const attempts = Math.max(ra.attempts || 0, rb.attempts || 0);
    const correct = Math.min(attempts, Math.max(ra.correct || 0, rb.correct || 0));
    const latest = String(rb.lastAt || '') > String(ra.lastAt || '') ? rb : ra;
    out[k] = { attempts, correct, lastAt: latest.lastAt, lastCorrect: latest.lastCorrect };
  }
  return out;
}

function mergeSessions(a = [], b = []) {
  const byId = new Map();
  for (const s of [...a, ...b]) if (s && s.id != null && !byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((x, y) => y.id - x.id).slice(0, MAX_SESSIONS);
}

function mergeQuiz(a = {}, b = {}) {
  return { ...b, ...a }; // first argument wins on conflict
}

function merge(local, remote) {
  return {
    history: mergeHistory(remote.history, local.history),
    sessions: mergeSessions(remote.sessions, local.sessions),
    quiz: mergeQuiz(local.quiz, remote.quiz),
  };
}

module.exports = { isConfigured, load, save, merge, mergeHistory, mergeSessions, emptyBlob };

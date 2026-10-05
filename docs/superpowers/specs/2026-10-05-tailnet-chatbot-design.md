# Tailnet-only study chatbot (OmniRoute)

## Goal
Add a floating chatbot to the practice-web app that answers simple AWS SAA-C03
questions during reading/quiz/drill, aware of what the user is currently
looking at. Must stay free (self-hosted OmniRoute, free-tier LLM providers)
and must not expand the app's public abuse surface.

## Non-goals
- No new public backend proxy for the LLM call.
- No persistent chat history storage (session-only).
- No streaming responses, no multi-turn summarization, no auth system.

## Transport & access
OmniRoute (https://github.com/diegosouzapw/OmniRoute) runs persistently on the
user's home machine, already joined to their Tailscale tailnet. The browser
calls it directly over its tailnet HTTPS hostname
(`https://<machine>.<tailnet>.ts.net:20128/v1/chat/completions`, OpenAI-compatible
body) — Vercel's backend is never in the request path for the LLM call.

Non-tailnet visitors simply can't reach that private hostname; the widget
treats fetch failure/timeout as "chatbot unavailable, connect to Tailscale."
This keeps the feature free of any public rate-limit/abuse concern since
nothing publicly reachable changes.

**Risk / unverified assumption:** the browser origin is
`practice-web-aws.vercel.app`, the target is a different origin
(`*.ts.net`), so the request is cross-origin. This only works if OmniRoute
returns permissive CORS headers. First implementation step is a manual check
(curl/browser fetch with an `Origin` header) against a running OmniRoute
instance. If it fails, the fallback — out of scope for this spec, noted for
later — is a tiny CORS-reflecting reverse proxy on the same machine, in front
of OmniRoute.

## Config
Extend the existing `GET /api/config` handler in `server.js` to include:
```json
{ "chat": { "baseUrl": "<OMNIROUTE_URL env, or null>", "model": "<OMNIROUTE_MODEL env, default 'auto'>" } }
```
Both sourced from env vars so the target machine/model can change without a
code deploy. If `OMNIROUTE_URL` is unset, the frontend renders the widget in
a disabled state ("not configured") rather than erroring.

## Frontend

### Widget
New `public/chatbot.js` ES module, imported from `index.html` alongside the
existing `app.js`. Renders a floating button + slide-out panel appended to
`document.body` (outside the SPA's `#app` mount so it survives route
changes). Minimal chat UI: scrollable message list, text input, send button.

### Context awareness
`app.js` maintains a single exported mutable object, e.g. `chatContext`,
updated at the top of each relevant render function:

| Current view | `chatContext` shape |
|---|---|
| Dashboard / other | `null` |
| Reading a doc (`renderDoc`) | `{ type: 'doc', title, markdown }` — `markdown` truncated to 6000 chars |
| Quiz/drill question, unrevealed (`renderQuizQuestion`/`renderDrillQuestion`) | `{ type: 'question', question, options }` — **no answer**, avoids spoiling |
| Quiz/drill question, revealed | `{ type: 'question', question, options, correctAnswers, explanation }` |

`chatbot.js` reads `chatContext` at send time (via an imported getter from
`app.js`, not a global) — no polling, no observers.

### Request shape
On send: build `messages = [systemPrompt, contextMessage?, ...lastNTurns, userMessage]`
(`N` = 6, to bound payload size) and `POST` to
`${config.chat.baseUrl}/v1/chat/completions` with `model: config.chat.model`,
non-streaming. System prompt is a short static string: AWS SAA-C03 study
assistant, concise, use given context, say "not sure" rather than guess AWS
facts.

Chat history lives in `sessionStorage` only (per-tab), not sent anywhere else,
cleared on tab close. No IndexedDB, no server persistence.

### Error handling
Each request uses an `AbortController` with a ~4s timeout. On abort/network
error/non-2xx: show an inline panel message "Can't reach the chatbot —
connect to Tailscale and try again" with a manual retry button. No automatic
retry loop (protects the free-tier provider from being hammered if the home
machine is offline).

### "Explain this answer" feature
Once a quiz/drill question is revealed, a small "Explain this" button renders
next to the existing feedback block (`renderQuizQuestion` and
`renderDrillQuestion`). Click → opens the chat panel and auto-sends a
pre-built prompt built from that question's revealed `chatContext` ("Explain
briefly why {correct} is right and the others are wrong"). Reuses the normal
send pipeline; no separate endpoint or code path.

## Files touched
- `server.js` — extend `/api/config` response.
- `public/index.html` — add `<script>` tag for `chatbot.js`.
- `public/app.js` — add/export `chatContext` + getter; set it in `renderDoc`,
  `renderQuizQuestion`, `renderDrillQuestion`; add "Explain this" button +
  handler in the two question renderers.
- `public/chatbot.js` — new: widget markup, open/close, send pipeline,
  sessionStorage history, error/timeout handling.
- `public/styles.css` — widget styles (button, panel, messages, "Explain
  this" button).

## Testing
No test framework exists in this repo today. Verification is manual:
1. Confirm `/api/config` returns the new `chat` block locally with env vars
   set, and `{baseUrl: null}` when unset.
2. Confirm the CORS assumption against a real running OmniRoute instance
   before building the send pipeline (spike step, see Risk above).
3. Manually exercise: widget disabled when unconfigured; context-free chat on
   dashboard; doc context on a reading page; question context before/after
   reveal (confirm answer is never present pre-reveal); "Explain this"
   button; offline/timeout error path.

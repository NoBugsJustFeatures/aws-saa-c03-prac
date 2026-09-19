# Quiz dump migration — design spec

Date: 2026-09-19
Status: Approved by user (chat), implementation in progress

## Problem

`practice-web/` (this repo) is missing the per-topic Quiz feature entirely — no
dashboard cards, no quiz UI, no question-bank data or API routes for it.
Only a single full 65-question timed exam (`S-practice-exam.md`) exists
locally. However, a live Vercel deployment (`practice-web-aws.vercel.app`,
project `practice-web`, not git-connected) has the full feature, built from a
local folder that was never pushed to this repo. Its 20 per-topic quizzes are
currently populated with 5–10 ChatGPT-generated questions each.

The user has now supplied real AWS SAA-C03 exam dumps (5 usable `.docx`
files, ~934 unique questions after dedup) and wants every per-topic quiz
replaced with questions drawn from those dumps, categorized by topic. The
65-question `S-practice-exam.md` (already dump-sourced) must be left
untouched.

## Recovered baseline

Fetched directly (plain HTTP, no auth) from the live deployment:
- `public/index.html`, `public/app.js` (804 lines), `public/styles.css`
  (897 lines) — the actual missing frontend.
- Live JSON samples from `/api/docs`, `/api/quiz/:slug`,
  `/api/quiz/:slug/score` establishing the exact API contract.

API contract (confirmed from live responses + `app.js` source):
- `GET /api/docs` → array of `{filename, slug, title, isExam, isReference, hasQuiz}`.
- `GET /api/quiz/:slug` → `{slug, totalQuestions, questions:[{number, question, options:{A,B,C,D}, correctAnswer, explanation}]}`.
  Study mode reveals `correctAnswer` directly (untimed, per-question reveal).
- `POST /api/quiz/:slug/score` body `{answers:{number: letter}}` →
  `{total, correct, incorrect, percentage, details:[{number, question, userAnswer, correctAnswer, isCorrect, explanation}]}`.
- `GET /api/exam`, `POST /api/exam/score` — unchanged, existing behavior.

20 quizzable docs total (matches "0/20" progress seen live): 14 numbered
core-service guides (01–14) + 6 lettered architecture guides (A, B, C, D, E, K).

## Scope (confirmed with user)

- Replace dump-sourced question banks for **all 20 quizzes** (not just the
  14 core-service ones shown in the screenshot).
- Leave `S-practice-exam.md` and its API path untouched.
- Build multi-select ("Choose two") support end-to-end — not present today.
- Recover and ship the real dashboard/quiz/doc-reader UI (currently absent
  from this repo).
- **Do not deploy to Vercel yet** — user hasn't granted Vercel MCP access
  in this session. Everything up to and including local verification is
  in scope; the `vercel --prod` push is a separate, explicitly-gated step.

## Source data

5 `.docx` files in `exam-dumps/drive-download-*.zip` (1 exact duplicate
`PART-2 (1).docx` discarded). Extracted by shelling out to the system
`unzip` CLI for `word/document.xml` and regex-parsing `<w:p>`/`<w:t>` runs
(validated byte-identical to a reference Python/ElementTree extraction; no
new npm dependency needed). Format per question: `Question N`, scenario
text, options `A.`–`D.`, ✅ marking one or two correct options ("Choose
two." phrasing signals multi-select).

- 993 raw question blocks parsed down to 963 successfully (30 dropped —
  see below), 934 unique after de-duping identical normalized question
  text across parts.
- 105 of the 963 parsed are multi-select (2 correct answers).
- 30 blocks are dropped: in a scattered subset of questions, the source
  `.docx` lost the separator between adjacent options entirely (e.g.
  `"...DynamoDBC. Application Load Balancer..."`, no space or period
  between option B's end and option C's start) — this is unrecoverable
  from the text alone and not worth guessing at. Validated by testing the
  real parser against all 5 extracted parts, not estimated.

## Pipeline design

One-time build script, `practice-web/scripts/build-quizzes.js` (Node, no new
runtime deps — reuses the same docx-XML extraction approach), run manually
and not part of the served app:

1. **Extract**: unzip each `.docx`, read `word/document.xml`, walk `<w:p>`
   paragraphs joining `<w:t>` runs — same method already validated during
   investigation.
2. **Parse**: split on `Question N` markers. Within each block, locate the
   4 option markers by searching **from the end of the block backward** —
   last `D. `, then the last `C. ` before that `D`, then the last `B. `
   before that `C`, then the last `A. ` before that `B` (marker regex:
   `(?<![A-Za-z])X\.\s+`, i.e. the letter isn't itself preceded by a
   letter — rules out mid-word matches like the "A" in "USA."). Searching
   backward from the end is deliberate: option text can run together
   without a separating space (`"...group.B. Use a..."`), so a
   forward/line-anchored search misses those, while false-positive
   letter-period matches (e.g. a sentence starting "A company...")
   cluster in the question prose near the start, not near the options at
   the end. Mark ✅-flagged options as `correctAnswers` (array of 1 or 2
   letters); strip the ✅ marker from stored option text. A block where
   any of the 4 markers can't be found this way, or where none of the 4
   options carry a ✅, is dropped (see the 30 dropped blocks above).
3. **Dedupe**: normalize question text (lowercase, collapsed whitespace),
   keep first occurrence across parts in part order.
4. **Classify**: keyword/service dictionary maps each question to one of
   the 14 core-service categories. Score = weighted keyword hit count
   (hits inside the *correct* option text weighted 2x vs. hits in question
   body or distractors). Highest-scoring category wins. A question with 3
   or more categories scoring within 20% of its top score is routed to
   `14-so-sanh-services` (comparison) instead.
   - The 6 architecture-guide quizzes (A/B/C/D/E/K) are **not** run through
     a second classifier. Instead each draws a fixed sample from the
     already-classified per-category pools, via a static source-category
     map:
     - `a-nen-tang-kien-truc` (foundational architecture) ← compute + networking + management
     - `b-bao-mat-compliance` (security & compliance) ← security
     - `c-kien-truc-web-app` (web app architecture) ← compute + networking + database
     - `d-kien-truc-luu-tru` (storage architecture) ← storage + migration
     - `e-kien-truc-database` (database architecture) ← database
     - `k-kich-ban-thi` (exam scenarios) ← even sample across all 14 categories
     A question may appear in one core-service quiz AND one architecture
     quiz (different axes, sampled independently), but never twice within
     the same quiz.
5. **Cap**: default max 60 questions per quiz, randomly sampled (seeded,
   reproducible) when a category has more matches; all matches included
   when fewer than 60.
6. **Write**: one JSON file per slug to `practice-web/data/quizzes/<slug>.json`:
   `{slug, totalQuestions, questions:[{number, question, options:{A,B,C,D}, correctAnswers:["C"], explanation:null}]}`.
   `explanation` is left `null` for all dump-sourced questions — the dumps
   have no explanation text, and fabricating one per question risks being
   wrong; the UI already handles a missing explanation gracefully.
7. **Report**: print a per-slug question count and a sample of questions
   routed to `13-other-services` (the catch-all) so the classification can
   be spot-checked before committing — full manual review of 934 questions
   isn't feasible.

## Backend changes (`server.js`)

- Extend `/api/docs` to compute and include `isReference` and `hasQuiz`
  (derived from a static list of reference-only filenames, and from the
  presence of a matching file under `data/quizzes/`).
- Add `GET /api/quiz/:slug` — read `data/quizzes/<slug>.json`, return as-is
  (answers included; study mode, matching live contract).
- Add `POST /api/quiz/:slug/score` — accept `{answers:{number: letter-or-letters}}`.
  For a single-answer question, correct = exact letter match. For a
  multi-select question, correct = the submitted set equals
  `correctAnswers` exactly (all-or-nothing, matching AWS's own scoring
  convention). Return `{total, correct, incorrect, percentage, details}`.
- `/api/exam`, `/api/exam/score`, `/api/config` unchanged.

## Frontend changes (`public/app.js`, `public/styles.css`)

- Start from the recovered live source (already matches the target design
  exactly) rather than reimplementing from the screenshot.
- Extend `renderQuizQuestion`/`bindQuizEvents` for multi-select: when
  `q.correctAnswers.length > 1`, render checkboxes instead of radios, allow
  toggling multiple options, and require an explicit "Check answer" click
  (can't auto-reveal on first click like single-select does) before
  scoring/revealing that question. Existing `.quiz-option`
  `selected`/`correct`/`incorrect`/`answered` CSS classes are reused as-is
  — no new styles needed, confirmed against the recovered `styles.css`.
- `state.quizAnswers[number]` becomes a string for single-answer questions
  and an array for multi-select — `submitQuiz`/scoring on both client and
  server treat it uniformly by normalizing to an array before comparing.

## Testing

- Run `npm start` locally, exercise the dashboard, a single-answer quiz,
  a multi-select quiz, and the existing 65-Q exam through a browser
  (Playwright via the webapp-testing skill) to confirm rendering, scoring,
  and that the exam path is unaffected.
- Spot-check the classification report for at least 3 categories to catch
  systematic misrouting before calling the migration done.

## Explicitly out of scope

- Regenerating or touching `S-practice-exam.md` / `/api/exam`.
- Deploying to Vercel (blocked on user granting MCP access this session).
- Writing new explanations for dump-sourced questions.
- Any UI redesign beyond what's needed for multi-select — the recovered
  design is the target as-is.

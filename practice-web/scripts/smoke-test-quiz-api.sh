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

echo "--- GET /api/quiz/..%2F..%2Fpackage (path traversal, expect 404) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/quiz/..%2F..%2Fpackage")
if [ "$STATUS" != "404" ]; then echo "FAIL: expected 404, got $STATUS"; exit 1; fi
echo "OK: path-traversal slug returns 404"

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
  for (const f of fs.readdirSync("data/quizzes")) {
    const d = JSON.parse(fs.readFileSync(`data/quizzes/${f}`, "utf8"));
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

echo "All smoke tests passed."

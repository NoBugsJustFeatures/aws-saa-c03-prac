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

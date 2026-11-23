const test = require('node:test');
const assert = require('node:assert');
const { mergeHistory, mergeSessions, merge } = require('./sync');

test('history keeps higher attempts and latest answer', () => {
  const a = { 'x:1': { attempts: 2, correct: 1, lastAt: '2026-01-01', lastCorrect: true } };
  const b = { 'x:1': { attempts: 3, correct: 1, lastAt: '2026-02-01', lastCorrect: false }, 'x:2': { attempts: 1, correct: 1, lastAt: '2026-01-05', lastCorrect: true } };
  const m = mergeHistory(a, b);
  assert.deepStrictEqual(m['x:1'], { attempts: 3, correct: 1, lastAt: '2026-02-01', lastCorrect: false });
  assert.ok(m['x:2']);
});

test('merge is idempotent', () => {
  const l = { history: { 'x:1': { attempts: 1, correct: 1, lastAt: 'a', lastCorrect: true } }, sessions: [{ id: 2 }, { id: 1 }], quiz: { s: { p: 1 } } };
  const once = merge(l, { history: {}, sessions: [], quiz: {} });
  assert.deepStrictEqual(merge(once, once), once);
});

test('sessions union by id, newest first, capped', () => {
  const many = Array.from({ length: 70 }, (_, i) => ({ id: i }));
  const m = mergeSessions(many, [{ id: 999 }, { id: 5 }]);
  assert.strictEqual(m.length, 60);
  assert.strictEqual(m[0].id, 999);
});

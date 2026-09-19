const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupeQuestions, seededSample } = require('./utils');

test('dedupeQuestions drops repeats with normalized-equal question text', () => {
  const qs = [
    { question: 'What  is   S3?', options: {}, correctAnswers: ['A'] },
    { question: 'what is s3?', options: {}, correctAnswers: ['B'] },
    { question: 'What is EC2?', options: {}, correctAnswers: ['A'] },
  ];
  const out = dedupeQuestions(qs);
  assert.equal(out.length, 2);
  assert.equal(out[0].correctAnswers[0], 'A'); // first occurrence kept
});

test('seededSample returns the whole array unshuffled when n >= length', () => {
  const arr = [1, 2, 3];
  assert.deepEqual(seededSample(arr, 5, 42), [1, 2, 3]);
});

test('seededSample returns exactly n items and is reproducible for the same seed', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const a = seededSample(arr, 10, 42);
  const b = seededSample(arr, 10, 42);
  assert.equal(a.length, 10);
  assert.deepEqual(a, b);
});

test('seededSample gives different results for different seeds', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const a = seededSample(arr, 10, 1);
  const b = seededSample(arr, 10, 2);
  assert.notDeepEqual(a, b);
});

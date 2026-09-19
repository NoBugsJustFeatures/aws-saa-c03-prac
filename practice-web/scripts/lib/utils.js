function dedupeQuestions(questions) {
  const seen = new Set();
  const out = [];
  for (const q of questions) {
    const norm = q.question.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(q);
  }
  return out;
}

// Deterministic PRNG (mulberry32) so sampling is reproducible per seed.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSample(array, n, seed) {
  if (array.length <= n) return [...array];
  const rand = mulberry32(seed);
  const copy = [...array];
  for (let i = copy.length - 1; i >= copy.length - n; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(copy.length - n);
}

module.exports = { dedupeQuestions, seededSample };

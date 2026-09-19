function findAllMarkers(text, letter) {
  const re = new RegExp(`(?<![A-Za-z])${letter}\\.\\s+`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m.index);
  return out;
}

// Locates the 4 option markers by scanning from the END of the block
// backward (last D, then last C before that D, then last B before that
// C, then last A before that B). Options sometimes run together with no
// separating space ("...group.B. Use a...") which breaks a forward/
// line-anchored search; false-positive letter-period matches (a sentence
// starting "A company...") cluster in the question prose near the start,
// not near the real options at the end, so anchoring from the end avoids
// them.
function locateOptions(block) {
  const dPositions = findAllMarkers(block, 'D');
  if (!dPositions.length) return null;
  const idxD = dPositions[dPositions.length - 1];

  const cPositions = findAllMarkers(block, 'C').filter((i) => i < idxD);
  if (!cPositions.length) return null;
  const idxC = cPositions[cPositions.length - 1];

  const bPositions = findAllMarkers(block, 'B').filter((i) => i < idxC);
  if (!bPositions.length) return null;
  const idxB = bPositions[bPositions.length - 1];

  const aPositions = findAllMarkers(block, 'A').filter((i) => i < idxB);
  if (!aPositions.length) return null;
  const idxA = aPositions[aPositions.length - 1];

  const dRawText = block.slice(idxD + 2).trim();

  // Check for a 5th option (E marker in the D text). If present, the block
  // has too many options and we cannot parse it reliably, so reject it.
  const ePositions = findAllMarkers(dRawText, 'E');
  if (ePositions.length) {
    return { error: 'too-many-options' };
  }

  return {
    questionText: block.slice(0, idxA).trim(),
    raw: {
      A: block.slice(idxA + 2, idxB).trim(),
      B: block.slice(idxB + 2, idxC).trim(),
      C: block.slice(idxC + 2, idxD).trim(),
      D: dRawText,
    },
  };
}

function parseDump(rawText, sourceLabel) {
  const questions = [];
  const malformed = [];
  const blockRegex = /\nQuestion\s+(\d+)\s*\n([\s\S]*?)(?=\nQuestion\s+\d+\s*\n|$)/g;
  const text = `\n${rawText.trim()}\n`;
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    const number = Number(m[1]);
    const block = m[2].trim();
    const located = locateOptions(block);
    if (!located) {
      malformed.push({ number, reason: 'no-option-markers' });
      continue;
    }
    if (located.error) {
      malformed.push({ number, reason: located.error });
      continue;
    }

    const options = {};
    const correctAnswers = [];
    for (const letter of ['A', 'B', 'C', 'D']) {
      let optText = located.raw[letter];
      if (optText.includes('✅')) {
        correctAnswers.push(letter);
        optText = optText.replace(/✅/g, '').trim();
      }
      options[letter] = optText;
    }

    if (!located.questionText || correctAnswers.length < 1) {
      malformed.push({ number, reason: 'empty-q-or-no-answer' });
      continue;
    }

    questions.push({
      source: sourceLabel,
      number,
      question: located.questionText,
      options,
      correctAnswers,
    });
  }
  return { questions, malformed };
}

module.exports = { parseDump };

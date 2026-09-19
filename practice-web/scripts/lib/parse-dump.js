function findAllMarkers(text, letter) {
  const re = new RegExp(`(?<![A-Za-z0-9-])${letter}\\.\\s+`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m.index);
  return out;
}

// Locates option markers by scanning from the END of the block backward.
// Tries 6 options first (A-F), then 5 (A-E), then 4 (A-D). Uses whichever
// resolves cleanly with all markers in strict decreasing position order.
// Options sometimes run together with no separating space ("...group.B. Use a..."),
// and false-positive letter-period matches cluster in question prose, so
// anchoring from the end avoids ambiguity.
function locateOptionsForCount(block, letters) {
  const positions = new Array(letters.length);
  let searchBefore = block.length + 1;
  for (let i = letters.length - 1; i >= 0; i--) {
    const candidates = findAllMarkers(block, letters[i]).filter((p) => p < searchBefore);
    if (!candidates.length) return null;
    const idx = candidates[candidates.length - 1];
    positions[i] = idx;
    searchBefore = idx;
  }
  const questionText = block.slice(0, positions[0]).trim();
  const raw = {};
  for (let i = 0; i < letters.length; i++) {
    const start = positions[i] + 2;
    const end = i + 1 < letters.length ? positions[i + 1] : block.length;
    raw[letters[i]] = block.slice(start, end).trim();
  }
  return { questionText, raw };
}

function locateOptions(block) {
  for (const letters of [
    ['A', 'B', 'C', 'D', 'E', 'F'],
    ['A', 'B', 'C', 'D', 'E'],
    ['A', 'B', 'C', 'D'],
  ]) {
    const result = locateOptionsForCount(block, letters);
    if (result) return result;
  }
  return null;
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

    const options = {};
    const correctAnswers = [];
    for (const letter of Object.keys(located.raw)) {
      let optText = located.raw[letter];
      if (optText.includes('✅')) {
        correctAnswers.push(letter);
        optText = optText.replace(/✅/g, '').trim();
      }
      options[letter] = optText;
    }

    // Check for embedded marker-shaped fragments (newline followed by letter-period-space).
    // These indicate corrupted blocks where options from different source questions bled together,
    // or where a repeated correct option's text ended up inside another option's text.
    const embeddedMarkerPattern = /\n[A-Z]\.\s/;
    let hasEmbeddedMarker = false;
    for (const optText of Object.values(options)) {
      if (embeddedMarkerPattern.test(optText)) {
        hasEmbeddedMarker = true;
        break;
      }
    }
    if (hasEmbeddedMarker) {
      malformed.push({ number, reason: 'embedded-marker-leftover' });
      continue;
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

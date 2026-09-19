const test = require('node:test');
const assert = require('node:assert/strict');
const { extractParagraphsFromXml } = require('./extract-docx');

test('extractParagraphsFromXml joins text runs within each paragraph', () => {
  const xml = `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:r><w:t>Question  1</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Hello &amp; </w:t></w:r><w:r><w:t>World</w:t></w:r></w:p>
    <w:p></w:p>
  </w:body></w:document>`;
  const lines = extractParagraphsFromXml(xml);
  assert.deepEqual(lines, ['Question  1', 'Hello & World', '']);
});

test('extractParagraphsFromXml unescapes xml entities', () => {
  const xml = `<w:p><w:r><w:t>A &lt;tag&gt; &quot;quoted&quot; &apos;text&apos;</w:t></w:r></w:p>`;
  const lines = extractParagraphsFromXml(xml);
  assert.deepEqual(lines, [`A <tag> "quoted" 'text'`]);
});

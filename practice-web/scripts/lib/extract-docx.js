const { execSync } = require('child_process');

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractParagraphsFromXml(xml) {
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const textRunRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const paragraphs = xml.match(paraRegex) || [];
  return paragraphs.map((p) => {
    let text = '';
    let m;
    textRunRegex.lastIndex = 0;
    while ((m = textRunRegex.exec(p)) !== null) {
      text += m[1];
    }
    return unescapeXml(text);
  });
}

function extractDocxText(filePath) {
  const xml = execSync(`unzip -p "${filePath}" word/document.xml`, {
    maxBuffer: 1024 * 1024 * 50,
  }).toString('utf8');
  return extractParagraphsFromXml(xml).join('\n');
}

module.exports = { extractParagraphsFromXml, extractDocxText };

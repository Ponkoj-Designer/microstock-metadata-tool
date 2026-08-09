// Scratch test script for JSON parsing
function parseTest(rawText, filename, platform) {
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch (e) { throw new Error(`JSON parse error: ${e.message}`); }
    } else {
      throw new Error(`Invalid JSON output: "${cleaned.substring(0, 50)}"`);
    }
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('Not object');
  return {
    title: parsed.title,
    description: parsed.description,
    keywords: parsed.keywords,
    category: parsed.category
  };
}

const sample1 = '```json\n{"filename":"test.jpg","title":"Pine Forest at Dawn","description":"Misty pine trees","keywords":["pine","forest","mist"],"category":"Landscapes"}\n```';
const result1 = parseTest(sample1, 'test.jpg', { titleMaxLen: 200, keywordMax: 50 });
console.log('Sample 1 parsed OK:', result1.title, result1.keywords.length, 'keywords');

const sample2 = 'Here is the JSON:\n{"filename":"test2.jpg","title":"Neon City","description":"Cyberpunk skyline","keywords":["cyberpunk","neon","city"],"category":"Technology"}';
const result2 = parseTest(sample2, 'test2.jpg', { titleMaxLen: 200, keywordMax: 50 });
console.log('Sample 2 parsed OK:', result2.title, result2.keywords.length, 'keywords');

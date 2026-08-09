/**
 * Mock AI Metadata Generator Engine
 * Simulates microstock AI vision model processing for uploaded files.
 */

const KEYWORD_BANK = {
  nature: ['landscape', 'outdoor', 'scenic', 'environment', 'wilderness', 'horizon', 'sky', 'sunlight', 'natural light', 'view', 'eco', 'fresh air', 'tranquility', 'peaceful', 'beauty in nature', 'panorama', 'season', 'breathtaking', 'horizon', 'cloudscape'],
  business: ['corporate', 'professional', 'office', 'workplace', 'collaboration', 'strategy', 'planning', 'finance', 'career', 'management', 'leadership', 'success', 'growth', 'teamwork', 'executive', 'meeting', 'workspace', 'modern', 'digital transformation'],
  technology: ['digital', 'innovation', 'network', 'connection', 'cyber', 'data', 'future', 'futuristic', 'ai', 'artificial intelligence', 'software', 'hardware', 'screen', 'cloud computing', 'virtual reality', 'high tech', 'automation', 'internet'],
  people: ['person', 'lifestyle', 'portrait', 'smiling', 'looking at camera', 'casual', 'adult', 'authentic', 'diversity', 'expression', 'happiness', 'human', 'emotion', 'wellbeing', 'togetherness', 'activity'],
  food: ['gourmet', 'delicious', 'fresh', 'tasty', 'culinary', 'recipe', 'meal', 'nutrition', 'healthy', 'eating', 'beverage', 'tabletop', 'ingredient', 'homemade', 'flatlay', 'organic', 'diet'],
  architecture: ['structure', 'building', 'exterior', 'facade', 'modern architecture', 'urban', 'city', 'real estate', 'design', 'construction', 'property', 'window', 'downtown', 'landmark', 'minimalist', 'concrete', 'glass'],
  abstract: ['background', 'texture', 'pattern', 'gradient', 'artistic', 'creative', 'concept', 'shape', 'motion', 'light effect', 'wallpaper', 'copyspace', 'element', 'futuristic', 'style', 'decor', 'contemporary']
};

const CATEGORY_MAP = {
  landscape: 'Landscapes',
  mountain: 'Landscapes',
  forest: 'Landscapes',
  tree: 'Plants and Flowers',
  ocean: 'Landscapes',
  city: 'Buildings and Architecture',
  cyber: 'Technology',
  code: 'Technology',
  tech: 'Technology',
  office: 'Business',
  business: 'Business',
  meeting: 'Business',
  coffee: 'Food',
  food: 'Food',
  meal: 'Food',
  building: 'Buildings and Architecture',
  house: 'Buildings and Architecture',
  abstract: 'Graphic Resources',
  art: 'Graphic Resources',
  texture: 'Graphic Resources',
  people: 'People',
  girl: 'People',
  man: 'People',
  woman: 'People'
};

function formatFileNameToWords(filename) {
  const baseName = filename.replace(/\.[^/.]+$/, "");
  return baseName
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

function capitalizeWords(str) {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Generates realistic microstock metadata for a file
 */
export function generateMockMetadataForFile(file, targetPlatformConfig = null) {
  const nameWords = formatFileNameToWords(file.name);
  let mainTheme = 'abstract';

  for (const [keyword, cat] of Object.entries(CATEGORY_MAP)) {
    if (nameWords.includes(keyword)) {
      mainTheme = keyword === 'landscape' || keyword === 'mountain' ? 'nature' :
                  keyword === 'city' || keyword === 'cyber' || keyword === 'code' ? 'technology' :
                  keyword === 'office' || keyword === 'business' ? 'business' :
                  keyword === 'coffee' || keyword === 'food' ? 'food' :
                  keyword === 'building' ? 'architecture' : 'abstract';
      break;
    }
  }

  // Title construction
  const cleanSubject = capitalizeWords(nameWords);
  const titleTemplates = [
    `${cleanSubject} with Modern Lighting and Commercial Aesthetic`,
    `High Quality Shot of ${cleanSubject} in Contemporary Style`,
    `Professional Stock Photo of ${cleanSubject} - Commercial Concept`,
    `Detailed Close Up View of ${cleanSubject} for Design Project`,
    `${cleanSubject} Banner Background with Copy Space`
  ];
  const title = titleTemplates[Math.floor(Math.random() * titleTemplates.length)];

  // Description construction
  const description = `Detailed commercial microstock photograph featuring ${nameWords}. Perfect for editorial publications, marketing campaigns, website headers, advertising materials, and corporate presentation layouts.`;

  // Category
  const category = CATEGORY_MAP[mainTheme] || 'Graphic Resources';

  // Keyword generation (Targeting 30 - 45 high-relevance stock keywords)
  const nameKeywords = nameWords.split(' ').filter(w => w.length > 2);
  const themeKeywords = KEYWORD_BANK[mainTheme] || KEYWORD_BANK.abstract;
  const generalKeywords = [
    'high quality', 'stock photo', 'commercial', 'concept', 'modern', 
    'background', 'design element', 'copyspace', 'no people', 'detail', 
    'horizontal', 'sharp focus', 'vibrant colors', 'presentation', 'banner', 
    'media', 'digital', 'professional', 'creative', 'style', 'idea'
  ];

  // Combine and deduplicate
  const rawKeywords = [
    ...nameKeywords,
    ...themeKeywords,
    ...generalKeywords
  ];

  const uniqueKeywords = Array.from(new Set(rawKeywords.map(k => k.toLowerCase())))
    .filter(k => k.trim().length > 0);

  // Trim to platform recommended limit if provided
  const maxKeywords = targetPlatformConfig ? (targetPlatformConfig.keywordMax || 50) : 50;
  const finalKeywords = uniqueKeywords.slice(0, maxKeywords);

  return {
    title: title.slice(0, targetPlatformConfig?.titleMaxLen || 200),
    description: description,
    category: category,
    keywords: finalKeywords
  };
}

/**
 * Simulates async metadata generation with progress updates
 */
export async function simulateBatchGeneration(mediaItems, platformConfig, onProgress) {
  const updatedItems = [...mediaItems];
  const total = updatedItems.length;

  for (let i = 0; i < total; i++) {
    const item = updatedItems[i];
    
    // Skip if already generated unless forced
    item.status = 'generating';
    if (onProgress) onProgress(i + 1, total, item.id, 'generating');

    // Simulate AI inference latency (150ms per item for responsive feel)
    await new Promise(resolve => setTimeout(resolve, 180));

    if (!item.metadata || !item.metadata.title) {
      item.metadata = generateMockMetadataForFile({ name: item.name }, platformConfig);
    }
    
    item.status = 'ready';
    if (onProgress) onProgress(i + 1, total, item.id, 'ready');
  }

  return updatedItems;
}

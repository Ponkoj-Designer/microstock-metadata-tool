/**
 * Microstock Platform Configurations, Authentic Brand Logos, and Validation Rules
 */

export const PLATFORMS = {
  general: {
    id: 'general',
    name: 'General',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="url(#grad-gen)"/>
      <text x="16" y="21.5" font-family="'Inter', sans-serif" font-weight="900" font-size="18" text-anchor="middle" fill="#FFFFFF">G</text>
      <defs>
        <linearGradient id="grad-gen" x1="0" y1="0" x2="32" y2="32">
          <stop stop-color="#6366F1"/>
          <stop offset="1" stop-color="#06B6D4"/>
        </linearGradient>
      </defs>
    </svg>`,
    color: '#6366F1',
    colorBg: 'rgba(99, 102, 241, 0.16)',
    colorBorder: 'rgba(99, 102, 241, 0.35)',
    titleMaxLen: 200,
    titleMinLen: 5,
    keywordMin: 5,
    keywordMax: 50,
    keywordRecommended: 30,
    categoriesRequired: 0,
    csvColumns: ['Filename', 'Title', 'Description', 'Keywords', 'Category'],
    categories: ['General', 'Abstract', 'Animals', 'Architecture', 'Business', 'Food', 'Nature', 'People', 'Technology'],
    description: 'Universal microstock metadata format compatible with all major stock agencies.'
  },
  adobe: {
    id: 'adobe',
    name: 'AdobeStock',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#FF2A2A"/>
      <text x="16" y="21" font-family="'Inter', sans-serif" font-weight="900" font-size="14" text-anchor="middle" fill="#FFFFFF" letter-spacing="-0.03em">AS</text>
    </svg>`,
    color: '#FF2A2A',
    colorBg: 'rgba(255, 42, 42, 0.16)',
    colorBorder: 'rgba(255, 42, 42, 0.35)',
    titleMaxLen: 200,
    titleMinLen: 5,
    keywordMin: 5,
    keywordMax: 50,
    keywordRecommended: 30,
    categoriesRequired: 1,
    csvColumns: ['Filename', 'Title', 'Keywords', 'Category'],
    categories: [
      'Animals', 'Buildings and Architecture', 'Business', 'Drinks', 'Environment',
      'States of Mind', 'Food', 'Graphic Resources', 'Hobbies and Leisure', 'Industry',
      'Landscapes', 'Lifestyle', 'People', 'Plants and Flowers', 'Culture and Religion',
      'Science', 'Social Issues', 'Sports', 'Technology', 'Transport', 'Travel'
    ],
    description: 'Title required (max 200 chars), up to 50 keywords ordered by relevance, 1 category.'
  },
  magnific: {
    id: 'magnific',
    name: 'Magnific',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="url(#grad-mag)"/>
      <text x="16" y="21.5" font-family="'Inter', sans-serif" font-weight="900" font-size="18" text-anchor="middle" fill="#FFFFFF">M</text>
      <defs>
        <linearGradient id="grad-mag" x1="0" y1="0" x2="32" y2="32">
          <stop stop-color="#EC4899"/>
          <stop offset="1" stop-color="#8B5CF6"/>
        </linearGradient>
      </defs>
    </svg>`,
    color: '#EC4899',
    colorBg: 'rgba(236, 72, 153, 0.16)',
    colorBorder: 'rgba(236, 72, 153, 0.35)',
    titleMaxLen: 250,
    titleMinLen: 5,
    keywordMin: 5,
    keywordMax: 50,
    keywordRecommended: 30,
    categoriesRequired: 0,
    csvColumns: ['Filename', 'Title', 'Prompt', 'Keywords'],
    categories: ['AI Art', 'Generative', 'Concept Art', '3D Render', 'Photography', 'Illustration'],
    description: 'AI Upscaler & Image Generation prompt and metadata cataloger.'
  },
  shutterstock: {
    id: 'shutterstock',
    name: 'Shutterstock',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#FF3333"/>
      <text x="16" y="21" font-family="'Inter', sans-serif" font-weight="900" font-size="14" text-anchor="middle" fill="#FFFFFF" letter-spacing="-0.03em">ST</text>
    </svg>`,
    color: '#FF3333',
    colorBg: 'rgba(255, 51, 51, 0.16)',
    colorBorder: 'rgba(255, 51, 51, 0.35)',
    titleMaxLen: 150,
    titleMinLen: 5,
    keywordMin: 7,
    keywordMax: 50,
    keywordRecommended: 35,
    categoriesRequired: 2,
    csvColumns: ['Filename', 'Description', 'Keywords', 'Categories'],
    categories: [
      'Abstract', 'Animals/Wildlife', 'Arts', 'Backgrounds/Textures', 'Beauty/Fashion',
      'Buildings/Landmarks', 'Business/Finance', 'Celebrities', 'Education', 'Food and Drink',
      'Healthcare/Medical', 'Holidays', 'Industrial', 'Interiors', 'Miscellaneous',
      'Nature', 'Objects', 'Parks/Outdoor', 'People', 'Religion', 'Science', 'Technology',
      'Signs/Symbols', 'Sports/Recreation', 'Transportation', 'Vectors', 'Vintage'
    ],
    description: 'Requires Description, up to 50 keywords, and up to 2 Categories.'
  },
  vecteezy: {
    id: 'vecteezy',
    name: 'Vecteezy',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="url(#grad-vec)"/>
      <text x="16" y="21.5" font-family="'Inter', sans-serif" font-weight="900" font-size="18" text-anchor="middle" fill="#FFFFFF">V</text>
      <defs>
        <linearGradient id="grad-vec" x1="0" y1="0" x2="32" y2="32">
          <stop stop-color="#FF6B00"/>
          <stop offset="1" stop-color="#FF9900"/>
        </linearGradient>
      </defs>
    </svg>`,
    color: '#FF6B00',
    colorBg: 'rgba(255, 107, 0, 0.16)',
    colorBorder: 'rgba(255, 107, 0, 0.35)',
    titleMaxLen: 100,
    titleMinLen: 5,
    keywordMin: 5,
    keywordMax: 50,
    keywordRecommended: 30,
    categoriesRequired: 1,
    csvColumns: ['Filename', 'Title', 'Keywords', 'License'],
    categories: ['Vectors', 'Icons', 'Illustrations', 'Patterns', 'Backgrounds', 'Templates'],
    description: 'Optimized for Vector and Graphic asset metadata submission.'
  },
  depositphotos: {
    id: 'depositphotos',
    name: 'Depositphotos',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#FF9900"/>
      <text x="16" y="21.5" font-family="'Inter', sans-serif" font-weight="900" font-size="18" text-anchor="middle" fill="#0F172A">D</text>
    </svg>`,
    color: '#FF9900',
    colorBg: 'rgba(255, 153, 0, 0.16)',
    colorBorder: 'rgba(255, 153, 0, 0.35)',
    titleMaxLen: 150,
    titleMinLen: 5,
    keywordMin: 5,
    keywordMax: 50,
    keywordRecommended: 30,
    categoriesRequired: 1,
    csvColumns: ['Filename', 'Title', 'Description', 'Keywords', 'Categories'],
    categories: [
      'Abstract', 'Animals', 'Architecture', 'Business', 'Cities', 'Education',
      'Food & Drink', 'Holidays', 'Industry', 'Nature', 'People', 'Science', 'Shopping',
      'Sports', 'Technology', 'Transportation', 'Backgrounds'
    ],
    description: 'Title, Description, 50 keywords, and primary category tag.'
  },
  rf123: {
    id: 'rf123',
    name: '123RF',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#E6007E"/>
      <text x="16" y="20.5" font-family="'Inter', sans-serif" font-weight="900" font-size="12" text-anchor="middle" fill="#FFFFFF" letter-spacing="-0.04em">123</text>
    </svg>`,
    color: '#E6007E',
    colorBg: 'rgba(230, 0, 126, 0.16)',
    colorBorder: 'rgba(230, 0, 126, 0.35)',
    titleMaxLen: 150,
    titleMinLen: 5,
    keywordMin: 5,
    keywordMax: 50,
    keywordRecommended: 30,
    categoriesRequired: 0,
    csvColumns: ['Filename', 'Title', 'Description', 'Keywords'],
    categories: [],
    description: 'Title, Description, and comma-separated keywords.'
  },
  dreamstime: {
    id: 'dreamstime',
    name: 'Dreamstime',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#00A3E0"/>
      <text x="16" y="21.5" font-family="'Inter', sans-serif" font-weight="900" font-size="18" text-anchor="middle" fill="#FFFFFF">D</text>
    </svg>`,
    color: '#00A3E0',
    colorBg: 'rgba(0, 163, 224, 0.16)',
    colorBorder: 'rgba(0, 163, 224, 0.35)',
    titleMaxLen: 200,
    titleMinLen: 5,
    keywordMin: 5,
    keywordMax: 80,
    keywordRecommended: 40,
    categoriesRequired: 1,
    csvColumns: ['Filename', 'Image Name', 'Description', 'Keywords', 'Category'],
    categories: [
      'Abstract', 'Animal', 'Arts & Architecture', 'Business', 'Editorial',
      'Illustrations & Clipart', 'IT & C', 'Nature', 'Object', 'People', 'Travel'
    ],
    description: 'Image Name (Title), Description, up to 80 keywords, and Primary Category.'
  }
};

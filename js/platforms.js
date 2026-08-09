/**
 * Microstock Platform Configurations, Authentic Brand Logos, and Validation Rules
 */

export const PLATFORMS = {
  adobe: {
    id: 'adobe',
    name: 'Adobe Stock',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#ED2224"/>
      <path d="M7 23.5c0-2.4 1.9-3.6 4.7-4l1.6-.3c1.1-.2 1.5-.5 1.5-1 0-.6-.6-.9-1.5-.9-1.1 0-2.2.3-3.1.9l-1.1-2c1.2-.9 2.7-1.3 4.4-1.3 2.9 0 4.6 1.5 4.6 3.6 0 2.2-1.6 3.4-4.4 3.8l-1.5.3c-1.2.2-1.7.6-1.7 1.1 0 .7.7 1 1.7 1 1.2 0 2.6-.5 3.5-1.2l1.1 1.9c-1.3 1-3 1.5-4.8 1.5-3.1 0-5-1.5-5-3.8zm12.5-9h2.4v2.1h-2.4v4.7c0 .8.3 1.1 1.1 1.1.4 0 .9-.1 1.2-.3l.3 2c-.7.3-1.6.5-2.5.5-2.1 0-3.1-1-3.1-2.9v-5.2h-1.5V14.5h1.5v-2.4l2.4-.7V14.5z" fill="#FFFFFF"/>
    </svg>`,
    color: '#ED2224',
    colorBg: 'rgba(237, 34, 36, 0.15)',
    colorBorder: 'rgba(237, 34, 36, 0.35)',
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
  shutterstock: {
    id: 'shutterstock',
    name: 'Shutterstock',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#EE2B2A"/>
      <path d="M16 6a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14z" fill="#FFFFFF" opacity="0.35"/>
      <circle cx="16" cy="16" r="3" fill="#FFFFFF"/>
      <path d="M12 12.5L15.5 9h4L16 12.5h-4zm8 7L16.5 23h-4l3.5-3.5h4z" fill="#FFFFFF"/>
    </svg>`,
    color: '#EE2B2A',
    colorBg: 'rgba(238, 43, 42, 0.15)',
    colorBorder: 'rgba(238, 43, 42, 0.35)',
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
  freepik: {
    id: 'freepik',
    name: 'Freepik',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#0066FF"/>
      <path d="M9 23V9h6.5c2.4 0 4.1 1.4 4.1 3.6 0 2.1-1.5 3.3-3.3 3.5l3.9 5.0h-3.3l-3.5-4.5H11.6V23H9zm2.6-6.8h4c1.2 0 2-.6 2-1.6 0-1-.8-1.5-2-1.5h-4v3.1z" fill="#FFFFFF"/>
    </svg>`,
    color: '#0066FF',
    colorBg: 'rgba(0, 102, 255, 0.15)',
    colorBorder: 'rgba(0, 102, 255, 0.35)',
    titleMaxLen: 100,
    titleMinLen: 10,
    keywordMin: 10,
    keywordMax: 30,
    keywordRecommended: 25,
    categoriesRequired: 0,
    csvColumns: ['Filename', 'Title', 'Keywords'],
    categories: [],
    description: 'Requires concise Title (10-100 chars) and 10 to 30 relevant keywords.'
  },
  istock: {
    id: 'istock',
    name: 'iStock / Getty',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#00D1B2"/>
      <path d="M8 22V11h2.5v11H8zm4.5 0V14.3h2.5V22h-2.5zm0-9.6v-2.2h2.5v2.2h-2.5zm4.5 9.6V11h2.5v3.6c.6-.8 1.6-1.2 2.8-1.2 2.4 0 4 1.8 4 4.8s-1.6 4.8-4 4.8c-1.2 0-2.2-.4-2.8-1.2V22H17zm2.5-4.8c0 1.8.8 2.8 2.1 2.8 1.3 0 2.1-1 2.1-2.8s-.8-2.8-2.1-2.8c-1.3 0-2.1 1-2.1 2.8z" fill="#0F172A"/>
    </svg>`,
    color: '#00D1B2',
    colorBg: 'rgba(0, 209, 178, 0.15)',
    colorBorder: 'rgba(0, 209, 178, 0.35)',
    titleMaxLen: 250,
    titleMinLen: 5,
    keywordMin: 5,
    keywordMax: 50,
    keywordRecommended: 30,
    categoriesRequired: 0,
    csvColumns: ['Filename', 'Title', 'Description', 'Keywords'],
    categories: [],
    description: 'Title & Description fields, max 50 keywords with controlled vocabulary.'
  },
  dreamstime: {
    id: 'dreamstime',
    name: 'Dreamstime',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#00A3E0"/>
      <path d="M9 9h6c4.2 0 7.2 2.7 7.2 6.8s-3 6.8-7.2 6.8H9V9zm3.2 10.8h2.8c2.6 0 4.1-1.6 4.1-4s-1.5-4-4.1-4h-2.8v8z" fill="#FFFFFF"/>
    </svg>`,
    color: '#00A3E0',
    colorBg: 'rgba(0, 163, 224, 0.15)',
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
  },
  depositphotos: {
    id: 'depositphotos',
    name: 'Depositphotos',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#FF9900"/>
      <path d="M8.5 9h6.2c3.8 0 6.3 2.5 6.3 6.5s-2.5 6.5-6.3 6.5H8.5V9zm3 10.2h3c2.1 0 3.5-1.4 3.5-3.7s-1.4-3.7-3.5-3.7h-3v7.4z" fill="#0F172A"/>
    </svg>`,
    color: '#FF9900',
    colorBg: 'rgba(255, 153, 0, 0.15)',
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
      <rect width="32" height="32" rx="6" fill="#E6007E"/>
      <path d="M7.5 23v-2.4l3.6-3.6c.6-.6 1-1.1 1-1.7 0-.5-.4-.9-1.1-.9-.7 0-1.3.3-1.8.8l-1.4-1.6c.9-.9 2-1.4 3.4-1.4 2 0 3.4 1 3.4 2.7 0 1.2-.5 2.1-1.7 3.2L10.4 20.6H14.8V23H7.5zm9 0V12.4L14.4 13v-2.2l3.5-1.4h1.1V23h-2.5zm5.5 0v-2.2l3.2-3.6c.5-.5.8-1 .8-1.5 0-.5-.3-.8-.9-.8-.6 0-1.1.3-1.5.7l-1.3-1.4c.7-.8 1.8-1.3 3-1.3 1.8 0 3.1 1 3.1 2.5 0 1-.5 1.9-1.4 2.9L24.8 20.6h3.4V23H22z" fill="#FFFFFF"/>
    </svg>`,
    color: '#E6007E',
    colorBg: 'rgba(230, 0, 126, 0.15)',
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
  custom: {
    id: 'custom',
    name: 'Custom',
    logoSvg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#334155"/>
      <path d="M16 8.5a2.5 2.5 0 00-2.5 2.5v.2a5.5 5.5 0 00-1.5.7l-.2-.2a2.5 2.5 0 00-3.5 3.5l.2.2c-.3.4-.5.9-.7 1.5H7.5a2.5 2.5 0 000 5h.2c.2.6.4 1.1.7 1.5l-.2.2a2.5 2.5 0 003.5 3.5l.2-.2c.4.3.9.5 1.5.7v.2a2.5 2.5 0 005 0v-.2c.6-.2 1.1-.4 1.5-.7l.2.2a2.5 2.5 0 003.5-3.5l-.2-.2c.3-.4.5-.9.7-1.5h.2a2.5 2.5 0 000-5h-.2a5.5 5.5 0 00-.7-1.5l.2-.2a2.5 2.5 0 00-3.5-3.5l-.2.2a5.5 5.5 0 00-1.5-.7V11A2.5 2.5 0 0016 8.5zm0 5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z" fill="#94A3B8"/>
    </svg>`,
    color: '#A855F7',
    colorBg: 'rgba(168, 85, 247, 0.15)',
    colorBorder: 'rgba(168, 85, 247, 0.35)',
    titleMaxLen: 250,
    titleMinLen: 3,
    keywordMin: 1,
    keywordMax: 100,
    keywordRecommended: 40,
    categoriesRequired: 0,
    csvColumns: ['Filename', 'Title', 'Description', 'Keywords', 'Category'],
    categories: [
      'General', 'Business', 'Technology', 'Nature', 'People', 'Food', 'Architecture', 'Abstract'
    ],
    description: 'Flexible custom mapping format for any personal or secondary microstock agency.'
  }
};

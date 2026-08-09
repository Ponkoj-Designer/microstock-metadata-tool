/**
 * Sample Microstock Photos & Vectors with realistic metadata for instant workflow preview
 */

export const SAMPLE_IMAGES = [
  {
    id: 'sample-1',
    name: 'foggy_mountain_pine_forest.jpg',
    assetType: 'image', // 'image', 'vector', 'pdf'
    format: 'JPG',
    size: 4829104, // ~4.8 MB
    dimensions: '6000 x 4000',
    type: 'image/jpeg',
    url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
    status: 'ready',
    metadata: {
      title: 'Foggy Pine Forest in Majestic Alpine Mountains at Dawn',
      description: 'Atmospheric landscape photo of misty evergreen pine tree forest covered in heavy fog among towering mountain peaks during serene sunrise. Ideal for outdoor adventure and tranquility concepts.',
      category: 'Landscapes',
      keywords: [
        'fog', 'mist', 'mountains', 'pine forest', 'alpine', 'nature', 'landscape', 
        'sunrise', 'dawn', 'evergreen', 'trees', 'atmospheric', 'tranquility', 
        'wilderness', 'outdoors', 'scenic', 'scenery', 'conifers', 'environment', 
        'moody', 'woodland', 'peaceful', 'cold', 'valley', 'horizon', 'sky', 
        'hiking', 'travel', 'fresh air', 'national park', 'cloudy', 'morning', 
        'adventure', 'eco', 'green', 'silhouette', 'breathtaking', 'view'
      ]
    }
  },
  {
    id: 'sample-2',
    name: 'cyberpunk_futuristic_city_neon.jpg',
    assetType: 'image',
    format: 'JPG',
    size: 5210944,
    dimensions: '5760 x 3840',
    type: 'image/jpeg',
    url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=800&q=80',
    status: 'ready',
    metadata: {
      title: 'Futuristic Cyberpunk Skyline with Neon Lights and Skyscrapers',
      description: 'Night perspective of modern metropolis illuminated by vibrant blue and purple neon illumination. High technology urban cityscape background for digital transformation and AI concepts.',
      category: 'Technology',
      keywords: [
        'cyberpunk', 'futuristic', 'neon', 'cityscape', 'metropolis', 'skyscrapers', 
        'night city', 'technology', 'artificial intelligence', 'glowing lights', 
        'urban', 'downtown', 'architecture', 'future', 'digital', 'purple neon', 
        'blue lights', 'dark background', 'perspective', 'modern city', 'innovation', 
        'data flow', 'smart city', 'telecommunication', 'connection', 'network', 
        'cyber security', 'virtual reality', 'sci-fi', 'night life'
      ]
    }
  },
  {
    id: 'sample-3',
    name: 'business_team_brainstorming_office.jpg',
    assetType: 'image',
    format: 'JPG',
    size: 3942000,
    dimensions: '5184 x 3456',
    type: 'image/jpeg',
    url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
    status: 'ready',
    metadata: {
      title: 'Diverse Business Team Collaborating in Modern Glass Office',
      description: 'Group of creative professionals collaborating around laptop screen in bright contemporary workspace. Teamwork, corporate strategy planning, and startup business discussion concept.',
      category: 'Business',
      keywords: [
        'business team', 'collaboration', 'coworkers', 'office meeting', 'diverse group', 
        'startup', 'modern office', 'teamwork', 'brainstorming', 'professionals', 
        'corporate', 'laptops', 'discussion', 'strategy', 'planning', 'creative team', 
        'young adults', 'workspace', 'glass office', 'cooperation', 'partnership', 
        'technology', 'communication', 'leadership', 'happy colleagues', 'workplace'
      ]
    }
  },
  {
    id: 'sample-4',
    name: 'vector_infographic_element_set.eps',
    assetType: 'vector',
    format: 'EPS',
    size: 14208000, // ~14.2 MB
    dimensions: 'Vector EPS',
    type: 'application/postscript',
    url: null, // No visual fake artwork rendering for EPS
    status: 'ready',
    metadata: {
      title: 'Modern Business Infographic Vector Charts and Diagram Elements',
      description: 'Scalable EPS vector illustration set containing colorful pie charts, bar graphs, timeline arrows, and corporate data visualization icons for presentation banners.',
      category: 'Graphic Resources',
      keywords: [
        'vector', 'eps', 'infographic', 'charts', 'diagram', 'business graphics', 
        'timeline', 'data visualization', 'pie chart', 'bar graph', 'corporate', 
        'presentation', 'scalable', 'flat design', 'elements', 'statistics'
      ]
    }
  },
  {
    id: 'sample-5',
    name: 'minimalist_modern_architecture_facade.jpg',
    assetType: 'image',
    format: 'JPG',
    size: 4610200,
    dimensions: '5472 x 3648',
    type: 'image/jpeg',
    url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80',
    status: 'ready',
    metadata: {
      title: 'Minimalist Contemporary Building Facade with Geometric Windows',
      description: 'Clean architectural line design of white modern residential building featuring rhythmic window patterns and harsh geometric shadows against blue clear sky.',
      category: 'Buildings and Architecture',
      keywords: [
        'architecture', 'minimalist', 'contemporary', 'building facade', 'geometric', 
        'windows', 'modern building', 'exterior', 'shadows', 'white facade', 
        'real estate', 'urban design', 'structure', 'construction', 'lines', 
        'symmetry', 'clear sky', 'blue sky', 'apartment building', 'facade design'
      ]
    }
  },
  {
    id: 'sample-6',
    name: 'abstract_geometric_pattern.svg',
    assetType: 'vector',
    format: 'SVG',
    size: 420100, // ~420 KB
    dimensions: 'Vector SVG',
    type: 'image/svg+xml',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="%230F172A"/><circle cx="400" cy="300" r="200" fill="none" stroke="%233B82F6" stroke-width="8"/><circle cx="400" cy="300" r="140" fill="none" stroke="%2306B6D4" stroke-width="6"/><circle cx="400" cy="300" r="80" fill="none" stroke="%238B5CF6" stroke-width="4"/><polygon points="400,100 500,450 200,300" fill="none" stroke="%2310B981" stroke-width="4"/></svg>',
    status: 'ready',
    metadata: {
      title: 'Abstract Geometric Glowing Lines Pattern Vector Seamless Background',
      description: 'Scalable SVG vector artwork displaying futuristic circular geometry and neon gradient lines on dark backdrop. Ideal for technology cover art and digital wallpaper.',
      category: 'Graphic Resources',
      keywords: [
        'abstract', 'svg', 'vector', 'geometric', 'pattern', 'neon lines', 
        'futuristic', 'technology', 'glowing circles', 'seamless', 'background', 
        'scalable', 'digital art', 'creative', 'cover design'
      ]
    }
  }
];

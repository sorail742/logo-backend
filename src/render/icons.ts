// Bibliothèque interne d'icônes (§5.5), générée depuis Lucide (licence ISC) : même liste que
// le front (src/lib/render/icons.ts). Tracés au trait sur une grille de 24 × 24.

export type IconNode = [tag: string, attrs: Record<string, string>][];

export interface LibraryIcon {
  id: string;
  tags: string[];
  license: 'ISC';
  node: IconNode;
}

export const ICONS: LibraryIcon[] = [
  {
    id: 'leaf',
    tags: ['nature', 'environnement', 'écologie', 'agriculture'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M11 20a10 10 0 0010-10 25.9 25.9 0 00-1.04-7.281 1 1 0 00-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0011 20',
        },
      ],
      ['path', { d: 'M2 21a5 5 0 012.911-4.544C7.613 15.212 8.351 15.24 11 13' }],
    ],
  },
  {
    id: 'sprout',
    tags: ['croissance', 'jeunesse', 'agriculture'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3',
        },
      ],
      ['path', { d: 'M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4' }],
      ['path', { d: 'M5 21h14' }],
    ],
  },
  {
    id: 'tree-pine',
    tags: ['nature', 'forêt'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'm17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z',
        },
      ],
      ['path', { d: 'M12 22v-3' }],
    ],
  },
  {
    id: 'sun',
    tags: ['énergie', 'lumière', 'solaire'],
    license: 'ISC',
    node: [
      ['circle', { cx: '12', cy: '12', r: '4' }],
      ['path', { d: 'M12 2v2' }],
      ['path', { d: 'M12 20v2' }],
      ['path', { d: 'm4.93 4.93 1.41 1.41' }],
      ['path', { d: 'm17.66 17.66 1.41 1.41' }],
      ['path', { d: 'M2 12h2' }],
      ['path', { d: 'M20 12h2' }],
      ['path', { d: 'm6.34 17.66-1.41 1.41' }],
      ['path', { d: 'm19.07 4.93-1.41 1.41' }],
    ],
  },
  {
    id: 'droplet',
    tags: ['eau', 'santé'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
        },
      ],
    ],
  },
  {
    id: 'waves',
    tags: ['eau', 'mer', 'pêche'],
    license: 'ISC',
    node: [
      ['path', { d: 'M2 12q2.5 2 5 0t5 0 5 0 5 0' }],
      ['path', { d: 'M2 19q2.5 2 5 0t5 0 5 0 5 0' }],
      ['path', { d: 'M2 5q2.5 2 5 0t5 0 5 0 5 0' }],
    ],
  },
  {
    id: 'mountain',
    tags: ['montagne', 'voyage', 'tourisme'],
    license: 'ISC',
    node: [['path', { d: 'm8 3 4 8 5-5 5 15H2L8 3z' }]],
  },
  {
    id: 'globe',
    tags: ['international', 'monde', 'web'],
    license: 'ISC',
    node: [
      ['circle', { cx: '12', cy: '12', r: '10' }],
      ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
      ['path', { d: 'M2 12h20' }],
    ],
  },
  {
    id: 'heart',
    tags: ['santé', 'solidarité', 'humanitaire'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5',
        },
      ],
    ],
  },
  {
    id: 'hand-heart',
    tags: ['solidarité', 'bénévolat', 'association'],
    license: 'ISC',
    node: [
      ['path', { d: 'M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16' }],
      [
        'path',
        {
          d: 'm14.45 13.39 5.05-4.694C20.196 8 21 6.85 21 5.75a2.75 2.75 0 0 0-4.797-1.837.276.276 0 0 1-.406 0A2.75 2.75 0 0 0 11 5.75c0 1.2.802 2.248 1.5 2.946L16 11.95',
        },
      ],
      ['path', { d: 'm2 15 6 6' }],
      [
        'path',
        { d: 'm7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a1 1 0 0 0-2.75-2.91' },
      ],
    ],
  },
  {
    id: 'handshake',
    tags: ['partenariat', 'confiance', 'commerce'],
    license: 'ISC',
    node: [
      ['path', { d: 'm11 17 2 2a1 1 0 1 0 3-3' }],
      [
        'path',
        {
          d: 'm14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4',
        },
      ],
      ['path', { d: 'm21 3 1 11h-2' }],
      ['path', { d: 'M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3' }],
      ['path', { d: 'M3 4h8' }],
    ],
  },
  {
    id: 'users',
    tags: ['communauté', 'association', 'équipe'],
    license: 'ISC',
    node: [
      ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
      ['path', { d: 'M16 3.128a4 4 0 0 1 0 7.744' }],
      ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
      ['circle', { cx: '9', cy: '7', r: '4' }],
    ],
  },
  {
    id: 'graduation-cap',
    tags: ['éducation', 'école', 'étudiants'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z',
        },
      ],
      ['path', { d: 'M22 10v6' }],
      ['path', { d: 'M6 12.5V16a6 3 0 0 0 12 0v-3.5' }],
    ],
  },
  {
    id: 'book-open',
    tags: ['éducation', 'culture', 'lecture'],
    license: 'ISC',
    node: [
      ['path', { d: 'M12 5v16' }],
      [
        'path',
        {
          d: 'M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z',
        },
      ],
    ],
  },
  {
    id: 'lightbulb',
    tags: ['idée', 'innovation'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
        },
      ],
      ['path', { d: 'M9 18h6' }],
      ['path', { d: 'M10 22h4' }],
    ],
  },
  {
    id: 'rocket',
    tags: ['startup', 'lancement', 'technologie'],
    license: 'ISC',
    node: [
      ['path', { d: 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5' }],
      [
        'path',
        {
          d: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09',
        },
      ],
      [
        'path',
        {
          d: 'M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z',
        },
      ],
      ['path', { d: 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05' }],
    ],
  },
  {
    id: 'code',
    tags: ['développement', 'technologie', 'application'],
    license: 'ISC',
    node: [
      ['path', { d: 'm16 18 6-6-6-6' }],
      ['path', { d: 'm8 6-6 6 6 6' }],
    ],
  },
  {
    id: 'cpu',
    tags: ['technologie', 'numérique'],
    license: 'ISC',
    node: [
      ['path', { d: 'M12 20v2' }],
      ['path', { d: 'M12 2v2' }],
      ['path', { d: 'M17 20v2' }],
      ['path', { d: 'M17 2v2' }],
      ['path', { d: 'M2 12h2' }],
      ['path', { d: 'M2 17h2' }],
      ['path', { d: 'M2 7h2' }],
      ['path', { d: 'M20 12h2' }],
      ['path', { d: 'M20 17h2' }],
      ['path', { d: 'M20 7h2' }],
      ['path', { d: 'M7 20v2' }],
      ['path', { d: 'M7 2v2' }],
      ['rect', { x: '4', y: '4', width: '16', height: '16', rx: '2' }],
      ['rect', { x: '8', y: '8', width: '8', height: '8', rx: '1' }],
    ],
  },
  {
    id: 'smartphone',
    tags: ['application', 'mobile'],
    license: 'ISC',
    node: [
      ['rect', { width: '14', height: '20', x: '5', y: '2', rx: '2', ry: '2' }],
      ['path', { d: 'M12 18h.01' }],
    ],
  },
  {
    id: 'chart-line',
    tags: ['finance', 'croissance', 'données'],
    license: 'ISC',
    node: [
      ['path', { d: 'M3 3v16a2 2 0 0 0 2 2h16' }],
      ['path', { d: 'm19 9-5 5-4-4-3 3' }],
    ],
  },
  {
    id: 'wallet',
    tags: ['finance', 'paiement', 'banque'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1',
        },
      ],
      ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4' }],
    ],
  },
  {
    id: 'shopping-bag',
    tags: ['commerce', 'boutique'],
    license: 'ISC',
    node: [
      ['path', { d: 'M16 10a4 4 0 0 1-8 0' }],
      ['path', { d: 'M3.103 6.034h17.794' }],
      [
        'path',
        {
          d: 'M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z',
        },
      ],
    ],
  },
  {
    id: 'utensils',
    tags: ['restauration', 'cuisine'],
    license: 'ISC',
    node: [
      ['path', { d: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2' }],
      ['path', { d: 'M7 2v20' }],
      ['path', { d: 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7' }],
    ],
  },
  {
    id: 'coffee',
    tags: ['café', 'restauration'],
    license: 'ISC',
    node: [
      ['path', { d: 'M10 2v2' }],
      ['path', { d: 'M14 2v2' }],
      [
        'path',
        {
          d: 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1',
        },
      ],
      ['path', { d: 'M6 2v2' }],
    ],
  },
  {
    id: 'music',
    tags: ['musique', 'culture', 'événement'],
    license: 'ISC',
    node: [
      ['path', { d: 'M9 18V5l12-2v13' }],
      ['circle', { cx: '6', cy: '18', r: '3' }],
      ['circle', { cx: '18', cy: '16', r: '3' }],
    ],
  },
  {
    id: 'camera',
    tags: ['photo', 'médias'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z',
        },
      ],
      ['circle', { cx: '12', cy: '13', r: '3' }],
    ],
  },
  {
    id: 'palette',
    tags: ['art', 'design', 'créativité'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z',
        },
      ],
      ['circle', { cx: '13.5', cy: '6.5', r: '.5', fill: 'currentColor' }],
      ['circle', { cx: '17.5', cy: '10.5', r: '.5', fill: 'currentColor' }],
      ['circle', { cx: '6.5', cy: '12.5', r: '.5', fill: 'currentColor' }],
      ['circle', { cx: '8.5', cy: '7.5', r: '.5', fill: 'currentColor' }],
    ],
  },
  {
    id: 'stethoscope',
    tags: ['santé', 'médical'],
    license: 'ISC',
    node: [
      ['path', { d: 'M11 2v2' }],
      ['path', { d: 'M5 2v2' }],
      ['path', { d: 'M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1' }],
      ['path', { d: 'M8 15a6 6 0 0 0 12 0v-3' }],
      ['circle', { cx: '20', cy: '10', r: '2' }],
    ],
  },
  {
    id: 'shield',
    tags: ['sécurité', 'protection'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
        },
      ],
    ],
  },
  {
    id: 'scale',
    tags: ['justice', 'droit'],
    license: 'ISC',
    node: [
      ['path', { d: 'M12 3v18' }],
      ['path', { d: 'm19 8 3 8a5 5 0 0 1-6 0zV7' }],
      ['path', { d: 'M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1' }],
      ['path', { d: 'm5 8 3 8a5 5 0 0 1-6 0zV7' }],
      ['path', { d: 'M7 21h10' }],
    ],
  },
  {
    id: 'house',
    tags: ['immobilier', 'maison'],
    license: 'ISC',
    node: [
      ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
      [
        'path',
        {
          d: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        },
      ],
    ],
  },
  {
    id: 'truck',
    tags: ['transport', 'logistique'],
    license: 'ISC',
    node: [
      ['path', { d: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2' }],
      ['path', { d: 'M15 18H9' }],
      [
        'path',
        { d: 'M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14' },
      ],
      ['circle', { cx: '17', cy: '18', r: '2' }],
      ['circle', { cx: '7', cy: '18', r: '2' }],
    ],
  },
  {
    id: 'zap',
    tags: ['énergie', 'rapidité'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z',
        },
      ],
    ],
  },
  {
    id: 'star',
    tags: ['excellence', 'qualité'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
        },
      ],
    ],
  },
  {
    id: 'sparkles',
    tags: ['magie', 'beauté', 'nouveauté'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
        },
      ],
      ['path', { d: 'M20 2v4' }],
      ['path', { d: 'M22 4h-4' }],
      ['circle', { cx: '4', cy: '20', r: '2' }],
    ],
  },
  {
    id: 'message-circle',
    tags: ['communication', 'dialogue'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
        },
      ],
    ],
  },
  {
    id: 'trophy',
    tags: ['sport', 'victoire'],
    license: 'ISC',
    node: [
      ['path', { d: 'M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2' }],
      ['path', { d: 'M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2' }],
      ['path', { d: 'M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3' }],
      ['path', { d: 'M4 22h16' }],
      ['path', { d: 'M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z' }],
      ['path', { d: 'M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3' }],
    ],
  },
  {
    id: 'hexagon',
    tags: ['géométrique', 'abstrait'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
        },
      ],
    ],
  },
  {
    id: 'diamond',
    tags: ['luxe', 'géométrique'],
    license: 'ISC',
    node: [
      [
        'path',
        {
          d: 'M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z',
        },
      ],
    ],
  },
  {
    id: 'infinity',
    tags: ['abstrait', 'continuité'],
    license: 'ISC',
    node: [['path', { d: 'M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8' }]],
  },
];

export function getIcon(id: string): LibraryIcon | undefined {
  return ICONS.find((icon) => icon.id === id);
}

export function searchIcons(query: string): LibraryIcon[] {
  const q = fold(query);
  if (!q) return ICONS;
  return ICONS.filter(
    (icon) => icon.id.includes(q) || icon.tags.some((tag) => fold(tag).includes(q)),
  );
}

/** Minuscules sans accents, pour que « ecole » trouve « école ». */
function fold(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

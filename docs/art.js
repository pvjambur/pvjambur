// Shared pixel art: block textures, pixel font, miner sprite, item icons.
// Used by the browser game (docs/index.html) and the README generator (scripts/build.mjs),
// so the README images and the game always look the same.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const PAL = {
  stone: ['#7f7f7f', '#7a7a7a', '#878787', '#6e6e6e', '#8f8f8f', '#747474'],
  dirt: ['#8b5a3c', '#7a4e33', '#966747', '#6b4329', '#835438'],
  grass: ['#6cb03e', '#5f9f35', '#79bd47', '#56922f'],
  deep: ['#4d4d55', '#45454c', '#56565e', '#3d3d44', '#5d5d66'],
  bed: ['#1c1c1c', '#3a3a3a', '#575757', '#0d0d0d', '#6b6b6b'],
  cave: ['#2b2621', '#25201c', '#312b25', '#211c18'],
  plank: ['#b48a52', '#a67d47', '#bf955c'],
  log: ['#6b5032', '#5c4329', '#7a5c3b', '#4f3a24'],
  leaf: ['#3f8f2b', '#357d24', '#4a9e33', '#2d6b1e'],
};

// ore colours: [highlight, main, shadow]
export const ORES = {
  coal: ['#4a4a4a', '#2a2a2a', '#151515'],
  iron: ['#f0d2b8', '#d4a98a', '#9c7356'],
  gold: ['#fff7a8', '#f5d63c', '#c1901a'],
  diamond: ['#d8ffff', '#5ae6ee', '#1c9aa6'],
  emerald: ['#c8ffd8', '#3ee07a', '#138a42'],
  ruby: ['#ffd0d0', '#ef3e4a', '#9a1622'],
  sapphire: ['#d6e2ff', '#4d7cff', '#1f3c9e'],
  amethyst: ['#f0d8ff', '#b067f0', '#6a2aa6'],
  topaz: ['#ffe6c4', '#ff9a2e', '#b45b0c'],
  jade: ['#d8fff4', '#2fd6b0', '#127a63'],
  quartz: ['#ffffff', '#e8e2d6', '#a8a090'],
};

function base(r, pal, streak = 0.35) {
  const px = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (x > 0 && r() < streak) px.push(px[px.length - 1]);
      else px.push(pick(r, pal));
    }
  return px;
}

function sprinkleOre(r, px, ore, clusters) {
  const [hi, mid, lo] = ORES[ore];
  for (let c = 0; c < clusters; c++) {
    const cx = 2 + Math.floor(r() * 11), cy = 2 + Math.floor(r() * 11);
    const shape = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 1], [1, 2], [-1, 1], [2, 0]];
    const n = 5 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const [dx, dy] = shape[i];
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x > 15 || y > 15) continue;
      px[y * 16 + x] = i === 0 ? hi : (dx + dy >= 2 ? lo : mid);
    }
  }
  return px;
}

const cache = {};
export const BLOCKS = ['stone', 'dirt', 'grass', 'deep', 'bed', 'cave', 'plank', 'log', 'leaf',
  'coal', 'iron', 'gold', 'diamond', 'emerald',
  'ruby', 'sapphire', 'amethyst', 'topaz', 'jade', 'quartz'];

// Returns 256 colour strings ('' = transparent) for a 16x16 block.
export function texture(name) {
  if (cache[name]) return cache[name];
  const seed = [...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  const r = rng(seed);
  let px;
  switch (name) {
    case 'stone': px = base(r, PAL.stone); break;
    case 'dirt': px = base(r, PAL.dirt, 0.2); break;
    case 'deep': px = base(r, PAL.deep, 0.6); break;
    case 'cave': px = base(r, PAL.cave, 0.3); break;
    case 'bed': {
      px = new Array(256);
      for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) {
        const c = pick(r, PAL.bed);
        px[y * 16 + x] = px[y * 16 + x + 1] = px[(y + 1) * 16 + x] = px[(y + 1) * 16 + x + 1] = c;
      }
      break;
    }
    case 'grass': {
      px = base(r, PAL.dirt, 0.2);
      for (let x = 0; x < 16; x++) {
        const depth = 3 + Math.floor(r() * 3);
        for (let y = 0; y < depth; y++) px[y * 16 + x] = pick(r, PAL.grass);
      }
      break;
    }
    case 'plank': {
      px = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const row = Math.floor(y / 4);
        const seam = (x === (row % 2 ? 4 : 11));
        px.push(y % 4 === 3 || seam ? '#7d5a2f' : pick(r, PAL.plank));
      }
      break;
    }
    case 'log': {
      px = [];
      const cols = Array.from({ length: 16 }, () => pick(r, PAL.log));
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
        px.push(r() < 0.18 ? pick(r, PAL.log) : cols[x]);
      break;
    }
    case 'leaf': {
      px = base(r, PAL.leaf, 0.1).map(c => (r() < 0.12 ? '' : c));
      break;
    }
    case 'coal': case 'iron': case 'gold': case 'diamond': case 'emerald':
      px = sprinkleOre(r, base(r, PAL.stone), name, { coal: 4, iron: 5, gold: 5, diamond: 6, emerald: 6 }[name]); break;
    default: // project gems sit in deepslate
      px = sprinkleOre(r, base(r, PAL.deep, 0.6), name, 6);
  }
  return (cache[name] = px);
}

// ---------- pixel font (5x7, variable width for punctuation) ----------
const G = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['.', '.', '.', '.', '.', '#', '#'],
  ':': ['.', '.', '#', '.', '.', '#', '.'],
  '·': ['.', '.', '.', '#', '.', '.', '.'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '_': ['....', '....', '....', '....', '....', '....', '####'],
  '=': ['...', '...', '###', '...', '###', '...', '...'],
  '+': ['...', '...', '.#.', '###', '.#.', '...', '...'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '(': ['.#', '#.', '#.', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '.#', '.#', '#.'],
  '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '#####', '.#.#.', '.....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####'],
  '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '|': ['#', '#', '#', '#', '#', '#', '#'],
  '▶': ['#....', '##...', '###..', '####.', '###..', '##...', '#....'],
  '▼': ['.......', '#######', '.#####.', '..###..', '...#...', '.......', '.......'],
  '★': ['..#..', '..#..', '#####', '.###.', '.#.#.', '#...#', '.....'],
};

export function glyph(ch) {
  const c = ch.toUpperCase();
  return G[c] || G['?'];
}

// Pixel positions for a string, in font units. Returns {pixels:[[x,y]], width, height:7}
export function textPixels(str, spacing = 1) {
  const pixels = [];
  let x = 0;
  for (const ch of String(str)) {
    const g = glyph(ch);
    for (let y = 0; y < 7; y++)
      for (let i = 0; i < g[y].length; i++) if (g[y][i] === '#') pixels.push([x + i, y]);
    x += g[0].length + spacing;
  }
  return { pixels, width: Math.max(0, x - spacing), height: 7 };
}
export const textWidth = (str, spacing = 1) => textPixels(str, spacing).width;

// ---------- miner sprite (original character, faces right) ----------
// Y helmet, H brim, L lamp, S skin, E eye, M mouth, D shirt, O vest, W stripe, B belt, N pants, K boots
export const MINER_BODY = [
  '...YYYY...',
  '..YYYYYL..',
  '.HHHHHHHH.',
  '..SSSSSS..',
  '..SSSESE..',
  '..SSSSSS..',
  '..SSSSMM..',
  '...SSSS...',
  '.DOOOOOO..',
  '.DOWWWWO..',
  '.DOOOOOO..',
  '.SOOOOOO..',
  '..BBBBBB..',
  '..NNNNNN..',
  '..NN..NN..',
  '..NN..NN..',
  '.KKK..KKK.',
];
// arm + pickaxe, same coordinate grid as the body; pivot at the shoulder
export const MINER_ARM = [
  '.................',
  '.................',
  '.................',
  '...........GG....',
  '.............G...',
  '..............G..',
  '.............T.G.',
  '............T...G',
  '........D..T....G',
  '........D.T......',
  '........DT.......',
  '........S........',
];
export const MINER_PIVOT = [8.5, 8.5];
export const MINER_COLORS = {
  Y: '#f2c230', H: '#c99a1a', L: '#fff7a0', S: '#c68a5a', E: '#2b1d14', M: '#8a4a32',
  D: '#3b4252', O: '#ff7a1a', W: '#e8e8e8', B: '#5a3a1e', N: '#2b3a67', K: '#3a2616',
  G: '#9aa0a6', T: '#8a5a2b',
};

// ---------- item icons (16x16) ----------
export function gemIcon(ore) {
  const [hi, mid, lo] = ORES[ore];
  const m = [
    '................',
    '......LLLL......',
    '....LLHHMMDD....',
    '...LHHMMMMMDD...',
    '..LHMMMMMMMMDD..',
    '..LMMMMMMMMMMD..',
    '..DMMMMMMMMMMD..',
    '...DMMMMMMMMD...',
    '....DMMMMMMD....',
    '.....DMMMMD.....',
    '......DMMD......',
    '.......DD.......',
    '................',
  ];
  const map = { L: '#111111', H: hi, M: mid, D: lo };
  return m.map(row => [...row.padEnd(16, '.')].map(c => (c === '.' ? '' : (c === 'L' ? lo : map[c]))));
}

export const CHEST = [
  '.############.',
  '#wwwwwwwwwwww#',
  '#wWWWWWWWWWWw#',
  '#wWWWWWWWWWWw#',
  '##############',
  '#wWWWWLLWWWWw#',
  '#wWWWWLLWWWWw#',
  '#wWWWWWWWWWWw#',
  '#wWWWWWWWWWWw#',
  '#wwwwwwwwwwww#',
  '.############.',
];
export const CHEST_COLORS = { '#': '#2a1a0c', w: '#8a5a2b', W: '#b07a3c', L: '#c8c8c8' };

export const STAR = [
  '.......#.......',
  '......###......',
  '......###......',
  '.....#####.....',
  '###############',
  '.#############.',
  '...#########...',
  '....#######....',
  '...####.####...',
  '..###.....###..',
  '.##.........##.',
];
export const PICK = [
  '...GGGGGG.......',
  '.GG.....GG......',
  'G........TG.....',
  '........T.G.....',
  '.......T...G....',
  '......T.........',
  '.....T..........',
  '....T...........',
  '...T............',
  '..T.............',
];
export const BOOK = [
  '.RRRRRRRRRR.',
  'RrrrrrrrrrRP',
  'RrRRRRRRrrRP',
  'RrrrrrrrrrRP',
  'RrRRRRRrrrRP',
  'RrrrrrrrrrRP',
  'RrrrrrrrrrRP',
  'RrrrrrrrrrRP',
  'RRRRRRRRRRRP',
  '.PPPPPPPPPPP',
];
export const BOOK_COLORS = { R: '#5a2a1a', r: '#a0442a', P: '#efe6d0' };

// contribution level -> ore
export const LEVEL_ORE = ['stone', 'coal', 'iron', 'gold', 'diamond'];
export const ORE_LABEL = {
  stone: 'Stone', coal: 'Coal ore', iron: 'Iron ore', gold: 'Gold ore', diamond: 'Diamond ore',
  emerald: 'Emerald ore', ruby: 'Ruby ore', sapphire: 'Sapphire ore', amethyst: 'Amethyst ore',
  topaz: 'Topaz ore', jade: 'Jade ore', quartz: 'Quartz ore',
};

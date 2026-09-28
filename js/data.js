'use strict';
// ============================================================
// DataLoader: characters.csv / moves.csv / game_data_fixed_with_image_paths.json
// バランス値はすべてデータファイルから読み込む（コード側で書き換えない）
// ============================================================

const DATA_FILES = {
  characters: 'characters.csv',
  moves: 'moves.csv',
  json: 'game_data_fixed_with_image_paths.json',
  poseDir: 'キャラクター',
};

// 公開用ビルド（web_publish）では js/config.js で画像形式・処理解像度を切り替える
const CFG = Object.assign({ imgExt: null, spriteH: 760, poseManifest: 'poses.json' }, window.GAME_CONFIG || {});
const imgPath = p => CFG.imgExt ? p.replace(/.png$/i, CFG.imgExt) : p;

const DATA = { characters: [], byId: {}, moves: [], stages: [], rules: {} };

// 見た目専用の設定（バランス値ではない）
// facing: 元画像でキャラが向いている方向 / color: エフェクト色
// height: 画面上の描画身長(px) / fx,fy: 顔の位置(元画像比) = ポートレート切り抜き & 体軸
const CHAR_VISUAL = {
  RYUJI:  { facing: 'right', color: '#ff3030', color2: '#ffb0a0', height: 330, fx: 0.51, fy: 0.15 },
  LUNA:   { facing: 'right', color: '#ff2255', color2: '#ffc0d0', height: 330, fx: 0.46, fy: 0.19 },
  JACK:   { facing: 'right', color: '#ffc21a', color2: '#fff0a0', height: 350, fx: 0.58, fy: 0.10 },
  MEILIN: { facing: 'left',  color: '#20d8a0', color2: '#c0fff0', height: 325, fx: 0.50, fy: 0.19 },
  KAI:    { facing: 'left',  color: '#3ee070', color2: '#fff060', height: 330, fx: 0.62, fy: 0.23 },
  AKARI:  { facing: 'left',  color: '#b040ff', color2: '#e8c0ff', height: 300, fx: 0.60, fy: 0.29 },
  VIKTOR: { facing: 'left',  color: '#60c0ff', color2: '#e0f4ff', height: 355, fx: 0.58, fy: 0.10 },
  NOIR:   { facing: 'left',  color: '#3050ff', color2: '#a0b8ff', height: 340, fx: 0.51, fy: 0.11 },
};

const NUM_FIELDS = ['hp', 'attack', 'defense', 'speed', 'range', 'technique', 'difficulty',
  'damage', 'startup_frames', 'active_frames', 'recovery_frames', 'meter_cost'];

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  const head = rows.shift().map(h => h.trim());
  return rows.map(r => {
    const o = {};
    head.forEach((h, i) => {
      const v = (r[i] ?? '').trim();
      o[h] = NUM_FIELDS.includes(h) && v !== '' && !isNaN(+v) ? +v : v;
    });
    return o;
  });
}

// ---- コマンド表記の解析 ("↓↘→ + P" → {seq:[2,3,6], buttons:['P'], air:false}) ----
const ARROW_NUM = { '↓': 2, '↘': 3, '→': 6, '↙': 1, '←': 4, '↑': 8, '↗': 9, '↖': 7 };
function parseCommand(str) {
  let s = str.trim();
  let air = false;
  if (/^air\s/i.test(s)) { air = true; s = s.replace(/^air\s*/i, ''); }
  const parts = s.split('+').map(p => p.trim());
  const seq = [];
  const buttons = [];
  for (const p of parts) {
    for (const ch of p) {
      if (ARROW_NUM[ch]) seq.push(ARROW_NUM[ch]);
      else if (ch === 'P' || ch === 'K') buttons.push(ch);
    }
  }
  return { seq, buttons, air, raw: str };
}

async function fetchText(path) {
  const res = await fetch(encodeURI(path), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} の読み込みに失敗 (${res.status})`);
  return res.text();
}

async function loadGameData() {
  const [chText, mvText, jsText] = await Promise.all([
    fetchText(DATA_FILES.characters), fetchText(DATA_FILES.moves), fetchText(DATA_FILES.json),
  ]);
  const json = JSON.parse(jsText);
  const csvChars = parseCSV(chText);
  const jsonChars = Object.fromEntries(json.characters.map(c => [c.character_id, c]));

  DATA.characters = csvChars.map(c => {
    const j = jsonChars[c.character_id] || {};
    return {
      ...c,
      image_path: j.image_path,
      select_portrait_path: j.select_portrait_path || j.image_path,
      vs_image_path: j.vs_image_path || j.image_path,
      battle_sprite_path: j.battle_sprite_path || j.image_path,
      visual: CHAR_VISUAL[c.character_id],
    };
  });
  DATA.byId = Object.fromEntries(DATA.characters.map(c => [c.character_id, c]));
  DATA.moves = parseCSV(mvText).map(m => ({ ...m, cmd: parseCommand(m.command) }));
  DATA.stages = json.stages;
  DATA.rules = json.game_rules;
  return DATA;
}

// ---- 画像読み込み & 白背景の除去（元画像ファイルをそのまま使用し、実行時に切り抜く） ----
function loadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像が見つかりません: ${path}`));
    img.src = encodeURI(imgPath(path));
  });
}

function processCharacterImage(img, visual) {
  const H = CFG.spriteH;
  const W = Math.round(img.width * H / img.height);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, W, H);
  let bbox = { x0: 0, y0: 0, x1: W, y1: H };
  let cutout = false;
  try {
    const id = cx.getImageData(0, 0, W, H);
    const d = id.data;
    const bg = new Uint8Array(W * H);
    const isBg = i => {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      return mn >= 222 && mx - mn <= 30;
    };
    const stack = [];
    for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
    while (stack.length) {
      const p = stack.pop();
      if (bg[p] || !isBg(p)) continue;
      bg[p] = 1;
      const x = p % W, y = (p / W) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < W - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - W);
      if (y < H - 1) stack.push(p + W);
    }
    let x0 = W, y0 = H, x1 = 0, y1 = 0, sumX = 0, cnt = 0;
    for (let p = 0; p < W * H; p++) {
      if (bg[p]) { d[p * 4 + 3] = 0; continue; }
      const x = p % W, y = (p / W) | 0;
      // 縁のフェザリング（白いフリンジを軽減）
      const edge = (x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W]);
      if (edge) {
        const mn = Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
        const w = Math.max(0, Math.min(1, (mn - 150) / 90));
        d[p * 4 + 3] = Math.round(255 * (1 - w * 0.9));
      }
      // 足元の薄い影(灰色)はbboxに含めない
      const mn = Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
      if (mn < 205) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        sumX += x; cnt++;
      }
    }
    // 足元（下端12%）の中心 = ポーズ画像の立ち位置の基準
    let fSum = 0, fCnt = 0;
    const fy0 = y1 - (y1 - y0) * 0.12;
    for (let y = Math.max(0, Math.floor(fy0)); y <= y1; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (!bg[p] && Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) < 205) { fSum += x; fCnt++; }
      }
    }
    cx.putImageData(id, 0, 0);
    bbox = { x0, y0, x1, y1, cx: cnt ? sumX / cnt : W / 2, footX: fCnt ? fSum / fCnt : W / 2 };
    cutout = true;
  } catch (e) {
    console.warn('背景除去不可（file://で開いている可能性）。start.batから起動してください。', e);
  }
  const sil = (color) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(cv, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    return c;
  };
  const cache = {};
  return {
    canvas: cv, W, H, bbox, cutout,
    // シルエットは使う時に生成（スマホのメモリ節約）
    get white() { return cache.w || (cache.w = sil('#ffffff')); },
    get tint() { return cache.t || (cache.t = sil(visual.color)); },
    get dark() { return cache.d || (cache.d = sil('#000000')); },
    anchorX: visual.fx * W,
    centerX: bbox.cx ?? W / 2,
    footX: bbox.footX ?? W / 2,
    footY: bbox.y1,
    bodyH: bbox.y1 - bbox.y0,
    bodyW: bbox.x1 - bbox.x0,
  };
}

const ASSETS = { chars: {}, stages: {}, stageImgs: {}, poses: {} };

// ---- ポーズ画像（任意）: キャラクター/<ID>/<pose>.png ----
// 全ポーズ画像は「右向き・白背景・全身」で用意する。無いポーズは元画像で代用。
// h: 直立時の身長に対する、そのポーズの見た目の高さ比（down のみ横幅比）
const POSES = {
  stand:  { h: 1.00, label: '直立（登場時）' },
  idle:   { h: 1.00, label: '構え（ファイティングポーズ）' },
  walk:   { h: 0.96, label: '歩き' },
  crouch: { h: 0.66, label: 'しゃがみ' },
  jump:   { h: 0.85, label: 'ジャンプ' },
  punch:  { h: 0.95, label: 'パンチ' },
  kick:   { h: 0.97, label: 'キック' },
  sweep:  { h: 0.50, label: '足払い（しゃがみキック）' },
  special:{ h: 0.95, label: '必殺技' },
  guard:  { h: 0.94, label: 'ガード' },
  hit:    { h: 0.92, label: 'やられ' },
  down:   { w: 1.10, label: 'ダウン（倒れ）' },
  win:    { h: 1.00, label: '勝利' },
};

async function loadPoses(onProgress) {
  let list = null;
  // ローカルサーバーは api/poses、GitHub Pages では poses.json（ビルド時に生成）
  for (const url of ['api/poses', CFG.poseManifest]) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) { list = await res.json(); break; }
    } catch (e) { /* 次を試す */ }
  }
  const jobs = [];
  for (const c of DATA.characters) {
    const id = c.character_id;
    ASSETS.poses[id] = {};
    const names = list ? (list[id] || []) : Object.keys(POSES);
    for (const pose of names) {
      if (!POSES[pose]) continue;
      const path = `${DATA_FILES.poseDir}/${id}/${pose}.png`;
      jobs.push(loadImage(path).then(img => {
        ASSETS.poses[id][pose] = processCharacterImage(img, { ...c.visual, fx: 0.5 });
      }).catch(() => {}));
    }
  }
  await Promise.all(jobs);
}

async function loadAssets(onProgress) {
  const jobs = [];
  let done = 0;
  const total = DATA.characters.length + DATA.stages.length;
  for (const c of DATA.characters) {
    jobs.push(loadImage(c.battle_sprite_path).then(img => {
      ASSETS.chars[c.character_id] = { raw: img, ...processCharacterImage(img, c.visual) };
      onProgress && onProgress(++done / total);
    }));
  }
  for (const s of DATA.stages) {
    jobs.push(loadImage(s.image_path).then(img => {
      ASSETS.stages[s.stage_id] = img;
      onProgress && onProgress(++done / total);
    }));
  }
  await Promise.all(jobs);
  await loadPoses();
}

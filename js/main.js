'use strict';
// ============================================================
// シーン管理：タイトル → モード → キャラ選択 → ステージ選択 → VS → バトル → リザルト
// ============================================================

const GAME_TITLE = 'FIST OF EIGHT';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;

const Settings = { cpuLevel: 3 };
let scene = null;
let loadProgress = 0, loadError = null;
let gframe = 0;

function setScene(s) { scene = s; if (s.enter) s.enter(); }

// ---------------- 描画ヘルパ ----------------
function text(str, x, y, { size = 24, color = '#fff', align = 'left', font = '"Arial Black", Impact, sans-serif', italic = true, stroke = 5, weight = 900, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
  ctx.restore();
}
const jpFont = '"Yu Gothic", "Meiryo", "Hiragino Sans", sans-serif';

function drawStageBg(id, dim = 0.5, ox = 0) {
  const img = ASSETS.stages[id];
  if (!img) { ctx.fillStyle = '#0a0a14'; ctx.fillRect(0, 0, W, H); return; }
  const s = Math.max(W / img.width, H / img.height) * 1.06;
  ctx.drawImage(img, (W - img.width * s) / 2 + ox, (H - img.height * s) / 2, img.width * s, img.height * s);
  ctx.fillStyle = `rgba(0,0,8,${dim})`;
  ctx.fillRect(0, 0, W, H);
}

function drawFullBody(id, cx, footY, height, faceRight, { alpha = 1, silhouette = false, pose = null } = {}) {
  const pa = pose && ASSETS.poses[id] && ASSETS.poses[id][pose];
  const a = pa || ASSETS.chars[id];
  if (!a) return;
  const vis = DATA.byId[id].visual;
  const s = height / a.bodyH;
  const flip = ((pa ? true : vis.facing === 'right') === faceRight) ? 1 : -1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, footY);
  ctx.scale(flip * s, s);
  ctx.drawImage(silhouette ? a.dark : a.canvas, pa ? -a.footX : -a.anchorX, -a.footY);
  ctx.restore();
}

function drawMenu(items, idx, x, y, gap = 58, size = 34) {
  items.forEach((it, i) => {
    const sel = i === idx;
    if (sel) {
      ctx.save();
      const g = ctx.createLinearGradient(x - 40, 0, x + 520, 0);
      g.addColorStop(0, 'rgba(255,40,40,0.85)'); g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 40, y + i * gap - size, 560, size + 16);
      ctx.restore();
    }
    text(it, x, y + i * gap, { size, color: sel ? '#fff' : '#9aa' });
  });
}

// drawMenu と同じ配置でタップ判定
function menuTapIndex(n, x, y, gap = 58, size = 34) {
  for (let i = 0; i < n; i++) if (tappedIn(x - 40, y + i * gap - size, 560, size + 16)) return i;
  return -1;
}
// キャラ選択グリッドの配置
function selectTileRect(k) {
  const cols = 4, tw = 118, th = 118, gap = 10;
  const gx = W / 2 - (cols * tw + (cols - 1) * gap) / 2, gy = 450;
  return { x: gx + (k % cols) * (tw + gap), y: gy + Math.floor(k / cols) * (th + gap), w: tw, h: th };
}
// ステージサムネイルの配置
function stageThumbRect(i) {
  const n = DATA.stages.length + 1, tw = 200, th = 112, gap = 18;
  const x0 = W / 2 - (n * tw + (n - 1) * gap) / 2;
  return { x: x0 + i * (tw + gap), y: 580, w: tw, h: th };
}

function blink(period = 50) { return gframe % period < period * 0.65; }

// ============================================================
const LoadingScene = {
  update() {},
  draw() {
    ctx.fillStyle = '#05050a'; ctx.fillRect(0, 0, W, H);
    text(GAME_TITLE, W / 2, 300, { size: 64, align: 'center', color: '#ff3a3a' });
    if (loadError) {
      text('読み込みエラー', W / 2, 390, { size: 30, align: 'center', font: jpFont, italic: false, color: '#ff8080' });
      const lines = [String(loadError.message || loadError),
        'index.html を直接開くとブラウザの制限でデータ/画像を読み込めません。',
        'フォルダ内の start.bat（または `node server.js`）で起動し、',
        'http://localhost:8080 を開いてください。'];
      lines.forEach((l, i) => text(l, W / 2, 440 + i * 34, { size: 20, align: 'center', font: jpFont, italic: false, weight: 700, stroke: 0, color: '#ddd' }));
      return;
    }
    ctx.fillStyle = '#222'; ctx.fillRect(390, 400, 500, 14);
    ctx.fillStyle = '#ff3a3a'; ctx.fillRect(390, 400, 500 * loadProgress, 14);
    text('LOADING...', W / 2, 460, { size: 24, align: 'center' });
  },
};

// ============================================================
const TitleScene = {
  enter() { this.t = 0; },
  update() {
    this.t++;
    if (this.t > 20 && (menuPressed('ok') || keyPressed(['Enter', 'Space']) || Touch.tap)) { Sfx.confirm(); setScene(ModeScene); }
  },
  draw() {
    drawStageBg('NEON_CROSSING_TOKYO', 0.55, Math.sin(gframe * 0.003) * 20);
    const ids = DATA.characters.map(c => c.character_id);
    // 8人のラインナップ
    const order = [6, 2, 3, 0, 7, 1, 4, 5].map(i => ids[i]).filter(Boolean);
    order.forEach((id, i) => {
      const cx = 120 + i * 148;
      const back = i % 2 === 1;
      drawFullBody(id, cx, back ? 690 : 740, back ? 400 : 420, i < 4, { alpha: back ? 0.75 : 1 });
    });
    const g = ctx.createLinearGradient(0, 120, 0, 330);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 120, W, 210);
    text(GAME_TITLE, W / 2 + 4, 250, { size: 108, align: 'center', color: '#ff2a2a', stroke: 14 });
    text(GAME_TITLE, W / 2, 246, { size: 108, align: 'center', color: '#fff', stroke: 0, alpha: 0.12 });
    text('8 FIGHTERS  ·  5 STAGES  ·  v0.1 PROTOTYPE', W / 2, 296, { size: 20, align: 'center', color: '#ffd23a', stroke: 4 });
    if (blink()) text(Touch.enabled ? 'TAP TO START' : 'PRESS ENTER', W / 2, 600, { size: 40, align: 'center', stroke: 7 });
  },
};

// ============================================================
const ModeScene = {
  enter() { this.idx = this.idx || 0; },
  items() {
    const lv = DATA.rules.cpu_levels.find(l => l.level === Settings.cpuLevel);
    return ['VS CPU', '2P VERSUS', 'TRAINING', `CPU LEVEL  ◀ ${Settings.cpuLevel} ${lv ? lv.name : ''} ▶`, `SOUND  ${Sfx.muted ? 'OFF' : 'ON'}`];
  },
  update() {
    const n = 5;
    if (menuPressed('up')) { this.idx = (this.idx + n - 1) % n; Sfx.cursor(); }
    if (menuPressed('down')) { this.idx = (this.idx + 1) % n; Sfx.cursor(); }
    if (this.idx === 3) {
      if (menuPressed('left')) { Settings.cpuLevel = Math.max(1, Settings.cpuLevel - 1); Sfx.cursor(); }
      if (menuPressed('right')) { Settings.cpuLevel = Math.min(5, Settings.cpuLevel + 1); Sfx.cursor(); }
    }
    if (menuPressed('back')) { Sfx.cancel(); setScene(TitleScene); return; }
    const ti = menuTapIndex(n, 100, 220);
    if (ti >= 0) this.idx = ti;
    if (menuPressed('ok') || ti >= 0) {
      if (this.idx <= 2) {
        Sfx.confirm();
        SelectScene.mode = ['cpu', 'versus', 'training'][this.idx];
        setScene(SelectScene);
      } else if (this.idx === 3) { Settings.cpuLevel = Settings.cpuLevel % 5 + 1; Sfx.cursor(); }
      else if (this.idx === 4) { Sfx.toggleMute(); Sfx.confirm(); }
    }
  },
  draw() {
    drawStageBg('UNDERGROUND_FIGHT_CLUB', 0.65);
    text('SELECT MODE', 80, 110, { size: 54, color: '#ff3a3a', stroke: 8 });
    drawMenu(this.items(), this.idx, 100, 220);
    // 操作説明
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(700, 150, 520, 520);
    ctx.strokeStyle = '#ff3a3a'; ctx.lineWidth = 2; ctx.strokeRect(700, 150, 520, 520);
    text('操作方法', 725, 190, { size: 26, font: jpFont, italic: false });
    const L = [
      ['', 'P1', 'P2'],
      ['移動', 'W A S D', '← ↑ → ↓'],
      ['パンチ (P)', 'J', 'テンキー1 / ,'],
      ['キック (K)', 'K', 'テンキー2 / .'],
      ['P+K (投げ)', 'L', 'テンキー3 / /'],
      ['必殺技(ワンボタン)', 'U', 'テンキー4'],
      ['超必殺技', 'I', 'テンキー5'],
      ['ポーズ', 'ESC / ENTER', ''],
    ];
    L.forEach((r, i) => {
      const y = 232 + i * 32;
      text(r[0], 725, y, { size: 18, font: jpFont, italic: false, weight: 700, stroke: 3, color: '#ffd23a' });
      text(r[1], 890, y, { size: 18, font: jpFont, italic: false, weight: 700, stroke: 3 });
      text(r[2], 1040, y, { size: 18, font: jpFont, italic: false, weight: 700, stroke: 3 });
    });
    const tips = ['ガード：相手と逆方向を入力（しゃがみガードは↙）', 'ダッシュ：→→ / バックステップ：←←',
      'コマンド表記は右向き基準（↓↘→ + P など）', '1人用モードは矢印キー側でもP1を操作可',
      'ワンボタン必殺：U / ↓+U / ←+U / →+U で技が変わる',
      'スマホ：画面の方向パッドとボタンで操作（横向き）'];
    tips.forEach((t, i) => text(t, 725, 510 + i * 26, { size: 15, font: jpFont, italic: false, weight: 700, stroke: 3, color: '#ddd' }));
    text('ENTER / J：決定　　ESC / K：戻る', 80, 680, { size: 18, font: jpFont, italic: false, weight: 700, stroke: 3, color: '#ccc' });
  },
};

// ============================================================
const SelectScene = {
  mode: 'cpu',
  enter() {
    this.cursor = this.cursor || [0, 1];
    this.locked = [false, false];
    this.step = 0; // 1人用: 0=自キャラ, 1=相手
    this.t = 0; this.doneT = 0;
  },
  single() { return this.mode !== 'versus'; },
  moveCursor(i, player) {
    const c = this.cursor;
    const n = DATA.characters.length, cols = 4;
    let moved = false;
    if (menuPressed('left', player)) { c[i] = (c[i] % cols === 0) ? c[i] + cols - 1 : c[i] - 1; moved = true; }
    if (menuPressed('right', player)) { c[i] = (c[i] % cols === cols - 1) ? c[i] - cols + 1 : c[i] + 1; moved = true; }
    if (menuPressed('up', player) || menuPressed('down', player)) { c[i] = (c[i] + cols) % n; moved = true; }
    c[i] = Math.min(n - 1, c[i]);
    if (moved) Sfx.cursor();
  },
  update() {
    this.t++;
    if (this.locked[0] && this.locked[1]) {
      if (++this.doneT > 35) {
        StageScene.sel = { p1: DATA.characters[this.cursor[0]].character_id, p2: DATA.characters[this.cursor[1]].character_id, mode: this.mode };
        setScene(StageScene);
      }
      return;
    }
    // タップ選択：未選択ならカーソル移動、同じキャラをもう一度タップで決定
    let tapOk = false, tapPlayer = !this.locked[0] ? 0 : 1;
    if (this.single()) tapPlayer = this.step;
    for (let k = 0; k < DATA.characters.length; k++) {
      const r = selectTileRect(k);
      if (tappedIn(r.x, r.y, r.w, r.h)) {
        if (this.cursor[tapPlayer] === k) tapOk = true;
        else { this.cursor[tapPlayer] = k; Sfx.cursor(); }
      }
    }
    if (this.single()) {
      const i = this.step;
      this.moveCursor(i);
      if (menuPressed('ok') || tapOk) { this.locked[i] = true; this.step = 1; Sfx.confirm(); }
      else if (menuPressed('back')) {
        Sfx.cancel();
        if (this.step === 1) { this.step = 0; this.locked[0] = false; }
        else setScene(ModeScene);
      }
    } else {
      for (let i = 0; i < 2; i++) {
        if (!this.locked[i]) {
          this.moveCursor(i, i);
          if (menuPressed('ok', i) || (tapOk && tapPlayer === i)) { this.locked[i] = true; Sfx.confirm(); }
          else if (menuPressed('back', i) && i === 0 && !this.locked[1]) { Sfx.cancel(); setScene(ModeScene); return; }
        } else if (menuPressed('back', i)) { this.locked[i] = false; Sfx.cancel(); }
      }
    }
  },
  draw() {
    drawStageBg('SKYLINE_ROOFTOP', 0.7);
    text('CHARACTER SELECT', W / 2, 62, { size: 44, align: 'center', color: '#ff3a3a', stroke: 7 });
    const subtitle = this.single()
      ? (this.step === 0 ? 'あなたのキャラクターを選択' : (this.mode === 'training' ? 'トレーニング相手を選択' : '対戦相手（CPU）を選択'))
      : '両プレイヤーがキャラクターを選択';
    text(subtitle, W / 2, 96, { size: 20, align: 'center', font: jpFont, italic: false, weight: 700, stroke: 4, color: '#ffd23a' });

    // 左右の大きなプレビュー
    for (let i = 0; i < 2; i++) {
      const show = this.single() ? (i === 0 || this.step === 1 || this.locked[1]) : true;
      if (!show) continue;
      const c = DATA.characters[this.cursor[i]];
      const left = i === 0;
      const cx = left ? 190 : W - 190;
      ctx.save();
      const g = ctx.createRadialGradient(cx, 420, 20, cx, 420, 280);
      g.addColorStop(0, c.visual.color + '66'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - 300, 120, 600, 600);
      ctx.restore();
      drawFullBody(c.character_id, cx, 690, 520, left, {});
      // 情報パネル
      const px = left ? 360 : W - 360 - 250, py = 130;
      ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(px, py, 250, 300);
      ctx.strokeStyle = i === 0 ? '#ff3a3a' : '#3a8aff'; ctx.lineWidth = 2; ctx.strokeRect(px, py, 250, 300);
      text(c.display_name, px + 12, py + 32, { size: 20 });
      text(`${c.archetype}`, px + 12, py + 56, { size: 14, color: c.visual.color2, stroke: 3 });
      text(`${c.country}  ·  HP ${c.hp}`, px + 12, py + 76, { size: 13, italic: false, weight: 700, stroke: 3, color: '#ccc' });
      const stats = [['ATK', c.attack], ['DEF', c.defense], ['SPD', c.speed], ['RNG', c.range], ['TEC', c.technique]];
      stats.forEach(([k, v], j) => {
        const y = py + 100 + j * 22;
        text(k, px + 12, y + 12, { size: 13, stroke: 3, italic: false });
        ctx.fillStyle = '#222'; ctx.fillRect(px + 60, y + 2, 170, 11);
        ctx.fillStyle = c.visual.color; ctx.fillRect(px + 60, y + 2, 17 * v, 11);
      });
      text('DIFFICULTY ' + '★'.repeat(c.difficulty) + '☆'.repeat(5 - c.difficulty), px + 12, py + 226, { size: 14, stroke: 3, color: '#ffd23a', italic: false });
      text(`METER: ${c.meter_type}`, px + 12, py + 248, { size: 13, stroke: 3, italic: false, color: '#80f0ff' });
      wrapText(c.passive, px + 12, py + 268, 228, 15, { size: 11, color: '#ddd' });
      if (this.locked[i]) text('READY!', cx, 660, { size: 44, align: 'center', color: '#ffd23a', stroke: 7 });
    }

    // グリッド
    const cols = 4, tw = 118, th = 118, gap = 10;
    const gx = W / 2 - (cols * tw + (cols - 1) * gap) / 2, gy = 450;
    DATA.characters.forEach((c, k) => {
      const x = gx + (k % cols) * (tw + gap), y = gy + Math.floor(k / cols) * (th + gap);
      const g = ctx.createLinearGradient(0, y, 0, y + th);
      g.addColorStop(0, '#1a1a28'); g.addColorStop(1, c.visual.color + '88');
      ctx.fillStyle = g; ctx.fillRect(x, y, tw, th);
      drawPortrait(ctx, c.character_id, x, y, tw, th, false);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, y + th - 22, tw, 22);
      text(c.character_id, x + tw / 2, y + th - 5, { size: 14, align: 'center', stroke: 0 });
      ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.strokeRect(x, y, tw, th);
    });
    for (let i = 0; i < 2; i++) {
      const active = this.single() ? (i <= this.step || this.locked[i]) : true;
      if (!active) continue;
      const k = this.cursor[i];
      const x = gx + (k % cols) * (tw + gap), y = gy + Math.floor(k / cols) * (th + gap);
      ctx.save();
      ctx.lineWidth = 5;
      ctx.strokeStyle = i === 0 ? '#ff3a3a' : '#3a8aff';
      if (!this.locked[i] && !blink(20)) ctx.globalAlpha = 0.5;
      const inset = i === 0 ? 0 : 6;
      ctx.strokeRect(x - 3 + inset, y - 3 + inset, tw + 6 - inset * 2, th + 6 - inset * 2);
      text(i === 0 ? '1P' : (this.single() ? 'CPU' : '2P'), x + (i === 0 ? 6 : tw - 6), y + 20, { size: 16, align: i === 0 ? 'left' : 'right', color: i === 0 ? '#ff6a6a' : '#6aaaff', stroke: 4 });
      ctx.restore();
    }
  },
};

function wrapText(str, x, y, maxW, lh, opt) {
  ctx.save();
  ctx.font = `700 ${opt.size}px ${jpFont}`;
  const words = String(str).split(' ');
  let line = '', yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      text(line, x, yy, { ...opt, italic: false, weight: 700, stroke: 0, font: jpFont });
      line = w; yy += lh;
    } else line = test;
  }
  if (line) text(line, x, yy, { ...opt, italic: false, weight: 700, stroke: 0, font: jpFont });
  ctx.restore();
}

// ============================================================
const StageScene = {
  enter() { this.idx = this.idx || 0; },
  update() {
    const n = DATA.stages.length + 1; // +RANDOM
    if (menuPressed('left') || menuPressed('up')) { this.idx = (this.idx + n - 1) % n; Sfx.cursor(); }
    if (menuPressed('right') || menuPressed('down')) { this.idx = (this.idx + 1) % n; Sfx.cursor(); }
    if (menuPressed('back')) { Sfx.cancel(); setScene(SelectScene); return; }
    let tapOk = false;
    for (let i = 0; i < n; i++) {
      const r = stageThumbRect(i);
      if (tappedIn(r.x, r.y, r.w, r.h)) { if (this.idx === i) tapOk = true; else { this.idx = i; Sfx.cursor(); } }
    }
    if (menuPressed('ok') || tapOk) {
      Sfx.confirm();
      const st = this.idx < DATA.stages.length ? DATA.stages[this.idx] : pick(DATA.stages);
      VsScene.opts = { ...this.sel, stage: st.stage_id, cpuLevel: Settings.cpuLevel };
      setScene(VsScene);
    }
  },
  draw() {
    const isRandom = this.idx >= DATA.stages.length;
    const cur = isRandom ? DATA.stages[Math.floor(gframe / 12) % DATA.stages.length] : DATA.stages[this.idx];
    drawStageBg(cur.stage_id, 0.15);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(0.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    text('STAGE SELECT', W / 2, 70, { size: 48, align: 'center', color: '#ff3a3a', stroke: 8 });
    text(isRandom ? 'RANDOM' : cur.name, W / 2, 130, { size: 36, align: 'center', stroke: 7 });
    const n = DATA.stages.length + 1, tw = 200, th = 112, gap = 18;
    const x0 = W / 2 - (n * tw + (n - 1) * gap) / 2, y = 580;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (tw + gap);
      if (i < DATA.stages.length) {
        const img = ASSETS.stages[DATA.stages[i].stage_id];
        ctx.drawImage(img, x, y, tw, th);
      } else {
        ctx.fillStyle = '#111'; ctx.fillRect(x, y, tw, th);
        text('?', x + tw / 2, y + 80, { size: 64, align: 'center', color: '#ffd23a' });
      }
      if (i !== this.idx) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, y, tw, th); }
      ctx.strokeStyle = i === this.idx ? '#ffd23a' : '#666'; ctx.lineWidth = i === this.idx ? 5 : 2;
      ctx.strokeRect(x, y, tw, th);
    }
  },
};

// ============================================================
const VsScene = {
  enter() { this.t = 0; Sfx.announce('Versus'); },
  update() {
    this.t++;
    if (this.t > 200 || (this.t > 40 && (menuPressed('ok') || Touch.tap))) {
      BattleScene.start(this.opts);
    }
  },
  draw() {
    const o = this.opts;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const p = Math.min(1, this.t / 25);
    const e = 1 - Math.pow(1 - p, 3);
    const c1 = DATA.byId[o.p1], c2 = DATA.byId[o.p2];
    // 背景を斜めに分割
    ctx.save();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(700, 0); ctx.lineTo(580, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = c1.visual.color; ctx.globalAlpha = 0.55; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.moveTo(700, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(580, H); ctx.closePath();
    ctx.fillStyle = c2.visual.color; ctx.globalAlpha = 0.55; ctx.fill();
    ctx.restore();
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      const y = (i * 53 + this.t * 14) % H;
      ctx.fillRect(0, y, W, 2);
    }
    drawFullBody(o.p1, -300 + e * 620, 780, 700, true);
    drawFullBody(o.p2, W + 300 - e * 620, 780, 700, false);
    const vsScale = 1 + Math.max(0, 1 - (this.t - 20) / 12) * 2;
    if (this.t > 20) {
      ctx.save(); ctx.translate(W / 2, 380); ctx.scale(vsScale, vsScale);
      text('VS', 0, 40, { size: 140, align: 'center', color: '#ffd23a', stroke: 14 });
      ctx.restore();
    }
    text(c1.display_name, 40 - (1 - e) * 400, 640, { size: 44, stroke: 8 });
    text(c1.archetype, 44 - (1 - e) * 400, 680, { size: 20, color: c1.visual.color2, stroke: 4 });
    text(c2.display_name, W - 40 + (1 - e) * 400, 110, { size: 44, align: 'right', stroke: 8 });
    text(c2.archetype, W - 44 + (1 - e) * 400, 146, { size: 20, align: 'right', color: c2.visual.color2, stroke: 4 });
    const st = DATA.stages.find(s => s.stage_id === o.stage);
    text(`STAGE: ${st.name}`, W / 2, 700, { size: 18, align: 'center', stroke: 4, color: '#ddd' });
  },
};

// ============================================================
const BattleScene = {
  start(opts) {
    this.opts = opts;
    this.battle = new Battle(opts);
    this.paused = false; this.pauseIdx = 0; this.moveList = false; this.mlSide = 0;
    setScene(this);
  },
  pauseItems() {
    const it = ['RESUME', 'MOVE LIST'];
    if (this.battle.training) it.push(`DUMMY: ${this.battle.dummyMode}`);
    it.push('CHARACTER SELECT', 'TITLE');
    return it;
  },
  update() {
    const b = this.battle;
    if (this.moveList) {
      if (menuPressed('left') || menuPressed('right')) { this.mlSide = 1 - this.mlSide; Sfx.cursor(); }
      if (menuPressed('back') || menuPressed('ok') || keyPressed(['Enter']) || Touch.tap) { this.moveList = false; Sfx.cancel(); }
      return;
    }
    if (this.paused) {
      const items = this.pauseItems();
      if (menuPressed('up')) { this.pauseIdx = (this.pauseIdx + items.length - 1) % items.length; Sfx.cursor(); }
      if (menuPressed('down')) { this.pauseIdx = (this.pauseIdx + 1) % items.length; Sfx.cursor(); }
      if (keyPressed(['Escape', 'KeyP'])) { this.paused = false; return; }
      const ti = menuTapIndex(items.length, 480, 290, 56, 30);
      if (ti >= 0) this.pauseIdx = ti;
      if (menuPressed('ok') || ti >= 0) {
        const it = items[this.pauseIdx];
        Sfx.confirm();
        if (it === 'RESUME') this.paused = false;
        else if (it === 'MOVE LIST') { this.moveList = true; this.mlSide = 0; }
        else if (it.startsWith('DUMMY')) {
          const modes = ['STAND', 'CROUCH', 'BLOCK', 'CPU'];
          b.dummyMode = modes[(modes.indexOf(b.dummyMode) + 1) % modes.length];
        }
        else if (it === 'CHARACTER SELECT') { SelectScene.mode = this.opts.mode; setScene(SelectScene); }
        else if (it === 'TITLE') setScene(TitleScene);
      }
      return;
    }
    if (pausePressed() && b.phase !== 'matchEnd') { this.paused = true; this.pauseIdx = 0; Sfx.cursor(); return; }
    b.update();
    if (b.phase === 'matchEnd') { ResultScene.battle = b; ResultScene.opts = this.opts; setScene(ResultScene); }
  },
  draw() {
    this.battle.draw(ctx);
    if (this.paused && !this.moveList) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H);
      text('PAUSE', W / 2, 200, { size: 64, align: 'center', color: '#ff3a3a', stroke: 9 });
      drawMenu(this.pauseItems(), this.pauseIdx, 480, 290, 56, 30);
    }
    if (this.moveList) this.drawMoveList();
  },
  drawMoveList() {
    const f = this.battle.fighters[this.mlSide];
    ctx.fillStyle = 'rgba(0,0,10,0.9)'; ctx.fillRect(0, 0, W, H);
    drawFullBody(f.id, 1120, 740, 560, false, { alpha: 0.35 });
    text(`MOVE LIST — ${f.def.display_name}`, 50, 64, { size: 34, color: '#ff3a3a', stroke: 6 });
    text(`${f.def.archetype} · HP ${f.def.hp} · PASSIVE: ${f.def.passive}`, 52, 96, { size: 14, font: jpFont, italic: false, weight: 700, stroke: 3, color: '#ccc' });
    const cols = [50, 450, 660, 740, 950, 1040];
    const heads = ['技名', 'コマンド', 'DMG', '発生/持続/硬直', 'ゲージ', '特性'];
    heads.forEach((h, i) => text(h, cols[i], 140, { size: 15, font: jpFont, italic: false, weight: 700, stroke: 3, color: '#ffd23a' }));
    const rows = DATA.moves.filter(m => m.character_id === f.id);
    rows.forEach((m, r) => {
      const y = 180 + r * 42;
      ctx.fillStyle = r % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(40, y - 26, 1200, 38);
      const o = { size: 17, font: jpFont, italic: false, weight: 700, stroke: 3 };
      text(m.move_name, cols[0], y, { ...o, color: m.category === 'Super' ? '#ffd23a' : '#fff' });
      const fm = f.specials.find(s => s.name === m.move_name);
      text(m.command, cols[1], y, o);
      if (fm) text(f.quickLabel(fm), cols[1] + 150, y, { ...o, size: 13, color: '#ffb0c0' });
      text(String(m.damage), cols[2], y, o);
      text(`${m.startup_frames} / ${m.active_frames} / ${m.recovery_frames}`, cols[3], y, o);
      text(m.meter_cost ? String(m.meter_cost) : '-', cols[4], y, o);
      text(m.property, cols[5], y, { ...o, size: 14, color: '#9ff' });
    });
    const ny = 180 + rows.length * 42 + 30;
    text('通常技: 立ちP / 立ちK / しゃがみP / しゃがみK(足払い) / ジャンプP・K / 投げ(近距離でP+K)', 50, ny, { size: 15, font: jpFont, italic: false, weight: 700, stroke: 3, color: '#ccc' });
    text('通常技は必殺技でキャンセル可 / 必殺技は超必殺技でキャンセル可', 50, ny + 26, { size: 15, font: jpFont, italic: false, weight: 700, stroke: 3, color: '#ccc' });
    text('◀ ▶ でP1/P2切替　ESC / K で戻る', 50, 690, { size: 16, font: jpFont, italic: false, weight: 700, stroke: 3, color: '#aaa' });
  },
};

// ============================================================
const ResultScene = {
  enter() { this.idx = 0; this.t = 0; },
  update() {
    this.t++;
    if (this.t < 30) return;
    if (menuPressed('up')) { this.idx = (this.idx + 2) % 3; Sfx.cursor(); }
    if (menuPressed('down')) { this.idx = (this.idx + 1) % 3; Sfx.cursor(); }
    const ti = menuTapIndex(3, 760, 420, 60, 32);
    if (ti >= 0) this.idx = ti;
    if (menuPressed('ok') || ti >= 0) {
      Sfx.confirm();
      if (this.idx === 0) BattleScene.start(this.opts);
      else if (this.idx === 1) { SelectScene.mode = this.opts.mode; setScene(SelectScene); }
      else setScene(TitleScene);
    }
  },
  draw() {
    const b = this.battle, w = b.matchWinner;
    drawStageBg(this.opts.stage, 0.6);
    if (w >= 0) {
      const f = b.fighters[w];
      const g = ctx.createRadialGradient(360, 400, 30, 360, 400, 380);
      g.addColorStop(0, f.vis.color + '88'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 800, H);
      drawFullBody(f.id, 360, 760, 680, true, { pose: 'win' });
      let title = `${f.def.display_name} WINS`;
      if (this.opts.mode === 'cpu') title = w === 0 ? 'YOU WIN!' : 'YOU LOSE...';
      else if (this.opts.mode === 'versus') title = `${w === 0 ? '1P' : '2P'} WINS!`;
      text(title, 900, 180, { size: 64, align: 'center', color: w === 0 || this.opts.mode === 'versus' ? '#ffd23a' : '#ff5050', stroke: 9 });
      text(f.def.display_name, 900, 240, { size: 30, align: 'center', stroke: 6 });
      text(`ROUNDS ${b.wins[0]} - ${b.wins[1]}`, 900, 290, { size: 24, align: 'center', stroke: 5, color: '#ccc' });
    } else {
      text('DRAW GAME', W / 2, 200, { size: 72, align: 'center', stroke: 9 });
    }
    drawMenu(['REMATCH', 'CHARACTER SELECT', 'TITLE'], this.idx, 760, 420, 60, 32);
  },
};

// ============================================================
// メインループ（60FPS固定ステップ）
// ============================================================
function resize() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = `${W * s}px`;
  canvas.style.height = `${H * s}px`;
}
addEventListener('resize', resize);
resize();

let last = performance.now(), acc = 0;
const STEP = 1000 / 60;
function loop(now) {
  acc += Math.min(200, now - last);
  last = now;
  while (acc >= STEP) {
    pollPads();
    if (keyPressed(['KeyM'])) Sfx.toggleMute();
    if (keyPressed(['KeyF'])) { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }
    Touch.battleMode = scene === BattleScene && !BattleScene.paused && !BattleScene.moveList;
    Touch.showBack = scene === ModeScene || scene === SelectScene || scene === StageScene || (scene === BattleScene && BattleScene.moveList);
    scene.update();
    gframe++;
    endInputFrame();
    acc -= STEP;
  }
  scene.draw();
  drawTouchControls(ctx);
  requestAnimationFrame(loop);
}

setupTouch(canvas);
setScene(LoadingScene);
requestAnimationFrame(loop);

(async () => {
  try {
    await loadGameData();
    await loadAssets(p => { loadProgress = p; });
    setScene(TitleScene);
  } catch (e) {
    console.error(e);
    loadError = e;
  }
})();

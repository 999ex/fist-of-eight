'use strict';
// ============================================================
// InputBuffer: キーボード / ゲームパッド / タッチ（スマホ）
// ============================================================

const Keys = { down: new Set(), pressed: new Set() };
const PREVENT = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Tab'];

addEventListener('keydown', e => {
  if (!Keys.down.has(e.code)) Keys.pressed.add(e.code);
  Keys.down.add(e.code);
  if (PREVENT.includes(e.code)) e.preventDefault();
  if (typeof Sfx !== 'undefined') Sfx.unlock();
});
addEventListener('keyup', e => Keys.down.delete(e.code));
addEventListener('blur', () => Keys.down.clear());

// SP = ワンボタン必殺技（方向との組み合わせ）/ SA = 超必殺技
const BINDINGS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    P: ['KeyJ'], K: ['KeyK'], PK: ['KeyL'], SP: ['KeyU'], SA: ['KeyI'],
    ok: ['KeyJ', 'Enter', 'Space'], back: ['KeyK', 'Escape', 'Backspace'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    P: ['Numpad1', 'Comma'], K: ['Numpad2', 'Period'], PK: ['Numpad3', 'Slash'], SP: ['Numpad4'], SA: ['Numpad5'],
    ok: ['Numpad1', 'Comma', 'NumpadEnter'], back: ['Numpad2', 'Period'] },
];

const Pads = { prev: [{}, {}], cur: [{}, {}] };
function pollPads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (let i = 0; i < 2; i++) {
    Pads.prev[i] = Pads.cur[i];
    const p = pads[i];
    if (!p) { Pads.cur[i] = {}; continue; }
    const b = n => p.buttons[n] && p.buttons[n].pressed;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    Pads.cur[i] = {
      up: b(12) || ay < -0.5, down: b(13) || ay > 0.5, left: b(14) || ax < -0.5, right: b(15) || ax > 0.5,
      P: b(2) || b(3), K: b(0) || b(1), PK: b(5), SP: b(4), SA: b(6) || b(7), start: b(9),
      ok: b(0), back: b(1),
    };
  }
  pollTouch();
}
const padHeld = (i, k) => !!Pads.cur[i][k];
const padPressed = (i, k) => !!Pads.cur[i][k] && !Pads.prev[i][k];

const keyHeld = codes => codes.some(c => Keys.down.has(c));
const keyPressed = codes => codes.some(c => Keys.pressed.has(c));

// ------------------------------------------------------------
// タッチ操作（画面左下：方向パッド / 右下：ボタン）
// 座標はすべてキャンバス座標(1280x720)
// ------------------------------------------------------------
const TOUCH_LAYOUT = {
  pad: { x: 175, y: 545, r: 115 },
  buttons: [
    { id: 'P',  label: 'P',     menu: '決定', x: 985,  y: 615, r: 56 },
    { id: 'K',  label: 'K',     menu: '戻る', x: 1135, y: 560, r: 56 },
    { id: 'SP', label: '必殺',  x: 985,  y: 480, r: 48, battle: true },
    { id: 'PK', label: '投げ',  x: 1135, y: 420, r: 44, battle: true },
    { id: 'SA', label: '超必殺', x: 850, y: 640, r: 44, battle: true },
  ],
  pause: { x1: 590, y1: 10, x2: 690, y2: 100 },
  back: { x: 16, y: 14, w: 150, h: 52 },
};

const Touch = {
  enabled: false, battleMode: false, showBack: false,
  ptr: new Map(),          // pointerId -> 'pad' | ボタンid | 'tap'
  padPos: null, dir: 5, prevDir: 5, dirJust: 0,
  just: new Set(), justQueue: new Set(),
  tap: null, tapQueue: null, pauseQueue: false, pause: false,
};

function toCanvasPoint(cv, e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * 1280 / r.width, y: (e.clientY - r.top) * 720 / r.height };
}

function touchHit(pt) {
  const L = TOUCH_LAYOUT;
  if (Math.hypot(pt.x - L.pad.x, pt.y - L.pad.y) < L.pad.r * 1.55) return 'pad';
  for (const b of L.buttons) {
    if (b.battle && !Touch.battleMode) continue;
    if (Math.hypot(pt.x - b.x, pt.y - b.y) < b.r * 1.2) return b.id;
  }
  return null;
}

function padDirFrom(pt) {
  const dx = pt.x - TOUCH_LAYOUT.pad.x, dy = pt.y - TOUCH_LAYOUT.pad.y;
  const d = Math.hypot(dx, dy);
  if (d < 24) return 5;
  const x = Math.abs(dx) > d * 0.38 ? Math.sign(dx) : 0;
  const y = Math.abs(dy) > d * 0.38 ? -Math.sign(dy) : 0;
  return 5 + x + y * 3;
}

function setupTouch(cv) {
  const onDown = e => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    Touch.enabled = true;
    if (typeof Sfx !== 'undefined') Sfx.unlock();
    tryFullscreenLandscape();
    const pt = toCanvasPoint(cv, e);
    const L = TOUCH_LAYOUT.pause;
    if (Touch.battleMode && pt.x > L.x1 && pt.x < L.x2 && pt.y > L.y1 && pt.y < L.y2) { Touch.pauseQueue = true; return; }
    if (!Touch.battleMode) {
      // メニュー画面：タップで直接選択（左上は「戻る」）
      const B = TOUCH_LAYOUT.back;
      if (Touch.showBack && pt.x >= B.x && pt.x <= B.x + B.w && pt.y >= B.y && pt.y <= B.y + B.h) Touch.justQueue.add('K');
      else Touch.tapQueue = pt;
      return;
    }
    const hit = touchHit(pt);
    if (hit === 'pad') { Touch.ptr.set(e.pointerId, 'pad'); Touch.padPos = pt; }
    else if (hit) { Touch.ptr.set(e.pointerId, hit); Touch.justQueue.add(hit); }
    else { Touch.ptr.set(e.pointerId, 'tap'); Touch.tapQueue = pt; }
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  const onMove = e => {
    if (Touch.ptr.get(e.pointerId) === 'pad') { e.preventDefault(); Touch.padPos = toCanvasPoint(cv, e); }
  };
  const onUp = e => {
    const role = Touch.ptr.get(e.pointerId);
    if (role === 'pad') Touch.padPos = null;
    Touch.ptr.delete(e.pointerId);
  };
  cv.addEventListener('pointerdown', onDown, { passive: false });
  cv.addEventListener('pointermove', onMove, { passive: false });
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) Touch.enabled = true;
}

let triedFs = false;
function tryFullscreenLandscape() {
  if (triedFs) return;
  triedFs = true;
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen() : null;
    if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  } catch (e) { /* 非対応（iPhoneなど） */ }
}

function pollTouch() {
  Touch.prevDir = Touch.dir;
  Touch.dir = Touch.padPos ? padDirFrom(Touch.padPos) : 5;
  Touch.dirJust = Touch.dir !== Touch.prevDir && Touch.dir !== 5 ? Touch.dir : 0;
  Touch.just = Touch.justQueue; Touch.justQueue = new Set();
  Touch.tap = Touch.tapQueue; Touch.tapQueue = null;
  Touch.pause = Touch.pauseQueue; Touch.pauseQueue = false;
}
const touchHeld = id => [...Touch.ptr.values()].includes(id);

function readPlayer(i) {
  const b = BINDINGS[i];
  const h = k => keyHeld(b[k]) || padHeld(i, k);
  const p = k => keyPressed(b[k]) || padPressed(i, k);
  const pk = p('PK');
  const inp = {
    up: h('up'), down: h('down'), left: h('left'), right: h('right'),
    P: h('P') || h('PK'), K: h('K') || h('PK'),
    Pp: p('P') || pk, Kp: p('K') || pk, SPp: p('SP'), SAp: p('SA'),
  };
  if (i === 0 && Touch.enabled) {
    const d = Touch.dir;
    inp.up ||= d >= 7; inp.down ||= d <= 3; inp.left ||= d % 3 === 1; inp.right ||= d % 3 === 0;
    const tpk = Touch.just.has('PK');
    inp.P ||= touchHeld('P') || touchHeld('PK');
    inp.K ||= touchHeld('K') || touchHeld('PK');
    inp.Pp ||= Touch.just.has('P') || tpk;
    inp.Kp ||= Touch.just.has('K') || tpk;
    inp.SPp ||= Touch.just.has('SP');
    inp.SAp ||= Touch.just.has('SA');
  }
  return inp;
}

// メニュー用（プレイヤー指定 or 両方）
function menuPressed(action, player) {
  const players = player === undefined ? [0, 1] : [player];
  for (const i of players) {
    if (keyPressed(BINDINGS[i][action]) || padPressed(i, action)) return true;
  }
  if (player === undefined || player === 0) {
    if (action === 'ok' && (padPressed(0, 'start'))) return true;
    const d = Touch.dirJust;
    if (d) {
      if (action === 'up' && d >= 7) return true;
      if (action === 'down' && d <= 3) return true;
      if (action === 'left' && d % 3 === 1) return true;
      if (action === 'right' && d % 3 === 0) return true;
    }
    if (action === 'ok' && (Touch.just.has('P') || Touch.just.has('SP'))) return true;
    if (action === 'back' && Touch.just.has('K')) return true;
  }
  return false;
}
const pausePressed = () => keyPressed(['Escape', 'Enter', 'KeyP']) || padPressed(0, 'start') || padPressed(1, 'start') || Touch.pause;

// 画面タップ位置（メニュー項目・キャラ・ステージの直接選択用）
function tappedIn(x, y, w, h) {
  const t = Touch.tap;
  return !!t && t.x >= x && t.x <= x + w && t.y >= y && t.y <= y + h;
}

function endInputFrame() { Keys.pressed.clear(); }

// 方向 → テンキー表記（絶対）
function dirOf(inp) {
  const x = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const y = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
  return 5 + x + y * 3;
}

// タッチUIの描画
function drawTouchControls(ctx) {
  if (!Touch.enabled) return;
  const L = TOUCH_LAYOUT;
  ctx.save();
  if (!Touch.battleMode) {
    if (Touch.showBack) {
      const B = L.back;
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#000';
      ctx.fillRect(B.x, B.y, B.w, B.h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(B.x, B.y, B.w, B.h);
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
      ctx.font = '900 22px "Yu Gothic", "Hiragino Sans", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('◀ 戻る', B.x + B.w / 2, B.y + B.h / 2 + 1);
    }
    ctx.restore();
    return;
  }
  // 方向パッド
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(L.pad.x, L.pad.y, L.pad.r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(L.pad.x, L.pad.y, L.pad.r, 0, Math.PI * 2); ctx.stroke();
  // 8方向の目印
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const x = L.pad.x + Math.cos(a) * L.pad.r * 0.78, y = L.pad.y + Math.sin(a) * L.pad.r * 0.78;
    ctx.beginPath(); ctx.arc(x, y, k % 2 ? 4 : 7, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  }
  const d = Touch.dir;
  const kx = ((d - 1) % 3) - 1, ky = -(Math.floor((d - 1) / 3) - 1);
  const n = Math.hypot(kx, ky) || 1;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#ff3a3a';
  ctx.beginPath(); ctx.arc(L.pad.x + kx / n * L.pad.r * 0.55, L.pad.y + ky / n * L.pad.r * 0.55, 42, 0, Math.PI * 2); ctx.fill();
  // ボタン
  for (const b of L.buttons) {
    if (b.battle && !Touch.battleMode) continue;
    const held = touchHeld(b.id);
    ctx.globalAlpha = held ? 0.85 : 0.45;
    ctx.fillStyle = b.id === 'SA' ? '#c89a00' : b.id === 'SP' ? '#b01a3a' : '#222';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#fff';
    const label = Touch.battleMode ? b.label : (b.menu || b.label);
    ctx.font = `900 ${label.length > 2 ? 18 : label.length > 1 ? 22 : 30}px "Yu Gothic", "Hiragino Sans", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x, b.y + 1);
  }
  if (Touch.battleMode) {
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('タップでポーズ', 640, 96);
  }
  ctx.restore();
}

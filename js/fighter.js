'use strict';
// ============================================================
// MoveDefinition 構築 / CharacterController / MoveExecutor
// ============================================================

const GRAVITY = 0.85;
const RANGE_PX = { Close: 125, Mid: 175, Long: 300, Grab: 140, Air: 120, 'Air Grab': 150, Self: 0, Variable: 180, Full: 1400 };
const MIRROR = { 1: 3, 3: 1, 4: 6, 6: 4, 7: 9, 9: 7, 2: 2, 5: 5, 8: 8 };
const isDiag = d => d === 1 || d === 3 || d === 7 || d === 9;

// ---- 通常技（データに未定義のため、キャラのattack/rangeステータスから生成：READMEに記載） ----
function buildNormals(c) {
  const a = c.attack, r = c.range;
  const base = { category: 'Normal', meterCost: 0, kind: 'strike', hits: 1, level: 'mid', cancel: true, special: false };
  return {
    '5P': { ...base, key: '5P', name: 'Punch', damage: 20 + a * 3, startup: 4, active: 3, recovery: 9, reach: 80 + r * 4, hbW: 70, hbY: [150, 250], hitstun: 15, blockstun: 10, anim: 'punch' },
    '5K': { ...base, key: '5K', name: 'Kick', damage: 40 + a * 4, startup: 8, active: 4, recovery: 16, reach: 105 + r * 5, hbW: 90, hbY: [100, 230], hitstun: 19, blockstun: 13, anim: 'kick',
      armor: c.character_id === 'JACK' ? 1 : 0 },
    '2P': { ...base, key: '2P', name: 'Crouch Punch', damage: 16 + a * 3, startup: 4, active: 3, recovery: 9, reach: 75 + r * 4, hbW: 70, hbY: [60, 150], hitstun: 14, blockstun: 9, anim: 'punch', crouch: true },
    '2K': { ...base, key: '2K', name: 'Sweep', damage: 35 + a * 4, startup: 9, active: 4, recovery: 20, reach: 110 + r * 5, hbW: 100, hbY: [0, 60], level: 'low', knockdown: true, hitstun: 20, blockstun: 12, anim: 'sweep', crouch: true },
    'jP': { ...base, key: 'jP', name: 'Jump Punch', damage: 30 + a * 3, startup: 5, active: 8, recovery: 6, reach: 85 + r * 4, hbW: 80, hbY: [0, 130], level: 'high', hitstun: 17, blockstun: 11, anim: 'punch', air: true, cancel: false },
    'jK': { ...base, key: 'jK', name: 'Jump Kick', damage: 40 + a * 4, startup: 6, active: 10, recovery: 6, reach: 100 + r * 4, hbW: 100, hbY: [-20, 100], level: 'high', hitstun: 19, blockstun: 12, anim: 'kick', air: true, cancel: false },
    'throw': { ...base, key: 'throw', name: 'Throw', category: 'Throw', damage: 90 + a * 6, startup: 5, active: 2, recovery: 20, reach: 135, hbW: 135, hbY: [0, 250], kind: 'grab', knockdown: true, grabTime: 26, anim: 'grab', cancel: false },
  };
}

// ---- moves.csv の1行を実行時の技定義へ（property列から挙動を決定） ----
function buildDataMove(m) {
  const btnK = m.cmd.buttons.includes('K') && !m.cmd.buttons.includes('P');
  const mv = {
    key: m.move_name, name: m.move_name, category: m.category, cmd: m.cmd,
    damage: m.damage, startup: Math.max(1, m.startup_frames), active: Math.max(1, m.active_frames), recovery: m.recovery_frames,
    meterCost: m.meter_cost, rangeName: m.range, property: m.property, notes: m.implementation_notes,
    reach: RANGE_PX[m.range] ?? 160, hbW: 110, hbY: [70, 240], level: 'mid', kind: 'strike', hits: 1,
    advance: 0, armor: 0, invuln: 0, knockdown: false, hitstun: 22, blockstun: 16,
    anim: btnK ? 'kick' : 'punch', special: true, air: m.cmd.air, super: m.category === 'Super',
  };
  const P = m.property;
  switch (P) {
    case 'Projectile':
      mv.kind = 'projectile'; mv.projSpeed = m.range === 'Long' ? 12 : 9; mv.projLife = 130; mv.projStyle = 'orb'; mv.anim = 'cast'; break;
    case 'Palm Wave':
      mv.kind = 'projectile'; mv.projSpeed = 9; mv.projLife = 24; mv.projStyle = 'palm'; mv.anim = 'cast'; break;
    case 'Shockwave':
      mv.kind = 'projectile'; mv.projSpeed = 8; mv.projLife = 30; mv.projStyle = 'wave'; mv.level = 'low'; mv.anim = 'slam'; break;
    case 'Anti-Air':
      mv.invuln = mv.startup + 2; mv.rise = 15; mv.advance = 3; mv.hbY = [60, 330]; mv.hbW = 120; mv.reach = 110;
      mv.hits = mv.active >= 10 ? 3 : 1; mv.knockdown = true; mv.anim = btnK ? 'risekick' : 'uppercut'; break;
    case 'Advancing': mv.advance = 7; mv.knockdown = true; break;
    case 'Combo': mv.advance = 4; mv.hits = 4; mv.knockdown = true; break;
    case 'Overhead-ish': mv.advance = 5; mv.level = 'high'; break;
    case 'Multi-hit': mv.advance = 3; mv.hits = 3; mv.anim = 'spin'; break;
    case 'Mobility': mv.dashSpeed = 13; mv.noPush = true; break;
    case 'Feint/Mix-up': mv.advance = 6; mv.hits = 2; break;
    case 'Armor': mv.armor = 1; mv.advance = 3; break;
    case 'Guard Break': mv.advance = 3; mv.blockstun = 26; mv.chipMul = 2; mv.hitstun = 26; break;
    case 'Advancing Armor': mv.armor = 1; mv.advance = 8; break;
    case 'Counter': mv.kind = 'counter'; mv.counterLevels = ['mid', 'high']; mv.anim = 'stance'; break;
    case 'Stance': mv.kind = 'counter'; mv.counterLevels = null; mv.stance = true; mv.anim = 'stance'; break;
    case 'Side Switch': mv.teleport = 'behind'; mv.invuln = mv.startup; break;
    case 'Spin Kick': mv.advance = 6; mv.hits = 2; mv.anim = 'spin'; break;
    case 'Low Profile': mv.level = 'low'; mv.lowProfile = true; mv.advance = 6; mv.hbY = [0, 80]; mv.anim = 'sweep'; break;
    case 'Dive Kick': case 'Dive Attack':
      mv.dive = true; mv.level = 'high'; mv.hbY = [-40, 90]; mv.reach = 100; mv.anim = 'kick'; break;
    case 'Teleport Dash': mv.dashSpeed = 20; mv.invuln = mv.startup; mv.noPush = true; break;
    case 'Feint': mv.teleport = 'behind'; mv.invuln = mv.startup; mv.afterimage = true; break;
    case 'Command Grab': mv.kind = 'grab'; mv.grabTime = 32; mv.knockdown = true; mv.anim = 'grab'; break;
    case 'Air Throw': mv.kind = 'grab'; mv.airGrab = true; mv.grabTime = 30; mv.knockdown = true; mv.anim = 'grab'; break;
    case 'Super Throw': mv.kind = 'grab'; mv.grabTime = 80; mv.grabHits = 4; mv.knockdown = true; mv.anim = 'grab'; break;
    case 'Teleport': mv.teleport = 'phase'; mv.invuln = mv.startup + 1; break;
    case 'Spatial Attack': mv.kind = 'rift'; mv.anim = 'cast'; break;
    case 'Control': mv.reach = 230; mv.hbW = 150; mv.pull = true; mv.hitstun = 38; mv.anim = 'cast'; break;
    case 'Counter Super': mv.counterAlso = true; mv.counterLevels = null; break;
  }
  if (mv.super) {
    mv.invuln = Math.max(mv.invuln, mv.startup + 3);
    if (mv.kind === 'strike') { mv.hits = Math.max(mv.hits, 6); mv.advance = mv.advance || 5; mv.hbW = 140; }
    mv.knockdown = true; mv.hitstun = 30;
    if (m.range === 'Full') { mv.reach = 1400; mv.hbW = 1400; mv.hbY = [0, 420]; mv.advance = 0; mv.anim = 'cast'; mv.fullScreen = true; }
  }
  return mv;
}

function buildMoveList(c) {
  const normals = buildNormals(c);
  const specials = DATA.moves.filter(m => m.character_id === c.character_id).map(buildDataMove);
  // 優先順位: 超必殺 > ボタン数 > コマンド長
  const sorted = [...specials].sort((a, b) =>
    (b.super - a.super) || (b.cmd.buttons.length - a.cmd.buttons.length) || (b.cmd.seq.length - a.cmd.seq.length));
  return { normals, specials: sorted, ordered: specials };
}

// ============================================================
class Fighter {
  constructor(charDef, side, battle) {
    this.def = charDef;
    this.id = charDef.character_id;
    this.vis = charDef.visual;
    this.side = side;
    this.battle = battle;
    const ml = buildMoveList(charDef);
    this.normals = ml.normals;
    this.specials = ml.specials;
    // ワンボタン必殺技（スマホ/Uキー）：moves.csv の並び順で 必殺 / ↓+必殺 / ←+必殺 / →+必殺 に割り当て
    this.quickGround = ml.ordered.filter(m => !m.super && !m.air);
    this.quickAir = ml.ordered.filter(m => !m.super && m.air);
    this.maxHp = charDef.hp;
    this.walkSpeed = 1.8 + charDef.speed * 0.32;
    this.jumpVx = 2.6 + charDef.speed * 0.25;
    this.hurtW = (this.id === 'JACK' || this.id === 'VIKTOR') ? 52 : 44;
    this.hurtH = this.vis.height * 0.8;
    this.meter = 0;
    this.meterType = charDef.meter_type;
    this.resetRound(side === 0 ? 400 : 880, side === 0 ? 1 : -1);
  }

  resetRound(x, facing) {
    Object.assign(this, {
      x, y: 0, vx: 0, vy: 0, facing, hp: this.maxHp, state: 'intro', stateT: 0, move: null,
      hitstun: 0, blockstun: 0, invuln: 0, history: [{ d: 5, t: 0 }], buffer: [], comboHits: 0, comboDamage: 0,
      armorLeft: 0, tempo: 0, afterimageBuff: 0, punishBoost: 0, trail: [], flash: 0, flashColor: '#fff',
      lastBackPress: -99, airAttackUsed: false, thrownBy: null, grabT: 0, grabChunks: 0, landT: 0, dashT: 0, dashDir: 0,
      inp: { up: false, down: false, left: false, right: false, P: false, K: false, Pp: false, Kp: false },
      lastPT: -99, lastKT: -99, shieldT: 0, jgT: 0, guardPose: false, juggle: false,
    });
  }

  get grounded() { return this.y <= 0 && this.vy <= 0; }
  get opp() { return this.battle.fighters[1 - this.side]; }
  get frame() { return this.battle.frame; }
  relDir(abs) { return this.facing === 1 ? abs : MIRROR[abs]; }
  get curDir() { return this.relDir(dirOf(this.inp)); }
  get actionable() { return ['idle', 'walk', 'crouch', 'guard', 'land'].includes(this.state); }
  get isCrouching() {
    return this.state === 'crouch' || (this.state === 'guard' && this.guardLow) ||
      (this.state === 'blockstun' && this.guardLow) || (this.state === 'attack' && this.move.def.crouch);
  }
  get holdingBack() { const d = this.curDir; return d === 4 || d === 1 || d === 7; }
  gainMeter(v) { this.meter = Math.max(0, Math.min(100, this.meter + v)); }

  // ---------------- 入力 ----------------
  feedInput(inp) {
    this.inp = inp;
    const abs = dirOf(inp);
    const last = this.history[this.history.length - 1];
    if (last.d !== abs) {
      const prevRel = this.relDir(last.d), rel = this.relDir(abs);
      if ((rel === 4 || rel === 1) && !(prevRel === 4 || prevRel === 1 || prevRel === 7)) this.lastBackPress = this.frame;
      this.history.push({ d: abs, t: this.frame });
      if (this.history.length > 40) this.history.shift();
    }
    if (inp.Pp) { this.buffer.push({ b: 'P', t: this.frame }); this.lastPT = this.frame; }
    if (inp.Kp) { this.buffer.push({ b: 'K', t: this.frame }); this.lastKT = this.frame; }
    if (inp.SPp) this.buffer.push({ b: 'SP', t: this.frame });
    if (inp.SAp) this.buffer.push({ b: 'SA', t: this.frame });
    this.buffer = this.buffer.filter(b => this.frame - b.t <= 6);
  }

  // コマンド照合（斜めは途中なら省略可・最後の入力は最新 or 直後のニュートラル）
  matchSeq(seq) {
    const h = this.history, n = h.length, now = this.frame;
    const pat = this.facing === 1 ? seq : seq.map(d => MIRROR[d]);
    if (pat.length === 1) {
      const d = h[n - 1].d, want = pat[0];
      if (want === 2) return d === 1 || d === 2 || d === 3;
      return d === want;
    }
    let idx = n - 1;
    const lastWant = pat[pat.length - 1];
    if (h[idx].d !== lastWant) {
      if (h[idx].d === 5 && idx > 0 && h[idx - 1].d === lastWant && now - h[idx].t <= 8) idx--;
      else return false;
    }
    idx--;
    const maxSpan = 14 + seq.length * 9;
    for (let i = pat.length - 2; i >= 0; i--) {
      const want = pat[i];
      let found = -1;
      for (let j = idx; j >= 0; j--) {
        if (now - h[j + 1].t > maxSpan) break;
        if (h[j].d === want) { found = j; break; }
        if (isDiag(want)) break; // 斜めは直前のみ探す（省略可）
      }
      if (found < 0) { if (isDiag(want)) continue; return false; }
      idx = found - 1;
    }
    return true;
  }

  pressedPK() {
    return this.frame - this.lastPT <= 6 && this.frame - this.lastKT <= 6 && Math.abs(this.lastPT - this.lastKT) <= 3;
  }

  canAfford(mv) { return this.meter >= mv.meterCost; }

  tryInputAttack(cancelOnly = false) {
    if (!this.buffer.length) return false;
    const hasP = this.buffer.some(b => b.b === 'P'), hasK = this.buffer.some(b => b.b === 'K');
    const pk = this.pressedPK();
    const grounded = this.grounded;
    // ワンボタン操作
    if (this.buffer.some(b => b.b === 'SA')) {
      const mv = this.specials.find(m => m.super && !!m.air === !grounded && this.canAfford(m));
      if (mv) { this.startMove(mv); return true; }
    }
    if (this.buffer.some(b => b.b === 'SP') && !(cancelOnly && this.move && this.move.def.special)) {
      const mv = this.quickSpecial(grounded);
      if (mv) { this.startMove(mv); return true; }
    }
    for (const mv of this.specials) {
      if (!!mv.air === grounded) continue;
      if (!this.canAfford(mv)) continue;
      if (cancelOnly && this.move && this.move.def.special && !mv.super) continue;
      const nP = mv.cmd.buttons.includes('P'), nK = mv.cmd.buttons.includes('K');
      if (nP && nK ? !pk : nP ? !hasP : !hasK) continue;
      if (mv.cmd.seq.length && !this.matchSeq(mv.cmd.seq)) continue;
      this.startMove(mv);
      return true;
    }
    if (cancelOnly) return false;
    if (grounded) {
      const crouch = [1, 2, 3].includes(this.curDir);
      if (pk && !crouch && this.inThrowRange()) { this.startMove(this.normals.throw); return true; }
      if (hasK) { this.startMove(this.normals[crouch ? '2K' : '5K']); return true; }
      if (hasP) { this.startMove(this.normals[crouch ? '2P' : '5P']); return true; }
    } else if (!this.airAttackUsed && this.state === 'jump') {
      if (hasK) { this.startMove(this.normals.jK); this.airAttackUsed = true; return true; }
      if (hasP) { this.startMove(this.normals.jP); this.airAttackUsed = true; return true; }
    }
    return false;
  }

  quickSpecial(grounded) {
    if (!grounded) return this.quickAir.find(m => this.canAfford(m)) || null;
    const d = this.curDir;
    const idx = [1, 2, 3].includes(d) ? 1 : (d === 4 || d === 7) ? 2 : (d === 6 || d === 9) ? 3 : 0;
    const mv = this.quickGround[idx] || this.quickGround[0];
    return mv && this.canAfford(mv) ? mv : null;
  }
  quickLabel(mv) {
    if (mv.super) return '超必殺';
    if (mv.air) return '空中:必殺';
    return ['必殺', '↓+必殺', '←+必殺', '→+必殺'][this.quickGround.indexOf(mv)] || '';
  }

  inThrowRange() {
    const o = this.opp;
    return Math.abs(o.x - this.x) <= this.normals.throw.reach && o.grounded && this.canBeGrabbed(o);
  }
  canBeGrabbed(o) {
    return !['hitstun', 'blockstun', 'fall', 'knockdown', 'getup', 'thrown', 'ko'].includes(o.state) && o.invuln <= 0 && !o.moveInvuln();
  }

  startMove(mv) {
    this.buffer.length = 0;
    this.gainMeter(-mv.meterCost);
    const reduce = (this.afterimageBuff > 0 && !mv.super && mv.category !== 'Throw') ? 2 : 0;
    if (reduce) this.afterimageBuff = 0;
    this.move = { def: mv, f: 0, st: Math.max(1, mv.startup - reduce), slots: new Set(), connected: false, spawned: false, teleported: false };
    this.state = 'attack';
    this.armorLeft = mv.armor || 0;
    this.guardPose = false;
    if (mv.special) this.battle.onSpecial(this, mv);
    else Sfx.whoosh();
  }

  moveInvuln() { return this.state === 'attack' && this.move.f < (this.move.def.invuln || 0); }
  moveTimes() {
    const m = this.move, d = m.def;
    return { st: m.st, ae: m.st + d.active, total: m.st + d.active + d.recovery };
  }
  inActive() {
    if (this.state !== 'attack') return false;
    const { st, ae } = this.moveTimes();
    const f = this.move.f;
    if (this.move.def.dive && f >= st && !this.grounded) return true;
    return f >= st && f < ae;
  }
  canCancel() {
    if (this.state !== 'attack' || !this.move.connected) return false;
    const d = this.move.def;
    if (!(d.cancel || (d.special && !d.super))) return false;
    const { ae } = this.moveTimes();
    return this.move.f <= ae + 8;
  }

  // ---------------- 毎フレーム更新 ----------------
  update(controlEnabled) {
    this.stateT++;
    if (this.invuln > 0) this.invuln--;
    if (this.tempo > 0) this.tempo--;
    if (this.afterimageBuff > 0) this.afterimageBuff--;
    if (this.punishBoost > 0) this.punishBoost--;
    if (this.flash > 0) this.flash--;
    if (this.shieldT > 0) this.shieldT--;
    if (this.jgT > 0) this.jgT--;
    if (this.meterType === 'VOID' && this.state !== 'ko') this.gainMeter(0.04); // Void Reserve: 自然回復
    const o = this.opp;

    // 向き
    const faceOpp = () => { if (Math.abs(o.x - this.x) > 4) this.facing = o.x > this.x ? 1 : -1; };

    switch (this.state) {
      case 'intro': case 'win': case 'lose':
        this.vx = 0; if (this.state === 'intro') faceOpp(); break;
      case 'idle': case 'walk': case 'crouch': case 'guard': case 'land': {
        if (this.state === 'land') { this.landT--; if (this.landT <= 0) this.state = 'idle'; else { this.vx *= 0.6; break; } }
        faceOpp();
        this.vx = 0;
        if (!controlEnabled) { this.state = 'idle'; break; }
        if (this.tryInputAttack()) break;
        const d = this.curDir;
        // ダッシュ（前後の2回入力）
        if (this.checkDoubleTap(6)) { this.startDash(1); break; }
        if (this.checkDoubleTap(4)) { this.startDash(-1); break; }
        if (d >= 7) { this.state = 'prejump'; this.stateT = 0; this.jumpDir = d === 9 ? 1 : d === 7 ? -1 : 0; break; }
        const threat = this.battle.threatFor(this);
        if (d <= 3) {
          this.state = (d === 1 && threat) ? 'guard' : 'crouch';
          this.guardLow = true;
        } else if (d === 4) {
          if (threat) { this.state = 'guard'; this.guardLow = false; }
          else { this.state = 'walk'; this.vx = -this.facing * this.walkSpeed * 0.8 * this.speedMul(); }
        } else if (d === 6) {
          this.state = 'walk'; this.vx = this.facing * this.walkSpeed * this.speedMul();
        } else this.state = 'idle';
        break;
      }
      case 'prejump':
        this.vx = 0;
        if (this.stateT >= 3) {
          this.state = 'jump'; this.vy = 16.5; this.y = 0.1; this.airAttackUsed = false;
          this.vx = this.jumpDir * this.facing * this.jumpVx * this.speedMul();
        }
        break;
      case 'jump':
        if (controlEnabled) this.tryInputAttack();
        break;
      case 'dash': {
        if (controlEnabled && this.stateT > 1 && this.tryInputAttack()) break; // ダッシュから技へ移行可
        this.dashT--;
        const spd = (9 + this.def.speed * 0.45) * (this.dashDir < 0 ? 0.9 : 1);
        this.vx = this.facing * this.dashDir * spd * (0.4 + 0.6 * this.dashT / 16);
        if (this.dashDir < 0 && this.stateT < 7) this.invuln = Math.max(this.invuln, 1);
        this.trailPush();
        if (this.dashT <= 0) { this.state = 'idle'; this.vx = 0; if (this.id === 'AKARI') this.afterimageBuff = 40; }
        break;
      }
      case 'attack': this.updateAttack(controlEnabled); break;
      case 'hitstun':
        this.hitstun--; this.vx *= 0.88;
        if (this.hitstun <= 0) { this.state = 'idle'; this.endCombo(); }
        break;
      case 'blockstun':
        this.blockstun--; this.vx *= 0.85;
        if (this.blockstun <= 0) { this.state = 'guard'; this.stateT = 0; }
        break;
      case 'fall':
        if (this.grounded && this.stateT > 2) {
          this.y = 0; this.vy = 0;
          if (this.hp <= 0) { this.state = 'ko'; this.vx = 0; }
          else { this.state = 'knockdown'; this.stateT = 0; this.vx = 0; this.battle.addDust(this.x); }
        }
        break;
      case 'knockdown':
        this.invuln = 2;
        if (this.stateT > 34) { this.state = 'getup'; this.stateT = 0; }
        break;
      case 'getup':
        this.invuln = 2;
        if (this.stateT > 14) { this.state = 'idle'; this.endCombo(); this.invuln = 3; }
        break;
      case 'thrown': this.updateThrown(); break;
      case 'throwing':
        this.vx = 0;
        if (this.stateT >= this.grabT + 12) { this.state = 'idle'; this.move = null; }
        break;
      case 'ko': this.vx *= 0.8; break;
    }

    // 物理
    if (this.state !== 'thrown') {
      if (!this.grounded || this.vy > 0) {
        this.vy -= GRAVITY;
        this.y += this.vy;
        if (this.y <= 0) { this.y = 0; this.onLand(); }
      }
      this.x += this.vx;
    }
    if (this.trail.length) this.trail = this.trail.filter(t => --t.life > 0);
  }

  speedMul() { return this.tempo > 0 ? 1.25 : 1; }

  checkDoubleTap(relWant) {
    const h = this.history, n = h.length;
    if (n < 3) return false;
    const want = this.facing === 1 ? relWant : MIRROR[relWant];
    if (h[n - 1].d !== want || h[n - 1].t !== this.frame) return false;
    return h[n - 2].d === 5 && h[n - 3].d === want && this.frame - h[n - 3].t <= 14;
  }
  startDash(dir) {
    this.state = 'dash'; this.stateT = 0; this.dashT = 16; this.dashDir = dir; Sfx.whoosh();
  }
  trailPush() {
    if (this.battle.frame % 2 === 0) this.trail.push({ x: this.x, y: this.y, facing: this.facing, life: 10, max: 10 });
  }

  onLand() {
    this.vy = 0;
    if (this.state === 'jump') { this.state = 'land'; this.landT = 3; this.vx = 0; }
    else if (this.state === 'attack') {
      const d = this.move.def;
      if (d.air || d.dive) { this.state = 'land'; this.landT = d.dive ? 10 : 4; this.move = null; this.vx = 0; }
      else if (d.rise) {
        const { total } = this.moveTimes();
        if (this.move.f >= total - 4) { this.state = 'land'; this.landT = 8; this.move = null; this.vx = 0; }
      }
    } else if (this.state === 'hitstun' || this.state === 'blockstun') {
      this.state = 'fall'; this.vy = 0;
    }
  }

  updateAttack(controlEnabled) {
    const m = this.move, d = m.def, o = this.opp;
    const { st, ae, total } = this.moveTimes();
    const f = m.f;

    // キャンセル（通常技→必殺技、必殺技→超必殺）
    if (controlEnabled && this.canCancel() && this.tryInputAttack(true)) return;
    // 通常技の直後にもう一方のボタン → 投げに変換
    if (controlEnabled && d.category === 'Normal' && !d.air && f <= 2 && this.pressedPK() && this.inThrowRange()) {
      this.startMove(this.normals.throw); return;
    }

    if (this.grounded && !d.rise) this.vx *= 0.7;
    if (d.dashSpeed && f < st) { this.vx = this.facing * d.dashSpeed; this.trailPush(); }
    if (d.advance && f >= st - 2 && f < ae && this.grounded) this.vx = this.facing * d.advance;
    if (d.rise && f === st) { this.vy = d.rise; this.y = 0.1; this.vx = this.facing * d.advance; }
    if (d.dive && f === st) { this.vx = this.facing * 9; this.vy = -13; }
    if (d.teleport && f === st - 1 && !m.teleported) this.doTeleport(d);
    if (f === st && !m.spawned) {
      m.spawned = true;
      if (d.kind === 'projectile') this.battle.spawnProjectile(this, d);
      else if (d.kind === 'rift') this.battle.spawnRift(this, d);
      else if (d.kind === 'strike') Sfx.whoosh();
    }
    if (d.super || d.special) this.trailPush();

    m.f++;
    // ダイブ攻撃は着地まで持続
    if (d.dive && m.f >= ae && !this.grounded) m.f = ae - 1;
    if (m.f >= total) {
      if (!this.grounded) { m.f = total - 1; return; } // 空中で終わったら着地待ち
      this.state = 'idle'; this.move = null; this.armorLeft = 0;
    }
  }

  doTeleport(d) {
    const o = this.opp;
    this.move.teleported = true;
    this.battle.addAfterimage(this);
    const dist = Math.abs(o.x - this.x);
    if (d.teleport === 'behind' && dist < 320) {
      this.x = o.x + (o.x > this.x ? 1 : -1) * 90;
    } else if (d.teleport === 'phase') {
      if (dist < 280) this.x = o.x + (o.x > this.x ? 1 : -1) * 90;
      else this.x += this.facing * 190;
    } else {
      this.x += this.facing * 140;
    }
    this.x = Math.max(this.battle.wallL, Math.min(this.battle.wallR, this.x));
    this.facing = o.x > this.x ? 1 : -1;
  }

  updateThrown() {
    const a = this.thrownBy;
    this.grabTimer++;
    const t = this.grabTimer;
    // 相手に持ち上げられている表現
    const lift = Math.sin(Math.min(1, t / this.grabDur) * Math.PI) * (this.grabHits > 1 ? 140 : 90);
    this.x = a.x + a.facing * 75;
    this.y = lift;
    this.vx = 0; this.vy = 0;
    if (this.grabHits > 1 && t % Math.floor(this.grabDur / this.grabHits) === 0 && this.grabChunks > 0) {
      this.battle.grabChunk(a, this);
    }
    if (t >= this.grabDur) this.battle.finishThrow(a, this);
  }

  endCombo() { this.comboHits = 0; this.comboDamage = 0; this.juggle = false; }

  // ---------------- 当たり判定 ----------------
  getHurtbox() {
    let h = this.hurtH, ext = 0;
    if (this.isCrouching) h *= 0.62;
    if (this.state === 'knockdown' || this.state === 'ko') h = 40;
    if (this.state === 'attack') {
      const d = this.move.def;
      if (d.lowProfile) h *= 0.4;
      if (this.move.f >= this.move.st) ext = Math.max(0, (d.reach - this.hurtW) * 0.45);
      if (d.fullScreen) ext = 0;
    }
    const x1 = this.facing === 1 ? this.x - this.hurtW : this.x - this.hurtW - ext;
    const x2 = this.facing === 1 ? this.x + this.hurtW + ext : this.x + this.hurtW;
    return { x1, x2, y1: this.y, y2: this.y + h };
  }
  getHitbox() {
    if (!this.inActive()) return null;
    const d = this.move.def;
    if (d.kind !== 'strike' && d.kind !== 'grab') return null;
    if (d.fullScreen) return { x1: this.battle.wallL - 100, x2: this.battle.wallR + 100, y1: 0, y2: 420 };
    const front = this.x + this.facing * d.reach;
    const back = this.x + this.facing * Math.max(0, d.reach - d.hbW);
    return { x1: Math.min(front, back), x2: Math.max(front, back), y1: this.y + d.hbY[0], y2: this.y + d.hbY[1] };
  }
  currentSlot() {
    const d = this.move.def;
    if (d.hits <= 1) return 0;
    const f = this.move.f - this.move.st;
    const iv = Math.max(1, Math.floor(d.active / d.hits));
    return Math.min(d.hits - 1, Math.floor(f / iv));
  }
  inCounterWindow() {
    if (this.state !== 'attack') return false;
    const d = this.move.def;
    if (!(d.kind === 'counter' || d.counterAlso)) return false;
    const { ae } = this.moveTimes();
    return this.move.f < ae;
  }

  // ---------------- 描画 ----------------
  // 状態に応じたポーズ画像の候補（先頭から順に、存在するものを使う）
  poseChain() {
    const st = this.state;
    switch (st) {
      case 'intro': return ['stand', 'idle'];
      case 'idle': case 'land': return ['idle'];
      case 'walk': case 'dash': return ['walk', 'idle'];
      case 'crouch': case 'prejump': return ['crouch'];
      case 'jump': return ['jump'];
      case 'guard': case 'blockstun': return this.guardLow ? ['crouch', 'guard'] : ['guard', 'idle'];
      case 'attack': {
        const d = this.move.def, { ae, total } = this.moveTimes();
        if (this.move.f >= ae + (total - ae) * 0.6) return d.crouch ? ['crouch'] : d.air ? ['jump'] : ['idle'];
        const kick = ['kick', 'risekick', 'spin'].includes(d.anim);
        if (d.anim === 'sweep') return ['sweep', 'crouch'];
        if (d.crouch) return ['crouch'];
        if (d.air) return kick ? ['kick', 'jump'] : ['punch', 'jump'];
        if (d.super || d.anim === 'cast' || d.anim === 'stance') return ['special', 'punch'];
        return kick ? ['kick'] : ['punch'];
      }
      case 'hitstun': case 'fall': case 'thrown': return ['hit'];
      case 'knockdown': case 'ko': return ['down'];
      case 'getup': return ['crouch'];
      case 'throwing': return ['punch'];
      case 'win': return ['win', 'stand', 'idle'];
      case 'lose': return ['hit', 'idle'];
    }
    return ['idle'];
  }

  // 描画に使う画像（ポーズ画像があればそれ、なければ元画像）
  sprite() {
    const set = ASSETS.poses[this.id];
    if (set) {
      for (const p of [...this.poseChain(), 'idle']) {
        const img = set[p];
        if (!img) continue;
        const def = POSES[p];
        let s;
        const ref = set.idle;
        if (ref && ref.W === img.W && ref.H === img.H) {
          // 同じ構図で作られた画像は、構えポーズと同じ縮尺で描く（絵の大きさ関係を保つ）
          s = this.vis.height / ref.bodyH;
        } else {
          s = def.w ? this.vis.height * def.w / img.bodyW : this.vis.height * def.h / img.bodyH;
        }
        return { a: img, s, anchorX: img.footX, baseFlip: 1, pose: p };
      }
    }
    const a = ASSETS.chars[this.id];
    return { a, s: this.vis.height / a.bodyH, anchorX: a.anchorX, baseFlip: this.vis.facing === 'right' ? 1 : -1, pose: null };
  }

  draw(ctx, groundY) {
    const spr = this.sprite();
    const a = spr.a, s = spr.s;
    const t = this.battle.frame;
    const baseFlip = spr.baseFlip;
    let sx = 1, sy = 1, rot = 0, ox = 0, oy = 0;
    const st = this.state;

    if (st === 'idle' || st === 'intro' || st === 'guard' || st === 'land') {
      sy = 1 + Math.sin(t * 0.09 + this.side) * 0.012;
      if (st === 'guard') { rot = -0.04; sx = 0.97; if (this.guardLow) { sy = 0.72; sx = 1.05; } }
      if (st === 'land') { sy = 0.92; sx = 1.04; }
    } else if (st === 'walk') {
      oy = Math.abs(Math.sin(t * 0.22)) * 5;
      rot = Math.sign(this.vx) * this.facing * 0.04;
    } else if (st === 'crouch') { sy = 0.72; sx = 1.06; }
    else if (st === 'prejump') { sy = 0.9; sx = 1.05; }
    else if (st === 'jump') { rot = this.vy > 0 ? -0.06 : 0.08; sy = 0.96; }
    else if (st === 'dash') { rot = this.dashDir * 0.12; }
    else if (st === 'attack') {
      const m = this.move, d = m.def, { st: s0, ae, total } = this.moveTimes();
      const f = m.f;
      const kick = d.anim === 'kick' || d.anim === 'risekick' || d.anim === 'spin' || d.anim === 'sweep';
      if (f < s0) { const p = f / s0; rot = -0.07 * p; ox = -6 * p; }
      else if (f < ae) { rot = kick ? 0.16 : 0.1; ox = kick ? 22 : 26; sx = 1.07; }
      else { const p = 1 - (f - ae) / Math.max(1, total - ae); rot = (kick ? 0.16 : 0.1) * p; ox = 22 * p; }
      if (d.crouch || d.anim === 'sweep') { sy = 0.72; sx *= 1.06; }
      if (d.anim === 'cast' && f >= s0) { rot = 0.05; ox = 10; }
      if (d.anim === 'stance') { rot = -0.05; sx = 0.98; }
      if (d.anim === 'spin' && f >= s0 && f < ae) sx = Math.cos((f - s0) * 0.6) * 1.05;
      if (d.anim === 'grab' && f >= s0) { ox = 30; rot = 0.12; }
      if (d.air) rot += 0.05;
    } else if (st === 'hitstun') {
      rot = -0.18 * Math.min(1, this.hitstun / 10); ox = -8 + (this.hitstun % 2 ? 3 : -3);
    } else if (st === 'blockstun') { rot = -0.06; sx = 0.96; if (this.guardLow) { sy = 0.72; sx = 1.04; } }
    else if (st === 'fall' || st === 'thrown') {
      rot = -0.4 - Math.min(1.1, this.stateT * 0.05);
    } else if (st === 'knockdown' || st === 'ko') { rot = -1.5; oy = 0; }
    else if (st === 'getup') { rot = -1.5 * (1 - this.stateT / 14); }
    else if (st === 'throwing') { ox = 20; rot = -0.1; }
    else if (st === 'win') { oy = Math.abs(Math.sin(t * 0.06)) * 8; sy = 1.02; }
    else if (st === 'lose') { rot = 0.12; sy = 0.95; }

    // ポーズ画像を使う場合は、画像自体が表す動きと重複する変形を弱める
    const pose = spr.pose;
    if (pose) {
      if (pose === 'crouch' || pose === 'sweep') { sx = 1; sy = 1; }
      if (pose === 'down' || (st === 'getup' && pose === 'crouch')) rot = 0;
      if (['punch', 'kick', 'special', 'guard', 'jump', 'hit', 'win', 'walk'].includes(pose)) { rot *= 0.4; sx = 1; sy = 1; }
      if (pose === 'punch' || pose === 'kick' || pose === 'special') ox *= 0.3;
    }
    const flip = baseFlip * this.facing;
    // 影
    ctx.save();
    ctx.globalAlpha = Math.max(0.15, 0.45 - this.y / 800);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, groundY + 2, 85 * (1 - Math.min(0.5, this.y / 600)), 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 残像
    for (const tr of this.trail) {
      ctx.save();
      ctx.globalAlpha = 0.35 * tr.life / tr.max;
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(tr.x, groundY - tr.y);
      ctx.scale(baseFlip * tr.facing * s, s);
      ctx.drawImage(a.tint, -spr.anchorX, -a.footY);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x + ox * this.facing, groundY - this.y - oy);
    ctx.rotate(rot * this.facing);
    ctx.scale(flip * sx * s, sy * s);
    if (this.state === 'ko' || this.state === 'knockdown') ctx.translate(0, 0);
    ctx.drawImage(a.canvas, -spr.anchorX, -a.footY);
    // 必殺技オーラ
    if (this.state === 'attack' && (this.move.def.special) && this.move.f < this.moveTimes().ae) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 + 0.1 * Math.sin(t * 0.8);
      ctx.drawImage(a.tint, -spr.anchorX, -a.footY);
    }
    if (this.armorLeft > 0 && this.state === 'attack' && this.move.f < this.moveTimes().ae) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25;
      ctx.drawImage(a.white, -spr.anchorX, -a.footY);
    }
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, this.flash / 4) * 0.85;
      ctx.drawImage(this.flashColor === 'tint' ? a.tint : a.white, -spr.anchorX, -a.footY);
    }
    ctx.restore();

    // 攻撃エフェクト
    if (this.inActive()) this.drawStrikeFx(ctx, groundY);
    // ガードエフェクト
    if (this.shieldT > 0) {
      ctx.save();
      const hb = this.getHurtbox();
      const cx = this.x + this.facing * (this.hurtW + 15), cy = groundY - (hb.y1 + hb.y2) / 2;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.shieldT / 12;
      ctx.strokeStyle = this.jgT > 0 ? '#fff38a' : '#6ad8ff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 26, (hb.y2 - hb.y1) / 2.2, 0, -Math.PI / 2, Math.PI / 2, this.facing < 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawStrikeFx(ctx, groundY) {
    const hb = this.getHitbox();
    if (!hb) return;
    const d = this.move.def;
    if (d.kind === 'grab' || d.fullScreen) return;
    const t = this.battle.frame;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cy = groundY - (hb.y1 + hb.y2) / 2;
    const fx = this.facing === 1 ? hb.x2 : hb.x1;
    const col = d.special ? this.vis.color : '#ffffff';
    const g = ctx.createLinearGradient(this.x, 0, fx, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.strokeStyle = col;
    if (d.anim === 'uppercut' || d.anim === 'risekick') {
      ctx.globalAlpha = 0.55;
      const cx = (hb.x1 + hb.x2) / 2;
      const grd = ctx.createLinearGradient(0, groundY - hb.y1, 0, groundY - hb.y2);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, this.vis.color);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(cx, groundY - (hb.y1 + hb.y2) / 2, 40, (hb.y2 - hb.y1) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.anim === 'kick' || d.anim === 'spin' || d.anim === 'sweep') {
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = d.special ? 10 : 6;
      const r = Math.max(40, (hb.x2 - hb.x1) * 0.7);
      const cx = fx - this.facing * r;
      const a0 = this.facing === 1 ? -0.9 : Math.PI + 0.9;
      const a1 = this.facing === 1 ? 0.9 : Math.PI - 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1, this.facing !== 1);
      ctx.stroke();
      ctx.globalAlpha = 0.3; ctx.lineWidth = 18;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, a0, a1, this.facing !== 1); ctx.stroke();
    } else {
      ctx.globalAlpha = 0.75;
      const len = Math.abs(fx - this.x);
      ctx.beginPath();
      ctx.ellipse((this.x + fx) / 2 + this.facing * len * 0.15, cy, len * 0.45, d.special ? 16 : 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (d.super) {
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 4;
        ctx.strokeStyle = i % 2 ? this.vis.color2 : this.vis.color;
        const rx = hb.x1 + Math.random() * (hb.x2 - hb.x1), ry = groundY - hb.y1 - Math.random() * (hb.y2 - hb.y1);
        const ang = Math.random() * Math.PI;
        ctx.beginPath();
        ctx.moveTo(rx - Math.cos(ang) * 70, ry - Math.sin(ang) * 70);
        ctx.lineTo(rx + Math.cos(ang) * 70, ry + Math.sin(ang) * 70);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

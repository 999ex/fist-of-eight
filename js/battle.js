'use strict';
// ============================================================
// CombatController / RoundManager / MeterController / CPU
// ============================================================

const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
const rand = Math.random;
const pick = arr => arr[Math.floor(rand() * arr.length)];

class Battle {
  constructor(opts) {
    // opts: { p1, p2, stage, mode: 'cpu'|'versus'|'training', cpuLevel }
    this.opts = opts;
    this.rules = DATA.rules;
    this.frame = 0;
    this.wallL = 70; this.wallR = 1210; this.groundY = 660;
    this.fighters = [new Fighter(DATA.byId[opts.p1], 0, this), new Fighter(DATA.byId[opts.p2], 1, this)];
    this.wins = [0, 0];
    this.round = 1;
    this.training = opts.mode === 'training';
    this.dummyMode = 'STAND';
    this.ai = [null, opts.mode === 'cpu' ? new CPU(opts.cpuLevel, 1, this) : null];
    this.trainingCPU = new CPU(3, 1, this);
    this.hpLag = [0, 0];
    this.startRound();
  }

  startRound() {
    const [a, b] = this.fighters;
    a.resetRound(440, 1); b.resetRound(840, -1);
    if (this.training) { a.meter = 100; b.meter = 100; }
    this.hpLag = [a.hp, b.hp];
    this.timer = this.rules.round_time_seconds * 60;
    this.phase = 'intro'; this.phaseT = 0;
    this.projectiles = []; this.particles = []; this.texts = []; this.banners = [null, null]; this.combos = [null, null];
    this.hitstop = 0; this.shake = 0; this.superFreeze = null; this.slowmo = 0;
    this.roundWinner = null;
    if (this.training) { this.phase = 'fight'; a.state = b.state = 'idle'; }
    else {
      const last = this.wins[0] === this.rules.rounds_to_win - 1 && this.wins[1] === this.rules.rounds_to_win - 1;
      Sfx.announce(last ? 'Final round' : `Round ${this.round}`);
    }
  }

  // ---------------- 更新 ----------------
  update() {
    this.frame++;
    this.updateParticles();
    if (this.superFreeze) {
      this.superFreeze.t--;
      if (this.superFreeze.t <= 0) this.superFreeze = null;
      return;
    }
    if (this.hitstop > 0) { this.hitstop--; return; }
    if (this.slowmo > 0) { this.slowmo--; if (this.slowmo % 3 !== 0) return; }
    if (this.shake > 0) this.shake--;
    this.phaseT++;
    const F = this.fighters;
    const ctl = this.phase === 'fight';

    if (this.phase === 'intro' && this.phaseT === 70) Sfx.announce('Fight!');
    if (this.phase === 'intro' && this.phaseT >= 100) { this.phase = 'fight'; this.phaseT = 0; F.forEach(f => { f.state = 'idle'; f.stateT = 0; }); }

    // 入力
    for (let i = 0; i < 2; i++) {
      let inp;
      if (this.ai[i]) inp = this.ai[i].think();
      else if (i === 1 && this.training) inp = this.dummyInput();
      else if (this.opts.mode !== 'versus' && i === 0) inp = mergeInputs(readPlayer(0), readPlayer(1));
      else inp = readPlayer(i);
      F[i].feedInput(inp);
    }
    F.forEach(f => f.update(ctl));

    this.resolvePush();
    this.updateProjectiles();
    if (this.phase === 'fight') this.detectHits();

    // 表示用HPラグ
    for (let i = 0; i < 2; i++) {
      if (this.hpLag[i] > F[i].hp) { if (F[i].state !== 'hitstun' && F[i].state !== 'fall' && F[i].state !== 'thrown') this.hpLag[i] -= Math.max(2, (this.hpLag[i] - F[i].hp) * 0.08); }
      if (this.hpLag[i] < F[i].hp) this.hpLag[i] = F[i].hp;
    }

    // トレーニング：回復
    if (this.training) {
      for (const f of F) {
        if (f.comboHits === 0 && f.actionable && f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + 12);
        if (f.meter < 100 && f.state !== 'attack') f.gainMeter(1);
        if (f.hp <= 0) f.hp = 1;
      }
      return;
    }

    // ラウンド管理
    if (this.phase === 'fight') {
      this.timer--;
      const ko0 = F[0].hp <= 0, ko1 = F[1].hp <= 0;
      if (ko0 || ko1) {
        this.phase = 'ko'; this.phaseT = 0; this.slowmo = 90;
        this.roundWinner = ko0 && ko1 ? -1 : ko0 ? 1 : 0;
        Sfx.ko(); Sfx.announce('K.O.');
      } else if (this.timer <= 0) {
        this.timer = 0;
        this.phase = 'timeover'; this.phaseT = 0;
        // 残りHPの割合が多い方が勝ち（最大HPがキャラごとに異なるため割合で判定：READMEに記載）
        const r0 = F[0].hp / F[0].maxHp, r1 = F[1].hp / F[1].maxHp;
        this.roundWinner = Math.abs(r0 - r1) < 1e-6 ? -1 : r0 > r1 ? 0 : 1;
        Sfx.announce('Time');
      }
    } else if (this.phase === 'ko' || this.phase === 'timeover') {
      if (this.phaseT >= 130) {
        const w = this.roundWinner;
        if (w >= 0) { this.wins[w]++; F[w].state = 'win'; if (F[1 - w].state !== 'ko') F[1 - w].state = 'lose'; }
        else if (this.phase === 'timeover') F.forEach(f => f.state = 'lose');
        this.phase = 'roundEnd'; this.phaseT = 0;
        if (w >= 0) Sfx.announce(this.fighters[w].def.display_name.split(' ')[0] + ' wins');
        else Sfx.announce('Draw');
      }
    } else if (this.phase === 'roundEnd') {
      if (this.phaseT >= 150) {
        const need = this.rules.rounds_to_win;
        if (this.wins[0] >= need || this.wins[1] >= need || this.round >= 9) {
          this.phase = 'matchEnd';
          this.matchWinner = this.wins[0] === this.wins[1] ? -1 : this.wins[0] > this.wins[1] ? 0 : 1;
        } else { this.round++; this.startRound(); }
      }
    }
  }

  dummyInput() {
    const blank = { up: false, down: false, left: false, right: false, P: false, K: false, Pp: false, Kp: false };
    const me = this.fighters[1], o = me.opp;
    if (this.dummyMode === 'CPU') return this.trainingCPU.think();
    if (this.dummyMode === 'CROUCH') return { ...blank, down: true };
    if (this.dummyMode === 'BLOCK') {
      const back = me.facing === 1 ? 'left' : 'right';
      let low = true;
      if (o.state === 'attack' && o.move.def.level === 'high') low = false;
      if (!o.grounded) low = false;
      return { ...blank, [back]: true, down: low };
    }
    return blank;
  }

  resolvePush() {
    const [a, b] = this.fighters;
    const noPush = f => f.state === 'thrown' || f.state === 'throwing' ||
      (f.state === 'attack' && f.move.def.noPush && f.move.f < f.move.st + f.move.def.active) ||
      f.state === 'knockdown' || f.state === 'ko';
    if (!noPush(a) && !noPush(b)) {
      const minD = a.hurtW + b.hurtW + 22;
      const dx = b.x - a.x;
      const vOverlap = a.y < b.y + 180 && b.y < a.y + 180;
      if (Math.abs(dx) < minD && vOverlap) {
        const dir = dx === 0 ? (a.facing) : Math.sign(dx);
        const ov = minD - Math.abs(dx);
        a.x -= dir * ov / 2; b.x += dir * ov / 2;
      }
    }
    for (const f of this.fighters) {
      if (f.state === 'thrown') continue;
      f.x = Math.max(this.wallL, Math.min(this.wallR, f.x));
    }
    // 壁際で重なった場合の補正
    if (!noPush(a) && !noPush(b) && Math.abs(a.x - b.x) < a.hurtW + b.hurtW + 18) {
      const minD = a.hurtW + b.hurtW + 22;
      if (a.x <= this.wallL + 1) b.x = a.x + minD; else if (b.x <= this.wallL + 1) a.x = b.x + minD;
      else if (a.x >= this.wallR - 1) b.x = a.x - minD; else if (b.x >= this.wallR - 1) a.x = b.x - minD;
    }
  }

  threatFor(f) {
    const o = f.opp;
    if (o.state === 'attack') {
      const { ae } = o.moveTimes();
      if (o.move.f < ae && Math.abs(o.x - f.x) < o.move.def.reach + 170) return true;
    }
    for (const p of this.projectiles) {
      if (p.owner === f) continue;
      if (p.kind === 'rift') return true;
      if (Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.x - f.x) < 420) return true;
    }
    return false;
  }

  // ---------------- 必殺技イベント ----------------
  onSpecial(f, mv) {
    this.banners[f.side] = { name: mv.name, t: 100, super: mv.super };
    if (mv.super) {
      this.superFreeze = { f, mv, t: 50 };
      Sfx.superFlash();
    } else Sfx.special();
  }

  spawnProjectile(owner, d) {
    let speed = d.projSpeed;
    // NOIR Void Reserve: VOID 50以上でVoid Handが高速化
    if (owner.id === 'NOIR' && owner.meter >= 50) speed *= 1.3;
    const yMid = (d.hbY[0] + d.hbY[1]) / 2;
    const y = d.projStyle === 'wave' ? 35 : d.projStyle === 'palm' ? 180 : 175;
    this.projectiles.push({
      kind: 'proj', owner, d, x: owner.x + owner.facing * 70, y: yMid && d.projStyle === 'wave' ? 35 : y,
      vx: owner.facing * speed, life: d.projLife, r: d.projStyle === 'wave' ? 30 : d.projStyle === 'palm' ? 38 : 30,
      born: this.frame, style: d.projStyle, color: owner.vis.color, color2: owner.vis.color2,
    });
    Sfx.projectile();
  }

  spawnRift(owner, d) {
    const o = owner.opp;
    const maxR = RANGE_PX.Long + 220;
    const tx = Math.max(owner.x - maxR, Math.min(owner.x + maxR, o.x));
    this.projectiles.push({ kind: 'rift', owner, d, x: tx, y: 0, vx: 0, life: d.active + 10, r: 45, born: this.frame, color: owner.vis.color, color2: owner.vis.color2, delay: 6 });
    Sfx.projectile();
  }

  updateProjectiles() {
    const P = this.projectiles;
    for (const p of P) {
      p.life--;
      if (p.kind === 'rift') { if (p.delay > 0) p.delay--; }
      else p.x += p.vx;
      if (this.frame % 2 === 0 && p.kind === 'proj') {
        this.particles.push({ x: p.x - p.vx * 2, y: this.groundY - p.y + (rand() - 0.5) * 20, vx: -p.vx * 0.1, vy: (rand() - 0.5), life: 16, max: 16, size: p.r * 0.5, color: p.color, type: 'glow' });
      }
    }
    // 飛び道具同士の相殺
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j];
      if (a.owner === b.owner || a.kind !== 'proj' || b.kind !== 'proj' || a.life <= 0 || b.life <= 0) continue;
      if (Math.abs(a.x - b.x) < a.r + b.r && Math.abs(a.y - b.y) < 60) {
        a.life = b.life = 0;
        this.burst((a.x + b.x) / 2, this.groundY - a.y, '#ffffff', 18);
        Sfx.block();
      }
    }
    if (this.phase === 'fight') {
      for (const p of P) {
        if (p.life <= 0 || (p.kind === 'rift' && p.delay > 0)) continue;
        const def = p.owner.opp;
        const box = p.kind === 'rift'
          ? { x1: p.x - 45, x2: p.x + 45, y1: 0, y2: 300 }
          : { x1: p.x - p.r, x2: p.x + p.r, y1: p.y - p.r, y2: p.y + p.r };
        if (overlap(box, def.getHurtbox())) {
          const r = this.applyHit(p.owner, def, p.d, { projectile: true, srcX: p.x });
          if (r) p.life = 0;
        }
      }
    }
    this.projectiles = P.filter(p => p.life > 0 && p.x > -100 && p.x < 1380);
  }

  // ---------------- 当たり判定 ----------------
  detectHits() {
    const F = this.fighters;
    const results = [];
    for (let i = 0; i < 2; i++) {
      const att = F[i], def = F[1 - i];
      const hb = att.getHitbox();
      if (!hb) continue;
      const m = att.move, d = m.def;
      if (d.kind === 'grab') {
        if (m.grabbed) continue;
        const dx = Math.abs(def.x - att.x);
        if (dx > d.reach + def.hurtW * 0.3) continue;
        if (def.invuln > 0 || def.moveInvuln()) continue;
        if (d.airGrab) {
          if (def.grounded || Math.abs(def.y - att.y) > 170 || ['thrown', 'knockdown', 'ko', 'getup'].includes(def.state)) continue;
        } else if (!def.grounded || !att.canBeGrabbed(def)) continue;
        results.push({ type: 'grab', att, def, d });
        continue;
      }
      const slot = att.currentSlot();
      if (m.slots.has(slot)) continue;
      if (overlap(hb, def.getHurtbox())) results.push({ type: 'strike', att, def, d, slot });
    }
    for (const r of results) {
      if (r.att.state !== 'attack') continue; // 相打ちで既に潰された
      if (r.type === 'grab') this.doGrab(r.att, r.def, r.d);
      else { r.att.move.slots.add(r.slot); this.applyHit(r.att, r.def, r.d, { slot: r.slot }); }
    }
  }

  canBlock(def, d) {
    if (!def.grounded) return false;
    if (!['idle', 'walk', 'crouch', 'guard', 'blockstun', 'land'].includes(def.state)) return false;
    if (!def.holdingBack) return false;
    const low = [1, 2, 3].includes(def.curDir);
    if (d.level === 'low' && !low) return false;
    if (d.level === 'high' && low) return false;
    return true;
  }

  applyHit(att, def, d, o = {}) {
    if (def.invuln > 0 || def.moveInvuln()) return null;
    if (['knockdown', 'getup', 'ko', 'thrown'].includes(def.state)) return null;
    if (def.state === 'fall') {
      const cont = att.move && def.lastHitBy === att.move;
      if (!cont && !(d.super || d.rise) ) return null;
      if (!cont && def.juggle) return null;
    }
    const dirAway = Math.sign(def.x - (o.srcX ?? att.x)) || att.facing;

    // ---- カウンター（MEI LIN） ----
    if (def.inCounterWindow() && d.kind !== 'grab') {
      const cd = def.move.def;
      const lvOk = !cd.counterLevels || cd.counterLevels.includes(d.level);
      if (lvOk && (!o.projectile || cd.stance)) { this.triggerCounter(def, att); return 'counter'; }
    }

    // ---- アーマー ----
    if (def.state === 'attack' && def.armorLeft > 0 && !d.super && def.move.f < def.moveTimes().ae) {
      def.armorLeft--;
      const dmg = Math.round(d.damage * (o.slot !== undefined && d.hits > 1 ? 1 / d.hits : 1));
      def.hp = Math.max(1, def.hp - dmg);
      def.flash = 6; def.flashColor = '#fff';
      this.hitstop = 8;
      this.popText(def, 'ARMOR', '#ffd24a');
      this.burst(def.x, this.groundY - 180, '#ffd24a', 12);
      Sfx.block();
      return 'armor';
    }

    const perHit = d.hits > 1 ? 1 / d.hits : 1;

    // ---- ガード ----
    if (this.canBlock(def, d)) {
      const jg = this.frame - def.lastBackPress <= 6 && def.state !== 'blockstun';
      let chip = 0;
      if (d.special || d.super) chip = d.damage * perHit * 0.25 * (d.chipMul || 1) * (def.id === 'VIKTOR' ? 0.5 : 1);
      if (jg) chip = 0;
      chip = Math.round(chip);
      def.hp = d.super ? def.hp - chip : Math.max(1, def.hp - chip);
      def.state = 'blockstun'; def.stateT = 0; def.move = null;
      def.guardLow = [1, 2, 3].includes(def.curDir);
      let bs = d.blockstun;
      if (d.hits > 1 && att.move) bs = Math.max(bs, att.moveTimes().ae - att.move.f + 6);
      if (jg) bs = def.id === 'MEILIN' ? 2 : Math.ceil(bs / 2);
      def.blockstun = bs;
      def.vx = dirAway * (d.special ? 6 : 4.5);
      if (this.atWall(def) && !o.projectile) att.vx = -dirAway * 5;
      def.shieldT = 12;
      att.gainMeter(d.super ? 0 : d.special ? 4 : 3);
      def.gainMeter(jg ? (def.id === 'MEILIN' ? 15 : 8) : 2);
      if (att.move) att.move.connected = true;
      if (jg) { def.jgT = 12; this.popText(def, 'JUST GUARD', '#fff38a'); Sfx.counter(); }
      else Sfx.block();
      this.hitstop = 6;
      this.spark(o.srcX ?? (def.x - dirAway * def.hurtW), this.groundY - ((d.hbY[0] + d.hbY[1]) / 2 + (o.projectile ? 0 : att.y)), '#6ad8ff', 8);
      return 'block';
    }

    // ---- ヒット ----
    const n = def.comboHits;
    const scale = n < 2 ? 1 : Math.max(0.3, 1 - (n - 1) * 0.1);
    let mul = 1;
    if (att.punishBoost > 0) { mul = 1.3; att.punishBoost = 0; }
    const dmg = Math.max(1, Math.round(d.damage * perHit * scale * mul));
    def.hp = Math.max(0, def.hp - dmg);
    def.comboHits++; def.comboDamage += dmg;
    def.move = null; def.armorLeft = 0;
    def.lastHitBy = att.move || null;
    const airborne = !def.grounded || def.state === 'fall';
    const lastSlot = d.hits <= 1 || o.slot === undefined || o.slot >= d.hits - 1;
    const kd = (d.knockdown && lastSlot) || def.hp <= 0 || (airborne && lastSlot);
    if (kd) {
      if (def.state === 'fall') def.juggle = true;
      def.state = 'fall'; def.stateT = 0;
      def.vy = def.hp <= 0 ? 11 : (d.rise ? 12 : 8); def.y = Math.max(def.y, 0.1);
      def.vx = dirAway * (d.super ? 6 : 4);
    } else if (airborne) {
      def.state = 'fall'; def.stateT = 0; def.vy = Math.max(def.vy, 4); def.y = Math.max(def.y, 0.1); def.vx = dirAway * 2;
    } else {
      def.state = 'hitstun'; def.stateT = 0;
      let hs = d.hitstun;
      if (d.hits > 1 && att.move) hs = Math.max(hs, att.moveTimes().ae - att.move.f + 10);
      def.hitstun = hs;
      def.vx = dirAway * (d.special ? 6 : 4);
      if (d.pull) { def.vx = -dirAway * 7; }
      if (this.atWall(def) && !o.projectile) att.vx = -dirAway * 5;
    }
    def.flash = 5; def.flashColor = '#fff';
    if (att.move) att.move.connected = true;
    att.gainMeter(d.super ? 0 : d.special ? 8 : 5);
    def.gainMeter(4);
    if (att.id === 'LUNA' && def.comboHits >= 3) att.tempo = 180; // Tempo
    const heavy = d.special || d.super || d.damage >= 70;
    this.hitstop = d.super ? 9 : heavy ? 9 : 6;
    if (heavy) this.shake = d.super ? 14 : 8;
    (heavy ? Sfx.hitHeavy : Sfx.hitLight)();
    const hy = o.projectile ? this.groundY - 175 : this.groundY - (att.y + (d.hbY[0] + d.hbY[1]) / 2);
    const hx = o.srcX ?? (def.x - dirAway * def.hurtW * 0.6);
    this.spark(hx, Math.min(this.groundY - 20, hy), d.special || d.super ? att.vis.color : '#ffe9a0', heavy ? 22 : 12);
    if (def.comboHits >= 2) this.combos[att.side] = { hits: def.comboHits, dmg: def.comboDamage, t: 90 };
    return 'hit';
  }

  triggerCounter(def, att) {
    const cd = def.move.def;
    Sfx.counter();
    this.popText(def, 'COUNTER!', '#7dffd2');
    this.hitstop = 12;
    def.invuln = 12;
    att.move = null;
    if (cd.damage > 0) {
      // カウンター成立：攻撃側へダメージ
      const dmg = cd.damage;
      att.hp = Math.max(0, att.hp - dmg);
      att.comboHits++; att.comboDamage += dmg;
      att.state = 'fall'; att.stateT = 0; att.vy = 10; att.y = Math.max(att.y, 0.1);
      att.vx = (Math.sign(att.x - def.x) || -def.facing) * 5;
      att.flash = 8;
      this.shake = cd.super ? 16 : 8;
      this.spark(att.x, this.groundY - 180, def.vis.color, 28);
      def.gainMeter(cd.super ? 0 : 10);
      Sfx.hitHeavy();
    } else {
      // Water Mirror：相手をよろけさせ、次の反撃を強化
      att.state = 'hitstun'; att.stateT = 0; att.hitstun = 34; att.vx = 0;
      def.punishBoost = 120;
      this.spark(def.x + def.facing * 50, this.groundY - 180, def.vis.color, 16);
    }
    const { total } = def.moveTimes();
    def.move.f = Math.max(def.move.f, total - 8);
    def.move.slots.add(0);
  }

  doGrab(att, def, d) {
    att.move.grabbed = true;
    att.state = 'throwing'; att.stateT = 0; att.grabT = d.grabTime; att.vx = 0;
    def.state = 'thrown'; def.stateT = 0; def.thrownBy = att; def.grabTimer = 0; def.grabDur = d.grabTime;
    def.grabHits = d.grabHits || 1; def.grabChunks = def.grabHits > 1 ? def.grabHits - 1 : 0; def.grabMove = d;
    def.move = null;
    this.hitstop = 6;
    Sfx.throwSnd();
    if (d.category !== 'Throw') this.popText(att, d.name.split(' / ')[0].toUpperCase(), att.vis.color2);
  }

  grabDamage(att, def, frac) {
    const d = def.grabMove;
    let dmg = d.damage * frac;
    // VIKTOR Iron Frame：画面端付近でコマンド投げ+20%
    if (att.id === 'VIKTOR' && d.category !== 'Throw' && this.atWall(def, 180)) dmg *= 1.2;
    return Math.round(dmg);
  }

  grabChunk(att, def) {
    const dmg = this.grabDamage(att, def, 1 / def.grabHits);
    def.hp = Math.max(0, def.hp - dmg);
    def.comboHits++; def.comboDamage += dmg;
    def.grabChunks--;
    def.flash = 5;
    this.shake = 8; this.hitstop = 5;
    this.spark(def.x, this.groundY - def.y - 120, att.vis.color, 16);
    Sfx.hitHeavy();
  }

  finishThrow(att, def) {
    const frac = def.grabHits > 1 ? 1 / def.grabHits : 1;
    const dmg = this.grabDamage(att, def, frac);
    def.hp = Math.max(0, def.hp - dmg);
    def.comboHits++; def.comboDamage += dmg;
    def.state = 'fall'; def.stateT = 0; def.vy = 9; def.y = Math.max(def.y, 0.1);
    def.vx = att.facing * 6; def.juggle = true;
    def.flash = 6;
    att.gainMeter(def.grabMove.super ? 0 : 8); def.gainMeter(4);
    this.shake = 12; this.hitstop = 8;
    this.spark(def.x, this.groundY - def.y - 60, att.vis.color, 26);
    this.addDust(def.x);
    Sfx.hitHeavy();
    if (def.comboHits >= 2) this.combos[att.side] = { hits: def.comboHits, dmg: def.comboDamage, t: 90 };
    if (att.state === 'throwing' && !att.grounded) att.stateT = att.grabT;
  }

  atWall(f, margin = 8) { return f.x <= this.wallL + margin || f.x >= this.wallR - margin; }

  // ---------------- エフェクト ----------------
  spark(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, s = 3 + rand() * 9;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 14 + rand() * 10, max: 24, size: 2 + rand() * 4, color, type: 'spark' });
    }
    this.particles.push({ x, y, life: 12, max: 12, size: 10, color, type: 'ring' });
  }
  burst(x, y, color, n) { this.spark(x, y, color, n); }
  addDust(x) {
    for (let i = 0; i < 12; i++) {
      this.particles.push({ x: x + (rand() - 0.5) * 120, y: this.groundY - 5, vx: (rand() - 0.5) * 3, vy: -rand() * 2, life: 30, max: 30, size: 10 + rand() * 16, color: 'rgba(200,190,170,1)', type: 'dust' });
    }
  }
  addAfterimage(f) {
    this.particles.push({ x: f.x, y: this.groundY - f.y, life: 24, max: 24, type: 'ghost', f, facing: f.facing });
  }
  popText(f, text, color) {
    this.texts.push({ x: f.x, y: this.groundY - f.hurtH - 30, text, color, t: 60 });
  }
  updateParticles() {
    for (const p of this.particles) {
      p.life--;
      if (p.vx !== undefined) { p.x += p.vx; p.y += p.vy; if (p.type === 'spark') { p.vx *= 0.9; p.vy = p.vy * 0.9 + 0.3; } }
    }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const t of this.texts) { t.t--; t.y -= 0.6; }
    this.texts = this.texts.filter(t => t.t > 0);
    for (let i = 0; i < 2; i++) {
      if (this.banners[i] && --this.banners[i].t <= 0) this.banners[i] = null;
      if (this.combos[i] && --this.combos[i].t <= 0) this.combos[i] = null;
    }
  }

  // ---------------- 描画 ----------------
  draw(ctx) {
    const W = 1280, H = 720, F = this.fighters;
    ctx.save();
    if (this.shake > 0) ctx.translate((rand() - 0.5) * this.shake, (rand() - 0.5) * this.shake * 0.6);

    // ステージ背景（パララックス）
    const img = ASSETS.stages[this.opts.stage];
    const mid = (F[0].x + F[1].x) / 2;
    const bw = 1360, bh = bw * img.height / img.width;
    const bx = (W - bw) / 2 - (mid - 640) * 0.06;
    ctx.drawImage(img, bx, H - bh + 20, bw, bh);
    const g = ctx.createLinearGradient(0, this.groundY - 120, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(-20, this.groundY - 120, W + 40, H);

    // 残像（テレポート）
    for (const p of this.particles) if (p.type === 'ghost') {
      const a = ASSETS.chars[p.f.id], s = p.f.vis.height / a.bodyH;
      ctx.save();
      ctx.globalAlpha = 0.5 * p.life / p.max;
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(p.x, p.y);
      ctx.scale((p.f.vis.facing === 'right' ? 1 : -1) * p.facing * s, s);
      ctx.drawImage(a.tint, -a.anchorX, -a.footY);
      ctx.restore();
    }

    // 攻撃中のキャラを手前に
    const order = [...F].sort((a, b) => (a.state === 'attack' || a.state === 'throwing' ? 1 : 0) - (b.state === 'attack' || b.state === 'throwing' ? 1 : 0));
    for (const f of order) f.draw(ctx, this.groundY);

    this.drawProjectiles(ctx);
    this.drawParticles(ctx);

    for (const t of this.texts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.t / 20);
      ctx.font = 'italic 900 30px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = '#000';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
    ctx.restore();

    if (this.superFreeze) this.drawSuperCutin(ctx);
    this.drawHUD(ctx);
    this.drawPhaseText(ctx);
  }

  drawProjectiles(ctx) {
    const t = this.frame;
    for (const p of this.projectiles) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const y = this.groundY - p.y;
      if (p.kind === 'rift') {
        const active = p.delay <= 0;
        const h = active ? 300 : 300 * (1 - p.delay / 6);
        const gr = ctx.createLinearGradient(p.x - 50, 0, p.x + 50, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, p.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.ellipse(p.x, this.groundY - h / 2, 30 + Math.sin(t * 0.7) * 8, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#05050f';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.ellipse(p.x, this.groundY - h / 2, 8, h / 2.3, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.owner.id === 'AKARI') {
        // クナイ
        ctx.translate(p.x, y);
        ctx.scale(Math.sign(p.vx), 1);
        ctx.fillStyle = p.color; ctx.globalAlpha = 0.5;
        ctx.fillRect(-60, -3, 60, 6);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e8e8f0';
        ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(0, -8); ctx.lineTo(-6, 0); ctx.lineTo(0, 8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = p.color; ctx.fillRect(-22, -3, 16, 6);
      } else if (p.style === 'wave') {
        ctx.translate(p.x, this.groundY);
        ctx.scale(Math.sign(p.vx), 1);
        const gr = ctx.createRadialGradient(0, 0, 5, 0, 0, 70);
        gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, p.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.ellipse(0, -20, 45, 45 + Math.sin(t) * 6, 0, Math.PI, 0); ctx.fill();
      } else {
        const r = p.r * (p.style === 'palm' ? 1.4 : 1.2);
        const gr = ctx.createRadialGradient(p.x, y, 2, p.x, y, r * 1.6);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, p.color2); gr.addColorStop(0.6, p.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.ellipse(p.x, y, r * 1.6 + Math.sin(t * 0.9) * 3, r * (p.style === 'palm' ? 1.5 : 1.1), 0, 0, Math.PI * 2);
        ctx.fill();
        if (p.owner.id === 'NOIR') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = 'rgba(5,5,20,0.85)';
          ctx.beginPath(); ctx.arc(p.x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const a = p.life / p.max;
      ctx.save();
      if (p.type === 'spark' || p.type === 'glow') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.type === 'glow' ? a : 1), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'ring') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color; ctx.lineWidth = 5 * a + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size + (1 - a) * 70, 0, Math.PI * 2); ctx.stroke();
      } else if (p.type === 'dust') {
        ctx.globalAlpha = a * 0.35;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.5 - a * 0.5), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawSuperCutin(ctx) {
    const sf = this.superFreeze, f = sf.f;
    const p = 1 - sf.t / 50;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,10,0.6)';
    ctx.fillRect(0, 0, 1280, 720);
    // 帯
    const bandY = 230, bandH = 230;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, bandY + 30); ctx.lineTo(1280, bandY); ctx.lineTo(1280, bandY + bandH - 30); ctx.lineTo(0, bandY + bandH);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 1280, 0);
    g.addColorStop(0, f.vis.color); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.globalAlpha = 0.85; ctx.fill();
    ctx.clip();
    ctx.globalAlpha = 1;
    // 集中線
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
    for (let i = 0; i < 20; i++) {
      const yy = bandY + ((i * 37 + this.frame * 23) % bandH);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(1280, yy - 30); ctx.stroke();
    }
    const slide = f.side === 0 ? -300 + Math.min(1, p * 3) * 420 : 1280 - Math.min(1, p * 3) * 420 - 300;
    drawPortrait(ctx, f.id, slide + 30, bandY - 10, 560, bandH + 20, f.side === 1);
    ctx.restore();
    ctx.font = 'italic 900 44px "Arial Black", Impact, sans-serif';
    ctx.textAlign = f.side === 0 ? 'right' : 'left';
    const tx = f.side === 0 ? 1240 : 40;
    ctx.lineWidth = 8; ctx.strokeStyle = '#000';
    const nm = sf.mv.name.split(' / ');
    ctx.strokeText(nm[0], tx, bandY + 120);
    ctx.fillStyle = '#fff'; ctx.fillText(nm[0], tx, bandY + 120);
    if (nm[1]) {
      ctx.font = '900 34px "Yu Gothic", "Meiryo", sans-serif';
      ctx.strokeText(nm[1], tx, bandY + 170);
      ctx.fillStyle = f.vis.color2; ctx.fillText(nm[1], tx, bandY + 170);
    }
    ctx.restore();
  }

  drawHUD(ctx) {
    const F = this.fighters;
    ctx.save();
    for (let i = 0; i < 2; i++) {
      const f = F[i];
      const left = i === 0;
      const barW = 470, barH = 26, y = 34;
      const x0 = left ? 100 : 1280 - 100 - barW;
      // ポートレート
      ctx.save();
      ctx.fillStyle = '#111';
      const px = left ? 14 : 1280 - 14 - 76;
      ctx.fillRect(px, 18, 76, 76);
      drawPortrait(ctx, f.id, px, 18, 76, 76, !left);
      ctx.strokeStyle = f.vis.color; ctx.lineWidth = 3; ctx.strokeRect(px, 18, 76, 76);
      ctx.restore();
      // HPバー
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x0 - 4, y - 4, barW + 8, barH + 8);
      ctx.fillStyle = '#3a0a0a'; ctx.fillRect(x0, y, barW, barH);
      const lag = Math.max(0, this.hpLag[i] / f.maxHp), hp = Math.max(0, f.hp / f.maxHp);
      const fill = (ratio, color) => {
        const w = barW * ratio;
        if (left) ctx.fillRect(x0 + barW - w, y, w, barH); else ctx.fillRect(x0, y, w, barH);
      };
      ctx.fillStyle = '#ff5a3a'; fill(lag);
      const hg = ctx.createLinearGradient(0, y, 0, y + barH);
      const low = hp < 0.3;
      hg.addColorStop(0, low ? '#ff9a3a' : '#fff27a'); hg.addColorStop(1, low ? '#d8401a' : '#e8b400');
      ctx.fillStyle = hg; fill(hp);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x0, y, barW, barH);
      // 名前 & ラウンド勝利
      ctx.font = 'italic 900 20px "Arial Black", Impact, sans-serif';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      const nx = left ? x0 : x0 + barW;
      ctx.strokeText(f.def.display_name, nx, y + barH + 24);
      ctx.fillStyle = '#fff'; ctx.fillText(f.def.display_name, nx, y + barH + 24);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${Math.ceil(Math.max(0, f.hp))} / ${f.maxHp}`, left ? x0 + 4 : x0 + barW - 4, y + barH - 7);
      for (let w = 0; w < this.rules.rounds_to_win; w++) {
        const cx = left ? x0 + barW - 12 - w * 26 : x0 + 12 + w * 26;
        ctx.beginPath(); ctx.arc(cx, y + barH + 18, 9, 0, Math.PI * 2);
        ctx.fillStyle = w < this.wins[i] ? '#ffd23a' : 'rgba(0,0,0,0.6)';
        ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      }
      // メーター
      const mW = 300, mH = 16, my = 680;
      const mx = left ? 30 : 1280 - 30 - mW;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(mx - 3, my - 3, mW + 6, mH + 6);
      const mr = f.meter / 100;
      const isVoid = f.meterType === 'VOID';
      const mg = ctx.createLinearGradient(mx, 0, mx + mW, 0);
      if (isVoid) { mg.addColorStop(0, '#1a1a60'); mg.addColorStop(1, '#6a7cff'); }
      else { mg.addColorStop(0, '#0a60ff'); mg.addColorStop(1, '#40e8ff'); }
      ctx.fillStyle = mr >= 1 ? (this.frame % 20 < 10 ? '#ffffff' : (isVoid ? '#8a9aff' : '#60f0ff')) : mg;
      if (left) ctx.fillRect(mx, my, mW * mr, mH); else ctx.fillRect(mx + mW * (1 - mr), my, mW * mr, mH);
      // 20刻み
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(mx + mW * k / 5, my); ctx.lineTo(mx + mW * k / 5, my + mH); ctx.stroke(); }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(mx, my, mW, mH);
      ctx.font = 'italic 900 18px "Arial Black", Impact, sans-serif';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      const lbl = `${f.meterType} ${mr >= 1 ? 'MAX' : Math.floor(f.meter)}`;
      const lx = left ? mx : mx + mW;
      ctx.strokeText(lbl, lx, my - 8);
      ctx.fillStyle = isVoid ? '#b0baff' : '#80f0ff'; ctx.fillText(lbl, lx, my - 8);
      // 技名バナー
      const bn = this.banners[i];
      if (bn) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, bn.t / 15);
        ctx.font = `italic 900 ${bn.super ? 26 : 20}px "Arial Black", "Yu Gothic", sans-serif`;
        ctx.textAlign = left ? 'left' : 'right';
        const bx = left ? 30 : 1250;
        ctx.lineWidth = 5; ctx.strokeStyle = '#000';
        ctx.strokeText(bn.name, bx, 150);
        ctx.fillStyle = bn.super ? '#ffd23a' : f.vis.color2; ctx.fillText(bn.name, bx, 150);
        ctx.restore();
      }
      // コンボ
      const cb = this.combos[i];
      if (cb) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, cb.t / 15);
        ctx.textAlign = left ? 'left' : 'right';
        const cx = left ? 30 : 1250;
        ctx.font = 'italic 900 46px "Arial Black", Impact, sans-serif';
        ctx.lineWidth = 7; ctx.strokeStyle = '#000';
        ctx.strokeText(`${cb.hits} HITS`, cx, 230);
        ctx.fillStyle = '#ffd23a'; ctx.fillText(`${cb.hits} HITS`, cx, 230);
        ctx.font = 'italic 900 20px "Arial Black", Impact, sans-serif';
        ctx.strokeText(`${cb.dmg} DAMAGE`, cx, 258);
        ctx.fillStyle = '#fff'; ctx.fillText(`${cb.dmg} DAMAGE`, cx, 258);
        ctx.restore();
      }
    }
    // タイマー
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(598, 16, 84, 64);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(598, 16, 84, 64);
    ctx.font = '900 44px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    const sec = this.training ? '∞' : String(Math.ceil(this.timer / 60)).padStart(2, '0');
    ctx.fillStyle = !this.training && this.timer < 600 ? '#ff5050' : '#fff';
    ctx.fillText(sec, 640, 66);
    if (this.training) {
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`TRAINING  |  DUMMY: ${this.dummyMode}  (ESCでメニュー)`, 640, 110);
    }
    ctx.restore();
  }

  drawPhaseText(ctx) {
    let text = null, sub = null, color = '#fff';
    if (this.phase === 'intro') {
      if (this.phaseT < 70) {
        const last = this.wins[0] === this.rules.rounds_to_win - 1 && this.wins[1] === this.rules.rounds_to_win - 1;
        text = last ? 'FINAL ROUND' : `ROUND ${this.round}`;
      } else { text = 'FIGHT!'; color = '#ffd23a'; }
    } else if (this.phase === 'ko') { text = 'K.O.'; color = '#ff3030'; }
    else if (this.phase === 'timeover') { text = 'TIME OVER'; color = '#ffd23a'; }
    else if (this.phase === 'roundEnd' || this.phase === 'matchEnd') {
      const w = this.roundWinner;
      text = w < 0 ? 'DRAW' : `${this.fighters[w].def.display_name.split(' ')[0]} WINS`;
      const f = w >= 0 ? this.fighters[w] : null;
      if (f && f.hp >= f.maxHp) sub = 'PERFECT';
      color = '#fff';
    }
    if (!text) return;
    ctx.save();
    ctx.textAlign = 'center';
    const scale = this.phase === 'intro' ? 1 + Math.max(0, 1 - (this.phaseT % 70) / 10) * 0.6 : 1;
    ctx.translate(640, 330);
    ctx.scale(scale, scale);
    ctx.font = 'italic 900 96px "Arial Black", Impact, sans-serif';
    ctx.lineWidth = 12; ctx.strokeStyle = '#000';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color; ctx.fillText(text, 0, 0);
    if (sub) {
      ctx.font = 'italic 900 48px "Arial Black", Impact, sans-serif';
      ctx.strokeText(sub, 0, 70); ctx.fillStyle = '#ffd23a'; ctx.fillText(sub, 0, 70);
    }
    ctx.restore();
  }
}

function mergeInputs(a, b) {
  const o = {};
  for (const k in a) o[k] = a[k] || b[k];
  return o;
}

// ============================================================
// CPU (レベル1〜5: game_rules.cpu_levels)
// ============================================================
class CPU {
  constructor(level, side, battle) {
    const L = Math.max(1, Math.min(5, level)) - 1;
    this.level = L + 1;
    this.side = side; this.battle = battle;
    this.react = [30, 20, 13, 8, 4][L];
    this.blockP = [0.08, 0.3, 0.55, 0.78, 0.92][L];
    this.aggr = [0.3, 0.45, 0.6, 0.7, 0.8][L];
    this.specialP = [0.12, 0.25, 0.4, 0.55, 0.65][L];
    this.comboP = [0, 0.2, 0.5, 0.8, 0.95][L];
    this.aaP = [0.05, 0.2, 0.45, 0.7, 0.9][L];
    this.punishP = [0.05, 0.2, 0.45, 0.7, 0.9][L];
    this.hist = [];
    this.plan = 'wait'; this.planT = 0;
    this.blockHold = 0; this.blockLow = false;
    this.rolled = new WeakSet();
    this.punished = new WeakSet();
    this.aaRolled = -1;
    this.cancelTried = null;
  }
  get me() { return this.battle.fighters[this.side]; }

  snapshot(o) {
    const s = { x: o.x, y: o.y, state: o.state, grounded: o.grounded, vx: o.vx, vy: o.vy, move: null, level: 'mid', recovering: false, threat: false };
    if (o.state === 'attack') {
      const { st, ae } = o.moveTimes();
      s.move = o.move; s.level = o.move.def.level;
      s.threat = o.move.f < ae; s.recovering = o.move.f >= ae;
      s.reach = o.move.def.reach;
    }
    return s;
  }

  tryMove(mv) {
    const me = this.me;
    if (!mv || !me.canAfford(mv)) return false;
    if (!!mv.air === me.grounded) return false;
    me.startMove(mv);
    return true;
  }
  findSpecial(filter) {
    const list = this.me.specials.filter(m => this.me.canAfford(m) && !!m.air === !this.me.grounded && filter(m));
    return list.length ? pick(list) : null;
  }

  think() {
    const b = this.battle, me = this.me, o = me.opp;
    const inp = { up: false, down: false, left: false, right: false, P: false, K: false, Pp: false, Kp: false };
    if (b.phase !== 'fight') return inp;
    this.hist.push(this.snapshot(o));
    while (this.hist.length > this.react) this.hist.shift();
    const seen = this.hist[0];
    const fwd = me.facing === 1 ? 'right' : 'left', back = me.facing === 1 ? 'left' : 'right';
    const dist = Math.abs(o.x - me.x);

    // コンボ継続（キャンセル）
    if (me.state === 'attack') {
      if (me.canCancel() && this.cancelTried !== me.move) {
        this.cancelTried = me.move;
        if (rand() < this.comboP) {
          const sup = me.meter >= 100 && rand() < 0.5 ? this.findSpecial(m => m.super && m.kind === 'strike' && m.reach + 60 > dist) : null;
          const mv = sup || this.findSpecial(m => !m.super && (m.kind === 'strike' || m.kind === 'projectile') && m.reach + 60 > dist && !m.teleport);
          if (mv) me.startMove(mv);
        }
      }
      return inp;
    }
    // ガード継続
    if (me.state === 'blockstun' || this.blockHold > 0) {
      this.blockHold--;
      inp[back] = true; if (this.blockLow) inp.down = true;
      return inp;
    }
    // 空中
    if (me.state === 'jump') {
      if (me.vy < 2 && dist < 170 && rand() < 0.25) {
        const air = rand() < this.specialP ? this.findSpecial(m => m.air && m.kind !== 'grab') : null;
        if (air) this.tryMove(air);
        else if (!me.airAttackUsed) { me.airAttackUsed = true; me.startMove(rand() < 0.6 ? me.normals.jK : me.normals.jP); }
      }
      if (me.meter >= 20 && dist < 200 && o.y > 40) { const ag = this.findSpecial(m => m.airGrab); if (ag) this.tryMove(ag); }
      return inp;
    }
    if (!me.actionable) return inp;

    // 防御：攻撃・飛び道具を見てから
    if (seen.threat && seen.move && dist < (seen.reach || 150) + 140 && !this.rolled.has(seen.move)) {
      this.rolled.add(seen.move);
      const ctr = seen.level !== 'low' && this.level >= 3 && rand() < 0.3 ? this.findSpecial(m => m.kind === 'counter' || m.counterAlso) : null;
      if (ctr && this.tryMove(ctr)) return inp;
      if (rand() < this.blockP) {
        this.blockHold = 22;
        this.blockLow = seen.level === 'low' || (seen.level === 'mid' && seen.grounded && rand() < 0.5);
        if (seen.level === 'high' || !seen.grounded) this.blockLow = false;
        inp[back] = true; if (this.blockLow) inp.down = true;
        return inp;
      }
    }
    for (const p of b.projectiles) {
      if (p.owner === me || this.rolled.has(p)) continue;
      if (b.frame - p.born < this.react) continue;
      this.rolled.add(p);
      if (p.kind === 'rift' || Math.abs(p.x - me.x) < 500) {
        const r = rand();
        if (r < this.blockP * 0.7) { this.blockHold = 30; this.blockLow = p.d.level === 'low'; inp[back] = true; if (this.blockLow) inp.down = true; return inp; }
        if (r < this.blockP && p.kind === 'proj') {
          const pr = this.findSpecial(m => m.kind === 'projectile');
          if (pr) { this.tryMove(pr); return inp; }
          inp.up = true; inp[fwd] = true; return inp;
        }
      }
    }
    // 対空
    if (!seen.grounded && seen.state !== 'fall' && seen.state !== 'thrown' && dist < 260 && Math.sign(seen.vx || 0) !== Math.sign(seen.x - me.x) && this.aaRolled !== b.frame >> 5) {
      if (seen.y < 230 && dist < 200) {
        this.aaRolled = b.frame >> 5;
        if (rand() < this.aaP) {
          const aa = this.findSpecial(m => m.rise);
          if (aa) { this.tryMove(aa); return inp; }
          me.startMove(me.normals['5K']); return inp;
        } else if (rand() < this.blockP) { this.blockHold = 25; this.blockLow = false; inp[back] = true; return inp; }
      }
    }
    // 反撃（相手の硬直）
    if (seen.recovering && seen.move && dist < 220 && !this.punished.has(seen.move)) {
      this.punished.add(seen.move);
      if (rand() < this.punishP) {
        const mv = me.meter >= 100 && rand() < 0.5 ? this.findSpecial(m => m.super && (m.reach + 50 > dist)) :
          this.findSpecial(m => !m.super && m.kind === 'strike' && m.reach + 50 > dist);
        if (mv && this.tryMove(mv)) return inp;
        me.startMove(dist < 130 ? me.normals['5P'] : me.normals['5K']);
        return inp;
      }
    }

    // 攻め
    this.planT--;
    if (this.planT <= 0) this.choosePlan(dist);
    switch (this.plan) {
      case 'approach': inp[fwd] = true; break;
      case 'retreat': inp[back] = true; break;
      case 'crouch': inp.down = true; break;
      case 'block': inp[back] = true; inp.down = true; break;
      case 'jump': inp.up = true; inp[fwd] = true; this.plan = 'wait'; break;
      case 'dash':
        // ダッシュは直接開始
        me.startDash(1); this.plan = 'wait'; break;
      case 'attack': {
        this.plan = 'wait';
        const reach5K = me.normals['5K'].reach + o.hurtW;
        if (me.meter >= 100 && rand() < 0.08 * this.level) {
          const sup = this.findSpecial(m => m.super && (m.kind === 'grab' ? dist < 150 : m.reach + o.hurtW > dist));
          if (sup && this.tryMove(sup)) break;
        }
        if (rand() < this.specialP) {
          const mv = this.findSpecial(m => !m.super && !m.stance && (
            m.kind === 'projectile' ? dist > 200 :
            m.kind === 'rift' ? dist > 250 :
            m.kind === 'grab' ? dist < 150 :
            m.kind === 'counter' ? false :
            m.reach + o.hurtW + (m.dashSpeed ? 150 : m.advance * 10) > dist));
          if (mv && this.tryMove(mv)) break;
        }
        if (dist < 140 && o.grounded && rand() < 0.3 && me.canBeGrabbed(o)) { me.startMove(me.normals.throw); break; }
        if (dist < me.normals['5P'].reach + o.hurtW && rand() < 0.4) me.startMove(me.normals[rand() < 0.5 ? '5P' : '2P']);
        else if (dist < reach5K) me.startMove(me.normals[rand() < 0.35 ? '2K' : '5K']);
        else inp[fwd] = true;
        break;
      }
    }
    return inp;
  }

  choosePlan(dist) {
    const me = this.me;
    const hasProj = me.specials.some(m => m.kind === 'projectile' || m.kind === 'rift');
    const r = rand();
    if (dist > 380) {
      if (hasProj && r < this.specialP) { this.plan = 'attack'; this.planT = 1; return; }
      if (r < 0.6 + this.aggr * 0.2) { this.plan = 'approach'; this.planT = 20 + rand() * 30; }
      else if (r < 0.75) { this.plan = 'dash'; this.planT = 20; }
      else if (r < 0.85) { this.plan = 'jump'; this.planT = 30; }
      else { this.plan = 'wait'; this.planT = 15 + rand() * 20; }
    } else if (dist > 190) {
      if (r < this.aggr * 0.45) { this.plan = 'attack'; this.planT = 1; }
      else if (r < this.aggr * 0.45 + 0.3) { this.plan = 'approach'; this.planT = 10 + rand() * 20; }
      else if (r < 0.85) { this.plan = 'jump'; this.planT = 35; }
      else { this.plan = 'retreat'; this.planT = 10 + rand() * 15; }
    } else {
      if (r < this.aggr) { this.plan = 'attack'; this.planT = 4 + rand() * 10; }
      else if (r < this.aggr + 0.12) { this.plan = 'block'; this.planT = 12 + rand() * 12; }
      else if (r < this.aggr + 0.2) { this.plan = 'retreat'; this.planT = 10 + rand() * 12; }
      else { this.plan = 'wait'; this.planT = 6 + rand() * 12; }
    }
  }
}

// ポートレート（顔中心で切り抜き）
function drawPortrait(ctx, id, x, y, w, h, flip) {
  const a = ASSETS.chars[id];
  const vis = DATA.byId[id].visual;
  if (!a) return;
  const cw = a.W * 0.55;
  const ch = cw * h / w;
  let sx = vis.fx * a.W - cw / 2;
  let sy = vis.fy * a.H - ch * 0.38;
  sx = Math.max(0, Math.min(a.W - cw, sx));
  sy = Math.max(0, Math.min(a.H - ch, sy));
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const baseRight = vis.facing === 'right';
  // 左側(P1)は右向き、右側(P2)は左向きで表示
  const needFlip = flip ? baseRight : !baseRight;
  if (needFlip) {
    ctx.translate(x + w, y); ctx.scale(-1, 1);
    ctx.drawImage(a.canvas, sx, sy, cw, ch, 0, 0, w, h);
  } else ctx.drawImage(a.canvas, sx, sy, cw, ch, x, y, w, h);
  ctx.restore();
}

'use strict';
// ============================================================
// 効果音（WebAudioで合成。音声ファイルは使用しない）
// ============================================================
const Sfx = (() => {
  let ctx = null, master = null, muted = false, noiseBuf = null;
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }
  function env(g, t, a, d, v) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noise(dur, freq, q, vol, type = 'bandpass') {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.005, dur, vol);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }
  function tone(type, f0, f1, dur, vol) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); env(g, t, 0.005, dur, vol);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  return {
    unlock,
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
    hitLight() { noise(0.08, 1800, 1, 0.8); tone('square', 220, 80, 0.07, 0.3); },
    hitHeavy() { noise(0.18, 900, 0.8, 1); tone('sine', 140, 40, 0.22, 0.9); },
    block() { noise(0.05, 3500, 3, 0.5); tone('triangle', 900, 600, 0.05, 0.2); },
    whoosh() { noise(0.12, 1200, 0.6, 0.25, 'highpass'); },
    special() { tone('sawtooth', 200, 700, 0.18, 0.2); noise(0.2, 2000, 0.7, 0.3); },
    projectile() { tone('sawtooth', 500, 150, 0.3, 0.2); noise(0.25, 700, 1, 0.3); },
    superFlash() { tone('sawtooth', 80, 900, 0.6, 0.35); tone('square', 160, 1800, 0.5, 0.15); noise(0.5, 3000, 0.5, 0.3); },
    throwSnd() { tone('sine', 120, 50, 0.3, 0.9); noise(0.25, 400, 0.8, 0.8); },
    ko() { tone('sine', 100, 30, 1.2, 1); noise(1.0, 300, 0.5, 0.8); },
    cursor() { tone('square', 880, 880, 0.04, 0.12); },
    confirm() { tone('square', 660, 1320, 0.12, 0.18); },
    cancel() { tone('square', 440, 220, 0.1, 0.15); },
    counter() { tone('triangle', 1400, 2800, 0.2, 0.3); noise(0.15, 5000, 2, 0.4); },
    announce(text) {
      if (muted || !window.speechSynthesis) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US'; u.rate = 0.95; u.pitch = 0.6; u.volume = 0.9;
        speechSynthesis.speak(u);
      } catch (e) { /* ignore */ }
    },
  };
})();

// ============================================================
// BGM（music フォルダの MP3 をバトル中にループ再生）
// 曲リスト: ローカルは api/music、公開版は music.json（ビルド時に生成）
// ============================================================
const Bgm = (() => {
  let tracks = [], el = null, owner = null, state = 'stopped', fadeTimer = null;
  const VOLUME = 0.45;
  async function load() {
    for (const url of ['api/music', 'music.json']) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) { tracks = await res.json(); return; }
      } catch (e) { /* 次を試す */ }
    }
  }
  function fade(to, ms, done) {
    clearInterval(fadeTimer);
    const from = el.volume, steps = Math.max(1, Math.round(ms / 30));
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      el.volume = Math.max(0, Math.min(1, from + (to - from) * i / steps));
      if (i >= steps) { clearInterval(fadeTimer); done && done(); }
    }, 30);
  }
  // 毎フレーム呼ぶ：want = 'playing' | 'paused' | 'stopped'、battle = 現在のバトル（変わったら選曲し直す）
  function sync(want, battle, muted) {
    if (!tracks.length) return;
    if (want !== 'stopped' && owner !== battle) {
      owner = battle;
      if (el) { el.pause(); }
      el = new Audio(encodeURI('music/' + tracks[Math.floor(Math.random() * tracks.length)]));
      el.loop = true; el.volume = 0; state = 'stopped';
    }
    if (!el) return;
    el.muted = muted;
    if (want === state) return;
    if (want === 'playing') {
      const p = el.play();
      if (p && p.catch) p.catch(() => { state = 'stopped'; }); // 自動再生が拒否された場合は次の操作で再試行
      fade(VOLUME, state === 'paused' ? 200 : 1200);
    } else if (want === 'paused') {
      fade(0.12, 200);
    } else {
      const cur = el;
      fade(0, 800, () => cur.pause());
      owner = null;
    }
    state = want;
  }
  return { load, sync, get tracks() { return tracks; }, get audio() { return el; }, get state() { return state; } };
})();

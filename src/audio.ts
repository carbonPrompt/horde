// Sound (0.15): recorded-style samples generated locally (Stable Audio Open), embedded at build time as
// HORDE_SFX {name: data URL}. Every effect falls back to the old Web Audio synthesis when its sample is missing.
// Nothing plays until the first click or key press (browsers require a user gesture).
import type { UnitKind } from "./config";

type Track = "title" | "battle";
const MUSIC: Partial<Record<Track, string>> = (globalThis as any).HORDE_MUSIC ?? {};
const SFX: Record<string, string> = (globalThis as any).HORDE_SFX ?? {};

/** Which samples each unit fires (variations are picked at random). */
const SHOT: Partial<Record<UnitKind, string[]>> = {
  garrison: ["rifle-1", "rifle-2"], militia: ["rifle-1", "rifle-2"], para: ["rifle-2", "rifle-1"],
  sniper: ["sniper-1", "sniper-2"], turret: ["hmg-1"], gunboat: ["hmg-1"], apc: ["mg-1"], tank: ["mg-1"],
  mortar: ["mortar-1"], howitzer: ["howitzer-1"], himars: ["rocket-1"], battleship: ["naval-1"],
  apache: ["chaingun-1"], reaper: ["missile-1"], police: ["pistol-1"],
};
/** Fewest milliseconds between two shots of one kind: many guns at once sound like one busy one. */
const GAP: Partial<Record<UnitKind, number>> = { garrison: 140, militia: 160, para: 160, police: 180, turret: 220, gunboat: 240, apc: 220, tank: 220, apache: 260 };
/** Looping beds and what drives them. */
const LOOPS = ["horde-far-1", "horde-close-1", "crowd-panic-1", "crowd-far-1", "fire-1", "siren-1"] as const;
type Loop = typeof LOOPS[number];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private mus!: GainNode;
  private noise!: AudioBuffer;
  private buf: Record<string, AudioBuffer> = {};
  private lastShot: Record<string, number> = {};
  private lastBoom = 0;
  private loops: Partial<Record<Loop, GainNode>> = {};
  private amb: { g: GainNode; f: BiquadFilterNode } | null = null; // synth fallback bed
  private fire: GainNode | null = null;
  private track: Track | null = null;
  private musicEl: Record<string, HTMLAudioElement> = {};
  private vol = { master: 0.8, sfx: 0.8, music: 0.5 };

  /** Call from a user gesture. Safe to call often. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain(); this.master.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.connect(this.master);
      this.mus = ctx.createGain(); this.mus.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      this.startAmbience();
      this.loadSamples();
      if (this.track) { const t = this.track; this.track = null; this.music(t); }
    } catch { this.ctx = null; }
  }

  /** Decode the embedded samples in the background; loops start as soon as theirs is ready. */
  private loadSamples() {
    const ctx = this.ctx!;
    for (const [name, url] of Object.entries(SFX)) {
      try {
        const b64 = url.slice(url.indexOf(",") + 1), bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        ctx.decodeAudioData(bytes.buffer).then(ab => {
          this.buf[name] = ab;
          if ((LOOPS as readonly string[]).includes(name)) this.startLoop(name as Loop);
        }).catch(() => { /* a bad sample just falls back to synthesis */ });
      } catch { /* ditto */ }
    }
  }

  private startLoop(name: Loop) {
    const ctx = this.ctx!, ab = this.buf[name];
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.sfx);
    // two copies, half a clip apart, each fading in and out: hides the seam of a clip that was not made to loop
    const len = ab.duration;
    const play = (at: number) => {
      const src = ctx.createBufferSource(); src.buffer = ab;
      const env = ctx.createGain(); env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(1, at + len * 0.25); env.gain.setValueAtTime(1, at + len * 0.75);
      env.gain.linearRampToValueAtTime(0, at + len);
      src.connect(env); env.connect(g); src.start(at); src.stop(at + len + 0.05);
      src.onended = () => { if (this.ctx) play(Math.max(this.ctx.currentTime, at + len)); };
    };
    const t = ctx.currentTime + 0.05;
    play(t); play(t + len * 0.5);
    this.loops[name] = g;
  }

  setVolumes(master: number, sfx: number, music: number) { this.vol = { master, sfx, music }; this.applyVolumes(); }
  private applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfx.gain.value = this.vol.sfx;
    this.mus.gain.value = this.vol.music;
    for (const el of Object.values(this.musicEl)) el.volume = Math.min(1, this.vol.master * this.vol.music);
  }

  /** Play a sample; false when it is not loaded (the caller then synthesizes). */
  play(names: string | string[], pan = 0, gain = 1, rateJitter = 0.06): boolean {
    if (!this.ctx) return false;
    const list = Array.isArray(names) ? names : [names];
    const pick = list.filter(n => this.buf[n]);
    if (!pick.length) return false;
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = this.buf[pick[Math.floor(Math.random() * pick.length)]];
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * rateJitter;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g); g.connect(p); p.connect(this.sfx); src.start();
    return true;
  }

  private noiseBurst(dur: number, filter: BiquadFilterType, freq: number, q: number, gain: number, pan: number, attack = 0.002, at = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.sfx);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = 0, pan = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g); g.connect(p); p.connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** A unit fired. pan -1..1 (screen position), near 0..1 (how loud: on screen and zoomed in). */
  shot(kind: UnitKind, pan: number, near: number, zoom = 1) {
    if (!this.ctx || near <= 0.02 || zoom <= 0.01) return;
    const now = performance.now();
    if (now - (this.lastShot[kind] ?? 0) < (GAP[kind] ?? 0)) return;
    this.lastShot[kind] = now;
    const v = (0.15 + 0.6 * near) * zoom;
    if (SHOT[kind] && this.play(SHOT[kind]!, pan, v * 0.9)) return;
    switch (kind) {
      case "sniper": this.noiseBurst(0.35, "bandpass", 2400, 0.7, 0.9 * v, pan); this.tone("triangle", 900, 120, 0.25, 0.2 * v, 0, pan); break;
      case "turret": this.noiseBurst(0.05, "highpass", 2500, 0.5, 0.35 * v, pan); break;
      case "mortar": this.tone("sine", 140, 50, 0.25, 0.6 * v, 0, pan); this.noiseBurst(0.2, "lowpass", 600, 0.7, 0.4 * v, pan); break;
      case "howitzer": case "battleship": case "himars": this.tone("sine", 90, 30, 0.6, 0.9 * v, 0, pan); this.noiseBurst(0.6, "lowpass", 400, 0.7, 0.8 * v, pan, 0.005); break;
      default: this.noiseBurst(0.09, "bandpass", 1600, 0.9, 0.5 * v, pan); // rifles
    }
  }
  /** An explosion of radius r cells. */
  boom(r: number, pan: number, near: number, zoom = 1) {
    if (!this.ctx || zoom <= 0.01) return;
    const now = performance.now();
    if (r < 5 && now - this.lastBoom < 70) return; // a cluster or a broadside: don't stack forty blasts
    this.lastBoom = now;
    const v = Math.min(1, 0.3 + r / 12) * (0.35 + 0.65 * near) * zoom;
    const name = r >= 60 ? ["boom-nuke-1"] : r >= 20 ? ["boom-huge-1"] : r >= 5 ? ["boom-large-1", "boom-large-2"] : r >= 2.5 ? ["boom-med-1", "boom-med-2"] : ["boom-small-1", "boom-small-2"];
    if (this.play(name, pan, r >= 20 ? 1 : v, r >= 20 ? 0 : 0.08)) return;
    this.tone("sine", 70, 25, 0.9 + r * 0.05, 0.9 * v, 0, pan);
    this.noiseBurst(1.1 + r * 0.06, "lowpass", 700, 0.6, 0.9 * v, pan, 0.004);
    this.noiseBurst(0.4, "bandpass", 2200, 0.5, 0.25 * v, pan, 0.002, 0.03);
  }
  /** One-off events: a building comes down, a cluster bomb, a gun run, a flyover, a firebomb, a lone zombie... */
  event(name: "collapse" | "cluster" | "brrt" | "jet" | "heli" | "plane" | "flame" | "zombie" | "scream" | "tankgun" | "autocannon", pan = 0, near = 1, zoom = 1) {
    if (!this.ctx || near <= 0.02 || zoom <= 0.01) return;
    const now = performance.now(), gaps: Record<string, number> = { zombie: 900, scream: 700, autocannon: 300, tankgun: 400, heli: 1500, collapse: 400 };
    if (now - (this.lastShot["ev:" + name] ?? 0) < (gaps[name] ?? 0)) return;
    this.lastShot["ev:" + name] = now;
    this.play(`${name}-1`, pan, (0.3 + 0.7 * near) * zoom);
  }
  horn() { if (!this.ctx) return; if (this.play("horn-1", 0, 0.8, 0)) return; this.tone("sawtooth", 180, 175, 1.1, 0.18); this.tone("sawtooth", 135, 132, 1.1, 0.14, 0.05); this.tone("sawtooth", 180, 175, 0.9, 0.16, 1.25); }
  alarm() { if (!this.ctx) return; if (this.play("alarm-1", 0, 0.6, 0)) return; for (let i = 0; i < 3; i++) { this.tone("square", 880, 860, 0.18, 0.08, i * 0.25); this.tone("square", 660, 650, 0.18, 0.08, i * 0.25 + 0.12); } }
  private lastRadio = 0;
  /** Order received (0.19.1): a short walkie-talkie squelch, then the double key-click that means "copy". No voices. */
  radio() {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastRadio < 400) return; // a whole saved plan deploying at once: one reply, not twenty
    this.lastRadio = now;
    this.play(["radio-1", "radio-2", "radio-3"], 0, 0.35, 0.04);
    for (const d of [0.32, 0.42]) this.noiseBurst(0.018, "bandpass", 2200, 1.2, 0.22, 0, 0.002, d);
  }
  click() { if (!this.ctx) return; this.tone("triangle", 700, 500, 0.05, 0.08); }
  fanfare(good: boolean) {
    if (!this.ctx) return;
    const notes = good ? [392, 523, 659, 784] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone("triangle", f, f, 0.5, 0.18, i * 0.22));
  }

  /** Synth fallback beds: a low noise groan and a fire hiss. Silenced once the real loops are loaded. */
  private startAmbience() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.5;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 260; f.Q.value = 6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23; const lg = ctx.createGain(); lg.gain.value = 90;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.sfx); src.start();
    this.amb = { g, f };
    const fs = ctx.createBufferSource(); fs.buffer = this.noise; fs.loop = true;
    const ff = ctx.createBiquadFilter(); ff.type = "highpass"; ff.frequency.value = 3000;
    const fg = ctx.createGain(); fg.gain.value = 0;
    fs.connect(ff); ff.connect(fg); fg.connect(this.sfx); fs.start();
    this.fire = fg;
  }
  /** Call every ~250 ms. horde 0..1 (infected on screen), fire 0..1, zoom 0..1 (zoomed in = 1),
   *  panic 0..1 (fleeing people on screen), warning: the siren phase before the outbreak, battle: any battle at all. */
  ambience(horde: number, fire: number, zoom = 0.5, panic = 0, warning = false, battle = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, set = (n: Loop, v: number, tc = 0.6) => this.loops[n]?.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), t, tc);
    const real = !!this.loops["horde-far-1"];
    if (this.amb) this.amb.g.gain.setTargetAtTime(real ? 0 : Math.min(1, horde) * 0.55, t, 0.5);
    if (this.fire) this.fire.gain.setTargetAtTime(this.loops["fire-1"] ? 0 : Math.min(1, fire) * 0.12 * (0.7 + 0.3 * Math.random()), t, 0.1);
    const h = Math.min(1, horde);
    set("horde-far-1", h * (0.25 + 0.45 * (1 - zoom)));            // the distant chorus, strongest zoomed out
    set("horde-close-1", h * zoom * zoom * 0.9);                   // growls up close when zoomed in
    set("crowd-panic-1", Math.min(1, panic) * (0.15 + 0.75 * zoom)); // screaming people near the camera
    set("crowd-far-1", battle ? 0.12 + 0.15 * (1 - zoom) : 0);
    set("fire-1", Math.min(1, fire) * 0.7, 0.3);
    set("siren-1", warning ? 0.45 : 0, warning ? 0.3 : 0.8);
  }

  /** Switch music (crossfade). Uses <audio> elements so long tracks stream instead of decoding up front. */
  music(t: Track | null) {
    if (t === this.track) return;
    this.track = t;
    if (!this.ctx) return; // starts after unlock
    for (const [name, el] of Object.entries(this.musicEl)) if (name !== t) this.fade(el, 0, () => el.pause());
    if (!t || !MUSIC[t]) return;
    let el = this.musicEl[t];
    if (!el) { el = new Audio(MUSIC[t]); el.loop = true; this.musicEl[t] = el; }
    el.volume = 0; el.currentTime = 0;
    el.play().catch(() => { /* blocked until a gesture: unlock() retries */ });
    this.fade(el, Math.min(1, this.vol.master * this.vol.music));
  }
  private fade(el: HTMLAudioElement, to: number, done?: () => void) {
    const from = el.volume, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1500);
      el.volume = from + (to - from) * k;
      if (k < 1) requestAnimationFrame(step); else done?.();
    };
    step();
  }
}

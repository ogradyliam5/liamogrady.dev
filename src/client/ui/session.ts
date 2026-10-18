/**
 * A generative reel, synthesised live with Web Audio (no samples): a Karplus–Strong
 * banjo over a quiet D–A drone and a soft bodhrán thump, in D major at 108 bpm.
 * Each tune is AABB with 8-bar parts; the music drives the swarm's audio response.
 */
import type { SceneController } from '../scenes';

type Deps = { scenes: () => SceneController | null };
/** t: position in quavers from the start of the tune; m: MIDI note (0 = thump); v: velocity. */
type Note = { t: number; m: number; v: number };
type Live = { master: GainNode; nodes: AudioNode[]; timer: number; raf: number; fade: number; stopping: boolean };

const Q = 60 / 108 / 2; // one quaver at 108 bpm
const SCALE = [62, 64, 66, 67, 69, 71, 73, 74, 76, 78, 79, 81, 83]; // D major, D4–B5
const CHORDS: Record<string, number[]> = { D: [2, 6, 9], G: [7, 11, 2], A: [9, 1, 4] }; // pitch classes
/** One chord per half bar; every part ends on D. */
const PROGRESSIONS = ['DDDDGGAADDDDGADD', 'DDGGDDAADDGGAADD', 'GGDDGGAAGGDDAADD', 'DDAAGGDDDDAAGADD'];
/** Melodic steps in scale degrees, weighted by repetition: mostly stepwise, the odd leap. */
const STEPS = [-1, -1, -1, 1, 1, 1, -2, 2, 2, -2, 0, 3, -3];
const PAUSE = '<path d="M8 5v14M16 5v14"/>';

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const pc = (i: number) => SCALE[i]! % 12;
const clampIdx = (i: number) => Math.max(0, Math.min(SCALE.length - 1, i));
/** Nearest scale index to i that satisfies ok, breaking ties at random. */
const nearest = (i: number, ok: (j: number) => boolean) => {
  for (let d = 0; d < SCALE.length; d++)
    for (const j of Math.random() < 0.5 ? [i - d, i + d] : [i + d, i - d]) if (j >= 0 && j < SCALE.length && ok(j)) return j;
  return i;
};

function part(prog: string, centre: number): Note[] {
  const out: Note[] = [];
  let i = centre;
  for (let bar = 0; bar < 8; bar++) {
    out.push({ t: bar * 8, m: 0, v: bar % 4 ? 0.7 : 1 });
    for (let k = 0; k < 8; k++) {
      const t = bar * 8 + k;
      const chord = CHORDS[prog[bar * 2 + (k >> 2)]!]!;
      if (bar === 7 && k >= 4) {
        // Phrase ending: resolve to D on beat 3 and let it ring.
        if (k === 4) {
          i = nearest(i, (j) => pc(j) === 2);
          out.push({ t, m: SCALE[i]!, v: 1 });
        }
        continue;
      }
      if (k % 4 === 0) i = nearest(clampIdx(i + pick([-1, 0, 0, 1])), (j) => chord.includes(pc(j)));
      else {
        let s = pick(STEPS);
        // A gentle pull back towards the part's centre keeps the walk singable.
        if (Math.random() < Math.abs(i - centre) / 7) s = Math.sign(centre - i) * Math.max(1, Math.abs(s));
        i = clampIdx(i + s);
      }
      const v = k === 0 ? 1 : k === 4 ? 0.85 : k % 2 ? 0.55 : 0.72;
      if (k % 2 && bar < 7 && Math.random() < 0.1) {
        // A triplet roll: note, upper neighbour, note, in the space of one quaver.
        const up = SCALE[clampIdx(i + 1)]!;
        out.push({ t, m: SCALE[i]!, v }, { t: t + 1 / 3, m: up, v: v * 0.75 }, { t: t + 2 / 3, m: SCALE[i]!, v: v * 0.85 });
      } else out.push({ t, m: SCALE[i]!, v });
    }
  }
  return out;
}

/** AABB: 32 bars, 256 quavers. The B part sits higher, as B parts do. */
const tune = (): Note[] => {
  const a = part(pick(PROGRESSIONS.slice(0, 2)), 4);
  const b = part(pick(PROGRESSIONS.slice(1)), 8);
  return [a, a, b, b].flatMap((p, n) => p.map((x) => ({ ...x, t: x.t + n * 64 })));
};
/** A light lilt: on-beat quavers a touch long, off-beats a touch late. */
const at = (t: number) => {
  const f = Math.floor(t);
  const r = t - f;
  return (f % 2 ? f + 0.08 + r * 0.92 : f + r * 1.08) * Q;
};

const strings = new Map<number, AudioBuffer>();
/** Karplus–Strong, rendered once per pitch: two slightly detuned strings, plucked near the bridge. */
function voice(ctx: BaseAudioContext, midi: number): AudioBuffer {
  let buf = strings.get(midi);
  if (buf) return buf;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.4);
  buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  for (const detune of [0.9983, 1.0017]) {
    const f = 440 * 2 ** ((midi - 69) / 12) * detune;
    const P = sr / f - 0.5; // loop delay, less the averaging filter's half sample
    const n0 = Math.ceil(P) + 2;
    const rho = 10 ** (-3 / (1.2 * f)); // about -60 dB after 1.2 s
    const comb = Math.max(1, Math.round(P * 0.13));
    const y = new Float32Array(len);
    for (let t = 0; t < n0; t++) y[t] = Math.random() * 2 - 1;
    for (let t = n0 - 1; t >= comb; t--) y[t]! -= y[t - comb]!;
    for (let t = n0; t < len; t++) {
      const r = t - P;
      const j = Math.floor(r);
      const fr = r - j;
      y[t] = rho * 0.5 * (y[j]! + (y[j + 1]! - y[j]!) * fr + y[j - 1]! + (y[j]! - y[j - 1]!) * fr);
    }
    for (let t = 0; t < len; t++) out[t]! += y[t]!;
  }
  let peak = 0;
  for (let t = 0; t < len; t++) {
    // The banjo "plunk": a quick first drop into the ring, and a short fade at the very end.
    out[t]! *= (0.55 * Math.exp(-t / (sr * 0.16)) + 0.45) * Math.min(1, (len - t) / (sr * 0.05));
    peak = Math.max(peak, Math.abs(out[t]!));
  }
  for (let t = 0; t < len; t++) out[t]! *= 0.8 / (peak || 1);
  strings.set(midi, buf);
  return buf;
}

export function createSession({ scenes }: Deps) {
  let ctx: AudioContext | null = null;
  let live: Live | null = null;
  let btn: HTMLButtonElement | null = null;
  let icon = '';

  const show = (on: boolean) => {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(on));
    const label = btn.querySelector('span');
    if (label) label.textContent = on ? 'Stop the reel' : 'Play a generative reel';
    const svg = btn.querySelector('svg');
    if (svg) {
      icon ||= svg.innerHTML;
      svg.innerHTML = on ? PAUSE : icon;
    }
  };

  const teardown = () => {
    if (!live) return;
    clearInterval(live.timer);
    clearTimeout(live.fade);
    cancelAnimationFrame(live.raf);
    for (const n of live.nodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* not started */
      }
      n.disconnect();
    }
    live = null;
    void ctx?.suspend();
  };

  const stop = () => {
    if (!live || live.stopping || !ctx) return;
    live.stopping = true;
    show(false);
    const g = live.master.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.6);
    live.fade = window.setTimeout(teardown, 650);
  };

  const start = async () => {
    teardown();
    try {
      ctx ??= new AudioContext();
    } catch {
      return;
    }
    const c = ctx;
    // iOS: let the reel play even with the ring/silent switch on (the visitor asked for sound).
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';

    const master = c.createGain();
    const comp = c.createDynamicsCompressor();
    const analyser = c.createAnalyser();
    const hp = c.createBiquadFilter();
    const body = c.createBiquadFilter();
    master.gain.value = 0;
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    analyser.fftSize = 1024;
    hp.type = 'highpass';
    hp.frequency.value = 110;
    // The banjo's drum head: a nasal resonance around 1.8 kHz.
    body.type = 'peaking';
    body.frequency.value = 1800;
    body.Q.value = 1.3;
    body.gain.value = 6;
    hp.connect(body).connect(master).connect(comp).connect(analyser).connect(c.destination);

    // The drone: D3 and A3, detuned a little, breathing through a low-pass filter.
    const lp = c.createBiquadFilter();
    const droneGain = c.createGain();
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lp.frequency.value = 520;
    lp.Q.value = 0.6;
    droneGain.gain.value = 0.05;
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(lp.frequency);
    lp.connect(droneGain).connect(master);
    const drones = [146.83, 220].map((f, n) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = n ? 4 : -4;
      o.connect(lp);
      return o;
    });

    const me: Live = { master, nodes: [master, comp, analyser, hp, body, lp, droneGain, lfo, lfoGain, ...drones], timer: 0, raf: 0, fade: 0, stopping: false };
    live = me;
    show(true);
    scenes()?.go('banjo');
    await c.resume().catch(() => {});
    if (live !== me || me.stopping) return;

    const now = c.currentTime;
    [lfo, ...drones].forEach((o) => o.start(now));
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.85, now + 0.6);

    const pluck = (m: number, t: number, v: number) => {
      const src = c.createBufferSource();
      const g = c.createGain();
      src.buffer = voice(c, m);
      src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.003;
      g.gain.setValueAtTime(v * 0.5, t);
      g.gain.setTargetAtTime(0, t + 0.8, 0.15);
      src.connect(g).connect(hp);
      src.start(t);
      src.stop(t + 1.4);
      src.onended = () => g.disconnect();
    };
    const thump = (t: number, v: number) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.32);
      o.onended = () => g.disconnect();
    };

    // Look-ahead scheduling: every 25 ms, queue whatever falls in the next 100 ms.
    let notes = tune();
    let i = 0;
    let t0 = now + 0.15;
    const schedule = () => {
      const until = c.currentTime + 0.1;
      for (;;) {
        if (i >= notes.length) {
          notes = tune();
          i = 0;
          t0 += 256 * Q;
        }
        const n = notes[i]!;
        const t = t0 + at(n.t) + (Math.random() - 0.5) * 0.008;
        if (t > until) break;
        i++;
        if (t < c.currentTime) continue; // fell behind (busy main thread): skip rather than rush
        if (n.m) pluck(n.m, t, n.v);
        else thump(t, n.v);
      }
    };
    schedule();
    me.timer = window.setInterval(schedule, 25);

    // The swarm listens: RMS of what is actually playing, every frame.
    const data = new Float32Array(analyser.fftSize);
    const listen = () => {
      me.raf = requestAnimationFrame(listen);
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const x of data) sum += x * x;
      scenes()?.swarm.audio(Math.min(2, Math.sqrt(sum / data.length) * 16));
    };
    listen();
  };

  document.addEventListener('visibilitychange', () => document.hidden && stop());

  return {
    toggle(button: HTMLButtonElement) {
      btn = button;
      if (live && !live.stopping) stop();
      else void start();
    },
  };
}

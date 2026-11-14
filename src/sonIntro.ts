// Sound design de l'animation d'ouverture, entièrement synthétisé (aucun fichier audio).
//
// Ligne directrice : une nappe continue en ré démarre avec le premier trait et ne
// s'interrompt jamais. Chaque geste de l'animation la transforme au lieu de lancer
// un son isolé, et les petits sons (tic, clics) se posent par-dessus :
//   strokes()  la nappe naît, des frottements de feutre dessinent le mot
//   land()     la tête de lecture se pose : tic + choc grave, la nappe s'éclaire
//   build()    la timeline se construit : la nappe s'ouvre et monte, un souffle l'accompagne
//   clip()     un clip apparaît : petit clic boisé
//   rewind()   la tête rembobine : toute la nappe se tord vers le bas, comme une bande
//   resolve()  tout se range : la nappe s'épanouit en accord, puis s'éteint lentement
// Aucune coupure : chaque son s'éteint en fondu, et la nappe ne change de direction qu'en partant de sa valeur du moment.

export interface IntroSound {
  strokes(at?: number): void;
  land(at?: number): void;
  build(dur: number, at?: number): void;
  clip(at?: number): void;
  rewind(dur: number, at?: number): void;
  resolve(at?: number): void;
  stop(): void;
}

const D2 = 73.42;

export function makeIntroSound(ctx: BaseAudioContext, volume = 0.9): IntroSound {
  const now = (at?: number) => at ?? ctx.currentTime;

  // ---- Sortie : compression douce, limiteur, volume ----
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.ratio.value = 2;
  glue.attack.value = 0.03;
  glue.release.value = 0.4;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  const master = ctx.createGain();
  master.gain.value = volume;
  glue.connect(limiter).connect(master).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 3.2, 2.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  reverb.connect(wet).connect(glue);

  const noise = noiseBuffer(ctx, 4);

  function out(node: AudioNode, send = 0.25, pan = 0): void {
    let n = node;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      n = node.connect(p);
    }
    n.connect(glue);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      n.connect(s).connect(reverb);
    }
  }

  /** Fige un paramètre à sa valeur du moment avant de lui donner une nouvelle direction (sans saut). */
  function hold(p: AudioParam, t: number): void {
    if (typeof p.cancelAndHoldAtTime === "function") p.cancelAndHoldAtTime(t);
    else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
  }

  /** Attaque rapide puis extinction en douceur (jamais de coupure nette). */
  function pluck(g: AudioParam, t: number, peak: number, attack: number, tau: number): void {
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.setTargetAtTime(0, t + attack, tau);
  }

  function noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.start(t, Math.random() * 2);
    src.stop(t + dur);
    return src;
  }

  // ---- La nappe : le fil conducteur ----
  const bedLP = ctx.createBiquadFilter();
  bedLP.type = "lowpass";
  bedLP.Q.value = 0.9;
  bedLP.frequency.value = 180;
  const bed = ctx.createGain();
  bed.gain.value = 0;
  bedLP.connect(bed);
  out(bed, 0.5);

  const voices: OscillatorNode[] = [];
  function voice(freq: number, type: OscillatorType, level: number, pan: number, detune = 0): GainNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(bedLP);
    voices.push(o);
    return g;
  }
  let bedStarted = false;
  let shimmer: GainNode | null = null;
  let chord: GainNode[] = [];

  function startBed(t: number): void {
    if (bedStarted) return;
    bedStarted = true;
    voice(D2, "sawtooth", 0.22, -0.55, -7);
    voice(D2, "sawtooth", 0.22, 0.55, 7);
    voice(D2 * 1.5, "sawtooth", 0.1, 0, 3);          // quinte (la)
    voice(D2 * 2, "sine", 0.35, 0);                   // octave
    voice(D2 / 2, "sine", 0.3, 0);                    // sous-basse
    shimmer = voice(D2 * 4, "triangle", 0, 0.3, -4);  // ré aigu, apparaît pendant la construction
    chord = [
      voice(D2 * 2 * 1.26, "triangle", 0, -0.35),     // fa#
      voice(D2 * 3, "sine", 0, 0.35),                 // la
      voice(D2 * 5.04, "sine", 0, -0.2),              // fa# aigu
    ];
    for (const o of voices) o.start(t);
    bed.gain.setValueAtTime(0, t);
    bed.gain.linearRampToValueAtTime(0.42, t + 1.1);
    bedLP.frequency.setValueAtTime(180, t);
    bedLP.frequency.exponentialRampToValueAtTime(520, t + 1.2);
  }

  const sound: IntroSound = {
    strokes(at) {
      const t0 = now(at);
      startBed(t0);
      [0.12, 0.23, 0.34, 0.45, 0.56].forEach((off, i) => {
        const t = t0 + off;
        const src = noiseSrc(t, 1.4);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(2000 + i * 240, t);
        bp.frequency.exponentialRampToValueAtTime(3600 + i * 200, t + 0.55);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.26, t + 0.07);
        g.gain.setTargetAtTime(0, t + 0.12, 0.16);
        src.connect(bp).connect(g);
        out(g, 0.35, i % 2 ? 0.35 : -0.35);
      });
    },

    land(at) {
      const t = now(at);
      startBed(t);
      // Tic
      const tic = ctx.createOscillator();
      tic.frequency.setValueAtTime(2600, t);
      tic.frequency.exponentialRampToValueAtTime(1200, t + 0.03);
      const gt = ctx.createGain();
      pluck(gt.gain, t, 0.42, 0.002, 0.025);
      tic.connect(gt);
      out(gt, 0.5);
      tic.start(t);
      tic.stop(t + 0.4);
      // Choc grave
      const low = ctx.createOscillator();
      low.frequency.setValueAtTime(150, t);
      low.frequency.exponentialRampToValueAtTime(D2 / 2, t + 0.2);
      const gl = ctx.createGain();
      pluck(gl.gain, t, 0.75, 0.004, 0.12);
      low.connect(gl);
      out(gl, 0.15);
      low.start(t);
      low.stop(t + 1.2);
      // La nappe s'éclaire
      hold(bedLP.frequency, t);
      bedLP.frequency.exponentialRampToValueAtTime(950, t + 0.45);
      hold(bed.gain, t);
      bed.gain.linearRampToValueAtTime(0.5, t + 0.6);
    },

    build(dur, at) {
      const t = now(at);
      // La nappe s'ouvre et gagne en brillance
      hold(bedLP.frequency, t);
      bedLP.frequency.exponentialRampToValueAtTime(4200, t + dur);
      hold(bed.gain, t);
      bed.gain.linearRampToValueAtTime(0.62, t + dur);
      shimmer?.gain.setValueAtTime(0, t);
      shimmer?.gain.linearRampToValueAtTime(0.16, t + dur);
      // Souffle qui accompagne, fondu dans la nappe
      const src = noiseSrc(t, dur + 2);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.8;
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.1, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.28, t + dur);
      g.gain.setTargetAtTime(0, t + dur, 0.22);
      src.connect(bp).connect(g);
      out(g, 0.55);
    },

    clip(at) {
      const t = now(at);
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(560, t + 0.04);
      const g = ctx.createGain();
      pluck(g.gain, t, 0.3, 0.002, 0.03);
      o.connect(g);
      out(g, 0.4, (Math.random() - 0.5) * 0.6);
      o.start(t);
      o.stop(t + 0.4);
    },

    rewind(dur, at) {
      const t = now(at);
      // Toute la nappe se tord vers le bas puis revient, comme une bande qu'on rembobine
      const steps = 64;
      for (const o of voices) {
        const base = o.detune.value;
        const curve = new Float32Array(steps);
        for (let i = 0; i < steps; i++) {
          const x = i / (steps - 1);
          const dip = Math.sin(Math.PI * x);                          // descend puis remonte
          const wobble = Math.sin(x * Math.PI * 14) * 0.18 * (1 - x); // vacillement de bande
          curve[i] = base - 700 * dip * (1 + wobble);
        }
        o.detune.setValueCurveAtTime(curve, t, dur);
      }
      hold(bedLP.frequency, t);
      bedLP.frequency.exponentialRampToValueAtTime(1300, t + dur * 0.5);
      bedLP.frequency.exponentialRampToValueAtTime(2200, t + dur);
      // Souffle de bande
      const n = noiseSrc(t, dur + 1);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(5000, t);
      bp.frequency.exponentialRampToValueAtTime(1500, t + dur);
      bp.Q.value = 0.8;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.12, t + 0.1);
      gn.gain.setTargetAtTime(0, t + dur * 0.8, 0.08);
      n.connect(bp).connect(gn);
      out(gn, 0.3);
      // Arrêt de la bande
      sound.clip(t + dur - 0.03);
    },

    resolve(at) {
      const t = now(at);
      // La nappe s'épanouit en accord de ré majeur, puis s'éteint lentement
      hold(bedLP.frequency, t);
      bedLP.frequency.exponentialRampToValueAtTime(3000, t + 0.5);
      bedLP.frequency.exponentialRampToValueAtTime(700, t + 4);
      chord.forEach((g, i) => {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime([0.16, 0.14, 0.07][i], t + 0.35 + i * 0.06);
      });
      shimmer?.gain.setTargetAtTime(0.06, t, 0.4);
      hold(bed.gain, t);
      bed.gain.linearRampToValueAtTime(0.7, t + 0.35);
      bed.gain.linearRampToValueAtTime(0.55, t + 0.9);
      bed.gain.exponentialRampToValueAtTime(0.0005, t + 5.5);
      for (const o of voices) o.stop(t + 7);
      // Cloche discrète au-dessus
      for (const [f, peak, pan] of [[D2 * 16, 0.13, -0.15], [D2 * 16 * 2.76, 0.03, 0.2], [D2 * 24, 0.05, 0.3]] as const) {
        const b = ctx.createOscillator();
        b.frequency.value = f;
        const gb = ctx.createGain();
        pluck(gb.gain, t + 0.04, peak, 0.004, 0.5);
        b.connect(gb);
        out(gb, 0.8, pan);
        b.start(t + 0.04);
        b.stop(t + 4);
      }
    },

    stop() {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.setTargetAtTime(0, t, 0.08);
      if ("close" in ctx) setTimeout(() => void (ctx as AudioContext).close().catch(() => {}), 600);
    },
  };
  return sound;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Réponse impulsionnelle synthétique : bruit stéréo qui s'éteint, comme une salle douce. */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Contexte audio pour l'animation (null si le son n'est pas disponible). */
export function liveIntroSound(): { sound: IntroSound; ready: Promise<void> } | null {
  try {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    // Si la lecture automatique est bloquée, resume() peut attendre indéfiniment : on n'attend pas plus de 200 ms.
    const ready = ctx.state === "running" ? Promise.resolve() : Promise.race([ctx.resume().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 200))]);
    return { sound: makeIntroSound(ctx), ready };
  } catch {
    return null;
  }
}

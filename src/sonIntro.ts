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
  /** Animation de lancement (≈ 2 s) : la ligne de temps, le tracé, le tic, les ondes, la sortie. */
  launch(at?: number): void;
  /** Passage vers l'application : le rideau bleu se ferme. */
  curtain(dur: number, at?: number): void;
  /** Passage vers l'application : la tête de lecture balaie l'écran de gauche à droite. */
  sweep(dur: number, at?: number): void;
  stop(): void;
}

const D2 = 73.42;
/** Présence des cliquetis et grains par rapport à la nappe. */
const GRAIN = 6;

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
  // « drive » : gain avant le limiteur (1 par défaut ; poussé pour l'animation de lancement)
  const drive = ctx.createGain();
  // « soft » : écrêtage doux en sortie (transparent par défaut ; arrondit les crêtes quand on pousse le niveau)
  const soft = ctx.createWaveShaper();
  glue.connect(drive).connect(limiter).connect(master).connect(soft).connect(ctx.destination);

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
    if (!ambienceStarted) { ambienceStarted = true; ambience(t, 6.5); }
    bed.gain.setValueAtTime(0, t);
    bed.gain.linearRampToValueAtTime(0.36, t + 1.1);
    bedLP.frequency.setValueAtTime(180, t);
    bedLP.frequency.exponentialRampToValueAtTime(520, t + 1.2);
  }

  // ---- Petites briques : grain de bruit et tintement ----
  /** Grain de bruit très court et filtré : clic, cliquetis, poussière. */
  function grain(t: number, freq: number, peak: number, tau = 0.012, pan = 0, q = 2.5, send = 0.3): void {
    const src = noiseSrc(t, tau * 8 + 0.02);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    pluck(g.gain, t, peak * GRAIN, 0.0015, tau);
    src.connect(bp).connect(g);
    out(g, send, pan);
  }

  /** Tintement sinusoïdal qui s'éteint doucement. */
  function ping(t: number, f: number, peak: number, tau: number, pan = 0, send = 0.6): void {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    pluck(g.gain, t, peak, 0.003, tau);
    o.connect(g);
    out(g, send, pan);
    o.start(t);
    o.stop(t + tau * 8);
  }

  /** Souffle large qui se déplace dans l'espace stéréo. */
  function whoosh(t: number, dur: number, f0: number, f1: number, peak: number, pan0: number, pan1: number): void {
    const src = noiseSrc(t, dur + 1);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.7);
    g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.25);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(pan0, t);
    p.pan.linearRampToValueAtTime(pan1, t + dur);
    src.connect(bp).connect(g).connect(p);
    out(p, 0.5);
  }

  /** Ambiance de fond : souffle de bande et air de salle, plus une poussière de grains aigus. */
  function ambience(t: number, dur: number): void {
    for (const pan of [-0.7, 0.7]) {
      const src = noiseSrc(t, dur + 2);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1800;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 120;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.8);
      g.gain.linearRampToValueAtTime(0.085, t + 3.6);
      g.gain.linearRampToValueAtTime(0.0, t + dur);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(hp).connect(lp).connect(g).connect(p);
      out(p, 0.2);
      // Souffle aigu de bande, plus fin
      const hiss = noiseSrc(t, dur + 2);
      const hh = ctx.createBiquadFilter();
      hh.type = "highpass";
      hh.frequency.value = 7000;
      const gh = ctx.createGain();
      gh.gain.setValueAtTime(0, t);
      gh.gain.linearRampToValueAtTime(0.03, t + 1);
      gh.gain.linearRampToValueAtTime(0.0, t + dur);
      const ph = ctx.createStereoPanner();
      ph.pan.value = -pan * 0.5;
      hiss.connect(hh).connect(gh).connect(ph);
      out(ph, 0);
    }
    // Poussière : grains aigus aléatoires, plus denses au milieu de l'animation
    let x = t + 0.2;
    while (x < t + dur - 0.6) {
      const k = (x - t) / dur;
      const density = 10 + 30 * Math.sin(Math.PI * Math.min(1, k * 1.15));
      grain(x, 5000 + Math.random() * 7000, 0.04 + Math.random() * 0.06, 0.004 + Math.random() * 0.006, Math.random() * 1.6 - 0.8, 4, 0.5);
      x += (0.4 + Math.random()) / density;
    }
  }

  let ambienceStarted = false;

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
        // Grain du feutre sur le papier
        for (let k = 0; k < 9; k++) grain(t + 0.02 + k * 0.045 + Math.random() * 0.02, 2500 + Math.random() * 3000, 0.09 * (1 - k / 10), 0.006, i % 2 ? 0.3 : -0.3, 3, 0.2);
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
      // Tintement métallique (partiels inharmoniques) et petit écho de clics
      for (const [f, a, tau, pan] of [[1870, 0.11, 0.35, -0.2], [2870, 0.07, 0.25, 0.25], [4130, 0.05, 0.18, 0], [5960, 0.03, 0.12, 0.3]] as const) ping(t + 0.004, f, a, tau, pan, 0.7);
      [0.11, 0.2, 0.27].forEach((d, i) => grain(t + d, 3200 - i * 400, 0.12 - i * 0.03, 0.008, i % 2 ? 0.5 : -0.5));
      // La nappe s'éclaire
      hold(bedLP.frequency, t);
      bedLP.frequency.exponentialRampToValueAtTime(950, t + 0.45);
      hold(bed.gain, t);
      bed.gain.linearRampToValueAtTime(0.42, t + 0.6);
    },

    build(dur, at) {
      const t = now(at);
      // La nappe s'ouvre et gagne en brillance
      hold(bedLP.frequency, t);
      bedLP.frequency.exponentialRampToValueAtTime(4200, t + dur);
      hold(bed.gain, t);
      bed.gain.linearRampToValueAtTime(0.52, t + dur);
      shimmer?.gain.setValueAtTime(0, t);
      shimmer?.gain.linearRampToValueAtTime(0.16, t + dur);
      // Un clic par graduation de la règle, au moment où elle apparaît (du centre vers les bords)
      const STEM = 128.8;
      for (let i = 0; i <= 20; i++) {
        const x = i * 11;
        const p = Math.min(0.995, Math.abs(x - STEM) / 128.8);
        const tt = t + 0.15 + (-Math.log2(1 - p) / 10) * 0.8;
        grain(tt, 3800 + (x / 220) * 2400, 0.16, 0.007, (x - 110) / 130, 3.5, 0.35);
      }
      // Pluie de micro-clics : les barres de la forme d'onde jaillissent depuis la tête de lecture
      for (let i = 0; i < 100; i += 2) {
        const x = 4 + i * 2.12;
        grain(t + 0.45 + Math.abs(x - STEM) * 0.004 + Math.random() * 0.01, 1800 + Math.random() * 2600, 0.05 + Math.random() * 0.05, 0.005, (x - 110) / 120, 3, 0.3);
      }
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
      // Cliquetis du compteur de bande : accélère puis ralentit
      let c = t + 0.03;
      while (c < t + dur - 0.05) {
        const x = (c - t) / dur;
        grain(c, 2600 + Math.sin(Math.PI * x) * 1800, 0.09, 0.005, Math.sin(x * 9) * 0.4, 4, 0.25);
        c += 0.075 - 0.055 * Math.sin(Math.PI * x);
      }
      // Souffle qui aspire vers l'accord final
      whoosh(t + 0.1, dur - 0.1, 300, 5000, 0.16, 0.6, 0);
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
      bed.gain.linearRampToValueAtTime(0.6, t + 0.35);
      bed.gain.linearRampToValueAtTime(0.47, t + 0.9);
      bed.gain.exponentialRampToValueAtTime(0.0005, t + 5.5);
      for (const o of voices) o.stop(t + 7);
      // La timeline part se ranger à gauche : souffle qui traverse vers la gauche
      whoosh(t, 0.9, 2500, 500, 0.2, 0.3, -0.8);
      // Petit arpège scintillant sur l'accord (ré, fa#, la, ré)
      [D2 * 16, D2 * 16 * 1.26, D2 * 24, D2 * 32].forEach((f, i) => ping(t + 0.18 + i * 0.07, f, 0.05, 0.25, [-0.5, 0.5, -0.25, 0.3][i], 0.8));
      // Dernières poussières qui retombent
      for (let k = 0; k < 14; k++) grain(t + 0.3 + k * 0.09 + Math.random() * 0.05, 6000 + Math.random() * 5000, 0.06 * (1 - k / 16), 0.004, Math.random() * 1.4 - 0.7, 4, 0.6);
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

    launch(at) {
      const t = now(at);
      const T = t + 0.8; // la tête de lecture tombe dans le « d »
      // Plus fort : on pousse le niveau dans le limiteur (le son devient plus dense sans saturer)
      drive.gain.value = 2.6;
      limiter.threshold.value = -4;
      master.gain.value = 1.15;
      { const n = 2048, c = new Float32Array(n), k = 1.6; for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = (Math.tanh(k * x) / Math.tanh(k)) * 0.93; } soft.curve = c; soft.oversample = "4x"; }

      // Grande salle : réverbération longue pour que l'impact résonne
      const hall = ctx.createConvolver();
      hall.buffer = impulse(ctx, 4.5, 2.2);
      const hallWet = ctx.createGain();
      hallWet.gain.value = 0.42;
      hall.connect(hallWet).connect(glue);

      /** Son placé dans l'espace autour de la tête (binaural HRTF) ; points : [instant, x, y, z]. */
      const space = (node: AudioNode, pts: [number, number, number, number][], send = 0.3, hallSend = 0): void => {
        const p = ctx.createPanner();
        p.panningModel = "HRTF";
        p.distanceModel = "inverse";
        p.refDistance = 1;
        p.rolloffFactor = 0.6;
        const [t0, x0, y0, z0] = pts[0];
        p.positionX.setValueAtTime(x0, t0); p.positionY.setValueAtTime(y0, t0); p.positionZ.setValueAtTime(z0, t0);
        for (const [tt, x, y, z] of pts.slice(1)) { p.positionX.linearRampToValueAtTime(x, tt); p.positionY.linearRampToValueAtTime(y, tt); p.positionZ.linearRampToValueAtTime(z, tt); }
        node.connect(p).connect(glue);
        if (send) { const g = ctx.createGain(); g.gain.value = send; p.connect(g).connect(reverb); }
        if (hallSend) { const g = ctx.createGain(); g.gain.value = hallSend; p.connect(g).connect(hall); }
      };
      /** Positions sur un cercle autour de l'auditeur (angle en tours : 0 devant, 0,25 à droite, 0,5 derrière). */
      const around = (t0: number, t1: number, a0: number, a1: number, r = 1.4, y = 0, steps = 10): [number, number, number, number][] =>
        Array.from({ length: steps + 1 }, (_, k) => {
          const u = k / steps, a = (a0 + (a1 - a0) * u) * Math.PI * 2;
          return [t0 + (t1 - t0) * u, Math.sin(a) * r, y, -Math.cos(a) * r] as [number, number, number, number];
        });

      // 1. La montée, façon riser (0 → 0,8 s)
      // Sous-grave qui gonfle jusqu'à l'impact
      const sub = ctx.createOscillator();
      sub.frequency.setValueAtTime(D2 / 2, t);
      sub.frequency.exponentialRampToValueAtTime(D2 / 2 * 1.25, T);
      const gs = ctx.createGain();
      gs.gain.setValueAtTime(0, t);
      gs.gain.linearRampToValueAtTime(0.8, T - 0.03);
      gs.gain.linearRampToValueAtTime(0.0, T + 0.01);
      sub.connect(gs); gs.connect(glue);
      sub.start(t); sub.stop(T + 0.1);
      // Riser de souffle qui monte du grave à l'aigu en passant d'une oreille à l'autre, de plus en plus vite
      const pingpong: [number, number, number, number][] = [];
      for (let u = 0, side = -1; u <= 1.0001; side = -side) {
        pingpong.push([t + u * (T - t), side * 1.6, 0.2 + u * 0.6, -0.3]);
        u += Math.max(0.035, 0.22 * (1 - u) ** 1.4);
      }
      const rz = noiseSrc(t, 1.0);
      const rbp = ctx.createBiquadFilter(); rbp.type = "bandpass"; rbp.Q.value = 1.4;
      rbp.frequency.setValueAtTime(220, t); rbp.frequency.exponentialRampToValueAtTime(8000, T);
      const grz = ctx.createGain(); grz.gain.setValueAtTime(0.001, t); grz.gain.exponentialRampToValueAtTime(0.6, T - 0.02); grz.gain.linearRampToValueAtTime(0, T + 0.005);
      rz.connect(rbp).connect(grz);
      space(grz, pingpong, 0.35);
      // Riser tonal : nappes graves qui glissent d'une octave pendant que le filtre s'ouvre (tension, pas mélodie)
      const rlp2 = ctx.createBiquadFilter(); rlp2.type = "lowpass"; rlp2.Q.value = 3;
      rlp2.frequency.setValueAtTime(140, t); rlp2.frequency.exponentialRampToValueAtTime(3200, T);
      const gtr = ctx.createGain(); gtr.gain.setValueAtTime(0.001, t); gtr.gain.exponentialRampToValueAtTime(0.3, T - 0.02); gtr.gain.linearRampToValueAtTime(0, T + 0.005);
      rlp2.connect(gtr);
      const trSplit = ctx.createGain(); gtr.connect(trSplit); trSplit.connect(glue);
      const trRev = ctx.createGain(); trRev.gain.value = 0.35; trSplit.connect(trRev).connect(reverb);
      [[D2, -8, -1.4], [D2, 9, 1.4], [D2 * 1.5, -5, -0.7], [D2 * 1.5, 6, 0.7], [D2 * 2, 0, 0]].forEach(([f, det, x]) => {
        const o = ctx.createOscillator(); o.type = "sawtooth";
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2, T);
        o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = 0.22;
        const p = ctx.createPanner(); p.panningModel = "HRTF"; p.positionX.value = x; p.positionY.value = 0.1; p.positionZ.value = -0.8;
        o.connect(g).connect(p).connect(rlp2);
        o.start(t); o.stop(T + 0.05);
      });
      // Pulsations graves qui accélèrent, une oreille puis l'autre
      for (let c = t + 0.06, k = 0; c < T - 0.04; k++) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(120, c); o.frequency.exponentialRampToValueAtTime(48, c + 0.08);
        const g = ctx.createGain(); pluck(g.gain, c, 0.35 + k * 0.03, 0.002, 0.05);
        o.connect(g);
        space(g, [[c, k % 2 ? 1.5 : -1.5, 0, -0.4]], 0.15);
        o.start(c); o.stop(c + 0.3);
        c += Math.max(0.055, 0.2 - k * 0.028);
      }
      // Le tracé du logo : frottements feutrés sur les côtés
      [[0.16, -1, 0.2, -0.6], [0.28, 1, 0.2, -0.6], [0.4, -0.6, 0.8, -0.6], [0.52, 0.6, 0.8, -0.6]].forEach(([o, x, y, z], i) => {
        const src = noiseSrc(t + o, 0.5);
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(1200 + i * 150, t + o); bp.frequency.exponentialRampToValueAtTime(2600 + i * 150, t + o + 0.3);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t + o); g.gain.linearRampToValueAtTime(0.2, t + o + 0.04); g.gain.setTargetAtTime(0, t + o + 0.07, 0.08);
        src.connect(bp).connect(g);
        space(g, [[t + o, x, y, z]], 0.3);
      });

      // 2. L'impact « BRAAM » : un mur de basses tout autour de la tête
      // Sous-grave qui plonge dans l'infra
      const drop = ctx.createOscillator();
      drop.frequency.setValueAtTime(70, T); drop.frequency.exponentialRampToValueAtTime(24, T + 2.2);
      const gd = ctx.createGain(); pluck(gd.gain, T, 1.0, 0.006, 0.9);
      drop.connect(gd); gd.connect(glue);
      const dh = ctx.createGain(); dh.gain.value = 0.2; gd.connect(dh).connect(hall);
      drop.start(T); drop.stop(T + 6);
      // Le « braam » : dents de scie très graves (ré et la, sans mélodie), filtre qui s'ouvre puis se referme,
      // chaque voix placée dans une direction différente autour de l'auditeur
      const braamLP = ctx.createBiquadFilter(); braamLP.type = "lowpass"; braamLP.Q.value = 2.5;
      braamLP.frequency.setValueAtTime(90, T);
      braamLP.frequency.exponentialRampToValueAtTime(1100, T + 0.12);
      braamLP.frequency.exponentialRampToValueAtTime(260, T + 1.4);
      braamLP.frequency.exponentialRampToValueAtTime(90, T + 3.2);
      const braamSat = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const v = i / 511.5 - 1; curve[i] = Math.tanh(v * 2.6) / Math.tanh(2.6); }
      braamSat.curve = curve;
      const gb = ctx.createGain(); gb.gain.setValueAtTime(0, T); gb.gain.linearRampToValueAtTime(0.42, T + 0.04); gb.gain.setTargetAtTime(0, T + 0.25, 0.9);
      braamLP.connect(braamSat).connect(gb);
      const bsplit = ctx.createGain(); gb.connect(bsplit);
      bsplit.connect(glue);
      const bh = ctx.createGain(); bh.gain.value = 0.5; bsplit.connect(bh).connect(hall);
      [[D2 / 2, -6, -1.2, 0, -0.4], [D2 / 2, 7, 1.2, 0, -0.4], [D2, -9, -0.8, 0.2, 1.0], [D2, 10, 0.8, 0.2, 1.0], [D2 * 1.5, -4, 0, 0.6, -1.0], [D2 * 1.5, 5, 0, -0.4, 1.2]].forEach(([f, det, x, y, z]) => {
        const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = 0.3;
        o.connect(g);
        const p = ctx.createPanner(); p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 1; p.rolloffFactor = 0.4;
        p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
        g.connect(p).connect(braamLP);
        o.start(T); o.stop(T + 5);
      });
      // Boom saturé et coup de pression : l'impact pèse plus lourd
      const boomO = ctx.createOscillator();
      boomO.frequency.setValueAtTime(110, T); boomO.frequency.exponentialRampToValueAtTime(32, T + 0.5);
      const boomSat = ctx.createWaveShaper(); boomSat.curve = curve;
      const gbo = ctx.createGain(); pluck(gbo.gain, T, 0.75, 0.003, 0.35);
      boomO.connect(boomSat).connect(gbo); gbo.connect(glue);
      const boh = ctx.createGain(); boh.gain.value = 0.45; gbo.connect(boh).connect(hall);
      boomO.start(T); boomO.stop(T + 2.5);
      const press = noiseSrc(T, 0.6);
      const plp = ctx.createBiquadFilter(); plp.type = "lowpass"; plp.frequency.setValueAtTime(600, T); plp.frequency.exponentialRampToValueAtTime(80, T + 0.4);
      const gp = ctx.createGain(); pluck(gp.gain, T, 0.9, 0.002, 0.12);
      press.connect(plp).connect(gp); space(gp, [[T, -1.2, 0, 0.3], [T + 0.4, 1.2, 0, 0.3]], 0.2, 0.5);
      // Coup sec et grave au centre
      const thump = ctx.createOscillator();
      thump.frequency.setValueAtTime(160, T); thump.frequency.exponentialRampToValueAtTime(42, T + 0.14);
      const gth = ctx.createGain(); pluck(gth.gain, T, 0.9, 0.002, 0.09);
      thump.connect(gth); space(gth, [[T, 0, 0, -0.8]], 0.2, 0.5);
      thump.start(T); thump.stop(T + 0.8);
      const crack = noiseSrc(T, 0.5);
      const clp = ctx.createBiquadFilter(); clp.type = "lowpass"; clp.frequency.value = 2200;
      const gc = ctx.createGain(); pluck(gc.gain, T, 0.6, 0.0008, 0.05);
      crack.connect(clp).connect(gc); space(gc, [[T, 0, 0.1, -0.9]], 0.3, 0.7);

      // 3. La traîne : deux grondements qui tournent autour de la tête en sens inverse,
      //    et une descente qui traverse de droite à gauche en s'éteignant
      [[0, 1], [0.5, -0.5]].forEach(([a0, a1], i) => {
        const n = noiseSrc(T, 4);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(500, T); lp.frequency.exponentialRampToValueAtTime(110, T + 3);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(i ? 0.25 : 0.7, T + 0.12); g.gain.setTargetAtTime(0, T + 0.5, 0.95);
        n.connect(lp).connect(g);
        space(g, around(T, T + 3.5, a0, a1, 1.6, i ? 0.4 : -0.2, 18), 0.15, 0.25);
      });
      // Souffle qui tourbillonne d'une oreille à l'autre après l'impact (une fois et demie)
      const swirl = noiseSrc(T + 0.05, 2.4);
      const swbp = ctx.createBiquadFilter(); swbp.type = "bandpass"; swbp.Q.value = 0.9;
      swbp.frequency.setValueAtTime(1400, T + 0.05); swbp.frequency.exponentialRampToValueAtTime(350, T + 2.3);
      const gsw = ctx.createGain(); gsw.gain.setValueAtTime(0, T + 0.05); gsw.gain.linearRampToValueAtTime(0.85, T + 0.3); gsw.gain.setTargetAtTime(0, T + 0.9, 0.45);
      const swp = ctx.createStereoPanner();
      const turns = new Float32Array(64);
      for (let k = 0; k < 64; k++) turns[k] = Math.sin((k / 63) * Math.PI * 3) * 0.95;
      swp.pan.setValueCurveAtTime(turns, T + 0.05, 2.2);
      swirl.connect(swbp).connect(gsw).connect(swp).connect(glue);
      const swr = ctx.createGain(); swr.gain.value = 0.2; swp.connect(swr).connect(reverb);
      const down = noiseSrc(T + 0.1, 1.6);
      const dbp = ctx.createBiquadFilter(); dbp.type = "bandpass"; dbp.Q.value = 1.3; dbp.frequency.setValueAtTime(5000, T + 0.1); dbp.frequency.exponentialRampToValueAtTime(180, T + 1.6);
      const gdn = ctx.createGain(); gdn.gain.setValueAtTime(0, T + 0.1); gdn.gain.linearRampToValueAtTime(0.75, T + 0.25); gdn.gain.setTargetAtTime(0, T + 0.6, 0.35);
      down.connect(dbp).connect(gdn);
      space(gdn, [[T + 0.1, 2.2, 0.6, -0.3], [T + 0.8, 0, 0.2, 1.2], [T + 1.6, -2.2, -0.2, -0.3]], 0.2, 0.15);

      // 4. Sortie : souffle grave qui passe derrière vers la gauche pendant que le logo se range
      const out2 = noiseSrc(t + 1.3, 1.0);
      const obp = ctx.createBiquadFilter(); obp.type = "bandpass"; obp.Q.value = 1.0; obp.frequency.setValueAtTime(1600, t + 1.3); obp.frequency.exponentialRampToValueAtTime(260, t + 1.95);
      const go = ctx.createGain(); go.gain.setValueAtTime(0, t + 1.3); go.gain.linearRampToValueAtTime(0.4, t + 1.62); go.gain.setTargetAtTime(0, t + 1.7, 0.14);
      out2.connect(obp).connect(go);
      space(go, around(t + 1.3, t + 1.95, 0.1, -0.35, 1.3, 0.1, 8), 0.4);
    },

    curtain(dur, at) {
      const t = now(at);
      // Souffle sourd qui se referme, la tête de lecture de la mini-timeline arrive au bout
      whoosh(t, dur, 1800, 260, 0.2, -0.7, 0.1);
      const low = ctx.createOscillator();
      low.frequency.setValueAtTime(D2, t);
      const gl = ctx.createGain();
      gl.gain.setValueAtTime(0, t);
      gl.gain.linearRampToValueAtTime(0.28, t + dur);
      gl.gain.setTargetAtTime(0, t + dur, 0.35);
      low.connect(gl);
      out(gl, 0.3);
      low.start(t);
      low.stop(t + dur + 2.5);
      for (let k = 0; k < 6; k++) grain(t + k * (dur / 6), 2400 + k * 300, 0.08, 0.006, -0.6 + k * 0.12, 3.5, 0.3);
      // Tic quand le rideau est fermé
      grain(t + dur, 3200, 0.2, 0.01, 0, 3, 0.5);
      ping(t + dur, D2 * 16, 0.06, 0.25, 0, 0.7);
    },

    sweep(dur, at) {
      const t = now(at);
      // La tête de lecture traverse l'écran : souffle qui va de gauche à droite
      whoosh(t, dur, 500, 5200, 0.26, -0.9, 0.9);
      // Petits clics au passage de chaque élément de l'application
      for (let k = 0; k < 18; k++) {
        const x = k / 17;
        const tt = t + dur * (1 - Math.pow(1 - x, 2.2)) * 0.95;
        grain(tt, 2600 + x * 3000, 0.11, 0.006, -0.9 + 1.8 * x, 3.5, 0.35);
      }
      // Arrivée : accord doux de ré et cloche
      for (const [f, a, pan] of [[D2 * 4, 0.07, -0.3], [D2 * 5.04, 0.05, 0.3], [D2 * 6, 0.05, 0], [D2 * 16, 0.07, 0.2], [D2 * 24, 0.035, -0.2]] as const) {
        ping(t + dur * 0.85, f, a, f > 1000 ? 0.45 : 0.9, pan, 0.8);
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

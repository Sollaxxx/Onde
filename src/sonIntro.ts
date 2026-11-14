// Sound design de l'animation d'ouverture, entièrement synthétisé (aucun fichier audio).
// Chaque geste de l'animation a son son :
//   strokes()  le mot « onde » se dessine : frottements de feutre
//   land()     la tête de lecture se pose dans le « d » : tic net + petit choc grave
//   build()    la timeline se construit : souffle qui monte
//   clip()     un clip apparaît : petit clic boisé
//   rewind()   la tête de lecture rembobine : bande qui défile à l'envers
//   resolve()  tout se range dans l'accueil : accord doux qui signe la fin
// Chaque méthode accepte un instant `at` (secondes, horloge audio) : utile pour un rendu hors ligne.

export interface IntroSound {
  strokes(at?: number): void;
  land(at?: number): void;
  build(dur: number, at?: number): void;
  clip(at?: number): void;
  rewind(dur: number, at?: number): void;
  resolve(at?: number): void;
  stop(): void;
}

export function makeIntroSound(ctx: BaseAudioContext, volume = 0.7): IntroSound {
  const now = (at?: number) => at ?? ctx.currentTime;

  // Chaîne de sortie : compresseur doux, volume général, petite réverbération.
  const master = ctx.createGain();
  master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.6, 2.8);
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  reverb.connect(wet).connect(master);

  const noise = noiseBuffer(ctx, 3);

  /** Enveloppe : monte jusqu'à `peak` en `a` secondes, puis s'éteint en `d` secondes. */
  function env(g: AudioParam, t: number, peak: number, a: number, d: number): void {
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function out(node: AudioNode, send = 0.25): void {
    node.connect(master);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      node.connect(s).connect(reverb);
    }
  }

  function noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.start(t, Math.random() * 1.5, dur);
    return src;
  }

  return {
    strokes(at) {
      const t0 = now(at);
      [0.12, 0.23, 0.34, 0.45, 0.56].forEach((off, i) => {
        const t = t0 + off;
        const src = noiseSrc(t, 0.8);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(2200 + i * 260, t);
        bp.frequency.exponentialRampToValueAtTime(3800 + i * 200, t + 0.5);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 900;
        const g = ctx.createGain();
        env(g.gain, t, 0.17, 0.06, 0.55);
        src.connect(bp).connect(hp).connect(g);
        out(g, 0.15);
      });
    },

    land(at) {
      const t = now(at);
      // Tic : sinus aigu très court
      const tic = ctx.createOscillator();
      tic.frequency.setValueAtTime(2400, t);
      tic.frequency.exponentialRampToValueAtTime(1100, t + 0.03);
      const gt = ctx.createGain();
      env(gt.gain, t, 0.28, 0.002, 0.06);
      tic.connect(gt);
      out(gt, 0.35);
      tic.start(t);
      tic.stop(t + 0.1);
      // Choc grave
      const low = ctx.createOscillator();
      low.frequency.setValueAtTime(140, t);
      low.frequency.exponentialRampToValueAtTime(48, t + 0.18);
      const gl = ctx.createGain();
      env(gl.gain, t, 0.55, 0.004, 0.32);
      low.connect(gl);
      out(gl, 0.1);
      low.start(t);
      low.stop(t + 0.4);
      // Petit grain de bruit pour l'attaque
      const n = noiseSrc(t, 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 4000;
      const gn = ctx.createGain();
      env(gn.gain, t, 0.12, 0.001, 0.03);
      n.connect(hp).connect(gn);
      out(gn, 0.2);
    },

    build(dur, at) {
      const t = now(at);
      // Souffle filtré qui monte
      const src = noiseSrc(t, dur + 0.2);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 2.2;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(5200, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.2, t + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
      src.connect(bp).connect(g);
      out(g, 0.4);
      // Nappe grave qui gonfle
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(55, t);
      sub.frequency.linearRampToValueAtTime(73.4, t + dur);
      const gs = ctx.createGain();
      gs.gain.setValueAtTime(0.0001, t);
      gs.gain.exponentialRampToValueAtTime(0.14, t + dur * 0.8);
      gs.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
      sub.connect(gs);
      out(gs, 0.15);
      sub.start(t);
      sub.stop(t + dur + 0.3);
    },

    clip(at) {
      const t = now(at);
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(820, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.04);
      const g = ctx.createGain();
      env(g.gain, t, 0.16, 0.002, 0.07);
      o.connect(g);
      out(g, 0.3);
      o.start(t);
      o.stop(t + 0.12);
    },

    rewind(dur, at) {
      const t = now(at);
      // Bande qui défile à l'envers : dent de scie dont la hauteur chute, hachée de plus en plus lentement
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(260, t);
      o.frequency.exponentialRampToValueAtTime(900, t + dur * 0.35);
      o.frequency.exponentialRampToValueAtTime(90, t + dur);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1300;
      bp.Q.value = 1.6;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = "square";
      lfo.frequency.setValueAtTime(34, t);
      lfo.frequency.exponentialRampToValueAtTime(9, t + dur);
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(chop.gain);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13, t + 0.08);
      g.gain.setValueAtTime(0.13, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(bp).connect(chop).connect(g);
      out(g, 0.2);
      // Souffle de bande
      const n = noiseSrc(t, dur);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3500;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.07, t + 0.1);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(hp).connect(gn);
      out(gn, 0.1);
      o.start(t);
      o.stop(t + dur + 0.05);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
      // Arrêt de la bande : petit clac
      this.clip(t + dur - 0.02);
    },

    resolve(at) {
      const t = now(at);
      // Accord de ré, doux et chaud, avec une cloche discrète au-dessus
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(2400, t + 0.6);
      const pad = ctx.createGain();
      pad.gain.setValueAtTime(0.0001, t);
      pad.gain.exponentialRampToValueAtTime(0.1, t + 0.35);
      pad.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
      lp.connect(pad);
      out(pad, 0.55);
      for (const [f, type] of [[146.83, "sine"], [220, "sine"], [293.66, "triangle"], [369.99, "sine"], [440, "sine"]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 8;
        o.connect(lp);
        o.start(t);
        o.stop(t + 3.5);
      }
      for (const [f, peak] of [[1174.66, 0.09], [1174.66 * 2.76, 0.02]] as const) {
        const b = ctx.createOscillator();
        b.frequency.value = f;
        const gb = ctx.createGain();
        env(gb.gain, t + 0.05, peak, 0.004, 1.8);
        b.connect(gb);
        out(gb, 0.7);
        b.start(t + 0.05);
        b.stop(t + 2);
      }
    },

    stop() {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 0.2);
      if ("close" in ctx) setTimeout(() => void (ctx as AudioContext).close().catch(() => {}), 400);
    },
  };
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Réponse impulsionnelle synthétique : bruit stéréo qui s'éteint, comme une petite salle. */
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

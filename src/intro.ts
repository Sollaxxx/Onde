// Animation d'ouverture, jouée une seule fois au tout premier lancement :
// le mot « onde » se dessine, la tête de lecture rouge tombe dans le « d »,
// les lettres s'effacent, une timeline se construit autour de la tête de lecture,
// puis la timeline vient se ranger dans le panneau bleu de l'écran d'accueil.
//
// Tout est dessiné dans le repère de la mini-timeline de l'accueil (220 × 64),
// pour que la dernière étape soit un simple changement d'échelle.

import { liveIntroSound } from "./sonIntro";

const W = 220;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

// Position du mot dans le repère : 256 × 100 unités réduites à 0,352.
const WORD = { x: 64.9, y: 14.5, k: 0.352 };
const STEM_X = WORD.x + 181.5 * WORD.k; // axe du « d » ≈ 128,8

function bars(): string {
  let out = "";
  for (let i = 0; i < 100; i++) {
    const h = 6 + Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.31)) * 16 + (i % 7 === 0 ? 4 : 0);
    out += `<rect class="ib" data-i="${i}" x="${(4 + i * 2.12).toFixed(2)}" y="${((30 - h) / 2 + 30).toFixed(2)}" width="1" height="${h.toFixed(1)}"/>`;
  }
  return out;
}

function ticks(): string {
  let out = "";
  for (let i = 0; i <= 20; i++) out += `<rect x="${i * 11}" y="0" width="1" height="5"/>`;
  return out;
}

function markup(): string {
  return `<div class="intro" aria-hidden="true">
    <svg class="intro-svg" viewBox="-90 -60 400 184" preserveAspectRatio="xMidYMid meet">
      <rect class="intro-box" x="0" y="0" width="${W}" height="64" fill="none"/>
      <g class="i-ticks" fill="rgba(255,255,255,.7)">${ticks()}</g>
      <g class="i-clips" fill="rgba(255,255,255,.18)"><rect x="0" y="10" width="70" height="18"/><rect x="73" y="10" width="47" height="18"/><rect x="123" y="10" width="97" height="18"/></g>
      <rect class="i-band" x="0" y="30" width="${W}" height="30" fill="#fff"/>
      <g class="i-bars" fill="#002FA7">${bars()}</g>
      <g class="i-word" transform="translate(${WORD.x} ${WORD.y}) scale(${WORD.k})" fill="none" stroke="#fff" stroke-width="13">
        <circle pathLength="1" cx="28" cy="52" r="21.5"/>
        <path pathLength="1" d="M72.5 80V24M72.5 52a21.5 21.5 0 0 1 43 0V80"/>
        <circle pathLength="1" cx="160" cy="52" r="21.5"/>
        <path pathLength="1" d="M247.5 52A21.5 21.5 0 1 0 242.5 65.8"/>
        <path pathLength="1" d="M204.5 52H247.5"/>
      </g>
      <g class="i-ph" fill="#E2231A">
        <polygon class="i-head" points="-4.4,0 4.4,0 4.4,3.5 0,7 -4.4,3.5"/>
        <rect class="i-stem" x="-0.5" y="0" width="1" height="1"/>
      </g>
    </svg>
  </div>`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const done = (a: Animation) => a.finished.catch(() => undefined);

export function introWanted(): boolean {
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Joue l'animation. `ready` doit afficher l'écran d'accueil (sous l'animation)
 * et se résoudre quand il est en place : la timeline vient alors s'y ranger.
 */
export async function playIntro(ready: Promise<void>): Promise<void> {
  document.body.insertAdjacentHTML("beforeend", markup());
  const host = document.querySelector<HTMLElement>(".intro")!;
  const svg = host.querySelector<SVGSVGElement>(".intro-svg")!;
  const q = <T extends Element>(s: string) => svg.querySelector<T>(s)!;
  const qa = (s: string) => [...svg.querySelectorAll<SVGElement>(s)];

  let skipped = false;
  const audio = liveIntroSound();
  await audio?.ready;
  const sfx = (fn: (s: NonNullable<typeof audio>["sound"]) => void) => { if (audio && !skipped) fn(audio.sound); };
  const skip = () => { skipped = true; audio?.sound.stop(); host.getAnimations({ subtree: true }).forEach((a) => a.finish()); };
  host.addEventListener("pointerdown", skip);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") skip(); };
  window.addEventListener("keydown", onKey);

  const ph = q<SVGGElement>(".i-ph");
  const head = q<SVGPolygonElement>(".i-head");
  const stem = q<SVGRectElement>(".i-stem");
  const strokes = qa(".i-word > *");
  const fill = { fill: "both" as FillMode };

  // État de départ
  ph.style.transform = `translate(${STEM_X}px, 0)`;
  head.style.transform = `translate(0, 14.5px)`;
  head.style.opacity = "0";
  stem.style.transform = `translate(0px, 19.4px) scale(4.6, 0)`;
  for (const g of qa(".i-ticks, .i-clips > rect, .i-band, .ib")) g.style.opacity = "0";

  // 1. Le mot se dessine
  sfx((s) => s.strokes());
  strokes.forEach((s, i) => {
    s.style.strokeDasharray = "1";
    s.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 750, delay: 120 + i * 110, easing: EASE, ...fill });
  });

  // 2. La tête de lecture tombe dans le « d »
  await wait(skipped ? 0 : 650);
  sfx((s) => s.land());
  // La tête et la barre apparaissent ensemble, d'un seul geste.
  head.animate(
    [{ opacity: 0, transform: "translate(0, 14.5px) scale(0.4)" }, { opacity: 1, transform: "translate(0, 14.5px) scale(1)" }],
    { duration: 620, easing: EASE, ...fill },
  );
  await done(stem.animate(
    [{ transform: "translate(0px, 19.4px) scale(4.6, 0)" }, { transform: "translate(0px, 19.4px) scale(4.6, 23.3)" }],
    { duration: 620, easing: EASE, ...fill },
  ));

  // 3. Les lettres s'effacent, la tête s'étire, la timeline se construit
  await wait(skipped ? 0 : 380);
  sfx((s) => s.build(0.95));
  q<SVGGElement>(".i-word").animate([{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(6px)" }], { duration: 500, easing: EASE, ...fill });
  head.animate([{ transform: "translate(0, 14.5px)" }, { transform: "translate(0, 1px) scale(0.91)" }], { duration: 700, easing: IN_OUT, ...fill });
  stem.animate(
    [{ transform: "translate(0px, 19.4px) scale(4.6, 23.3)" }, { transform: "translate(0px, 5px) scale(1.5, 59)" }],
    { duration: 700, easing: IN_OUT, ...fill },
  );
  const origin = `${STEM_X}px 0`;
  const ticksEl = q<SVGGElement>(".i-ticks");
  ticksEl.style.transformOrigin = origin;
  ticksEl.animate([{ opacity: 0, transform: "scaleX(0)" }, { opacity: 1, transform: "scaleX(1)" }], { duration: 800, delay: 150, easing: EASE, ...fill });
  const band = q<SVGRectElement>(".i-band");
  band.style.transformOrigin = origin;
  band.animate([{ opacity: 1, transform: "scaleX(0)" }, { opacity: 1, transform: "scaleX(1)" }], { duration: 800, delay: 250, easing: EASE, ...fill });
  [0, 1, 2].forEach((i) => setTimeout(() => sfx((s) => s.clip()), 470 + i * 90));
  qa(".i-clips > rect").forEach((c, i) => {
    c.style.transformOrigin = `${[0, 73, 123][i]}px 0`;
    c.animate([{ opacity: 1, transform: "scaleX(0)" }, { opacity: 1, transform: "scaleX(1)" }], { duration: 600, delay: 450 + i * 90, easing: EASE, ...fill });
  });
  for (const b of qa(".ib")) {
    const x = 4 + Number(b.dataset.i) * 2.12;
    b.style.transformOrigin = `${x}px 45px`;
    b.animate([{ opacity: 1, transform: "scaleY(0)" }, { opacity: 1, transform: "scaleY(1)" }], { duration: 520, delay: 450 + Math.abs(x - STEM_X) * 4, easing: EASE, ...fill });
  }

  // 4. La tête de lecture rembobine jusqu'au début
  await wait(skipped ? 0 : 1250);
  sfx((s) => s.rewind(0.75));
  await done(ph.animate([{ transform: `translate(${STEM_X}px, 0)` }, { transform: "translate(26px, 0)" }], { duration: 750, easing: IN_OUT, ...fill }));

  // 5. La timeline se range dans le panneau bleu, la partie blanche s'ouvre
  await ready;
  const target = document.querySelector<SVGSVGElement>(".ob-tl");
  const side = document.querySelector<HTMLElement>(".ob-side");
  const content = document.querySelector<HTMLElement>(".ob-content");
  if (target && side) {
    target.style.visibility = "hidden";
    const from = q<SVGRectElement>(".intro-box").getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const box = svg.getBoundingClientRect();
    const k = to.width / from.width;
    const tx = to.left - box.left - (from.left - box.left) * k;
    const ty = to.top - box.top - (from.top - box.top) * k;
    const right = window.innerWidth - side.getBoundingClientRect().right;
    const top = side.getBoundingClientRect().top;
    svg.style.transformOrigin = "0 0";
    sfx((s) => s.resolve());
    const moving = svg.animate([{ transform: "none" }, { transform: `translate(${tx}px, ${ty}px) scale(${k})` }], { duration: 900, easing: IN_OUT, ...fill });
    host.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: `inset(${top}px ${right}px 0 0)` }], { duration: 900, delay: 120, easing: IN_OUT, ...fill });
    content?.animate([{ opacity: 0, transform: "translateY(16px)", filter: "blur(8px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 700, delay: 600, easing: EASE, fill: "backwards" });
    document.querySelector(".ob-word")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 700, fill: "backwards" });
    document.querySelector(".ob-steps")?.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 600, delay: 800, easing: EASE, fill: "backwards" });
    await done(moving);
    target.style.visibility = "";
  }
  window.removeEventListener("keydown", onKey);
  host.remove();
  if (audio && !skipped) setTimeout(() => audio.sound.stop(), 2600); // laisse sonner la fin, puis libère l'audio
}

// Animation à chaque lancement (≈ 2 s), avec son (réglable) :
// 1. une ligne de temps se déroule depuis le centre, avec ses graduations ;
// 2. le logo complet se construit en grand : l'icône (clip, barres) et « onde » tracé en blanc ;
// 3. la tête de lecture tombe dans le « d » : tic, des ondes s'en échappent (anneaux),
//    et les barres de la forme d'onde montent le long de la ligne de temps ;
// 4. le logo se range à sa place dans la barre, le bleu s'efface, l'application apparaît.
// Si la bibliothèque tarde, les ondes continuent de partir de la tête de lecture.
import { liveIntroSound } from "./sonIntro";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
const BACK = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const done = (a: Animation) => a.finished.catch(() => undefined);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ICON = `<svg class="ln-icon" viewBox="0 0 120 120" aria-hidden="true">
  <rect class="ln-sq" width="120" height="120" fill="#FFFFFF"/>
  <rect class="ln-clip" x="12" y="34" width="96" height="58" fill="#002FA7"/>
  <g fill="#FFFFFF"><rect class="ln-bar" x="22" y="50" width="12" height="26"/><rect class="ln-bar" x="40" y="42" width="12" height="42"/><rect class="ln-bar" x="76" y="46" width="12" height="34"/></g>
  <g class="ln-iph"><polygon points="50,4 78,4 78,20 64,32 50,20" fill="#E2231A"/><rect x="58" y="26" width="12" height="84" fill="#E2231A"/></g>
</svg>`;

const WORD = `<svg class="ln-word" viewBox="0 0 256 100" aria-hidden="true">
  <g fill="none" stroke="#fff" stroke-width="13">
    <circle pathLength="1" cx="28" cy="52" r="21.5"/><path pathLength="1" d="M72.5 80V24M72.5 52a21.5 21.5 0 0 1 43 0V80"/>
    <circle pathLength="1" cx="160" cy="52" r="21.5"/><path pathLength="1" d="M247.5 52A21.5 21.5 0 1 0 242.5 65.8"/><path pathLength="1" d="M204.5 52H254"/>
  </g>
  <g class="ln-ph"><polygon points="169,0 194,0 194,10 181.5,20 169,10" fill="#E2231A"/><rect x="175" y="14" width="13" height="66" fill="#E2231A"/></g>
</svg>`;

export type LaunchMode = "son" | "muet" | "off";

export function launchWanted(mode: LaunchMode): boolean {
  return mode !== "off" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function timeline(): string {
  let ticks = "", bars = "";
  for (let i = 0; i <= 48; i++) ticks += `<i style="left:${(i / 48) * 100}%;height:${i % 4 ? 8 : 16}px"></i>`;
  for (let i = 0; i < 64; i++) {
    const h = 0.25 + Math.abs(Math.sin(i * 0.83) * Math.cos(i * 0.29)) * 0.75;
    bars += `<b data-x="${i / 63}" style="left:${(i / 63) * 100}%;--h:${h.toFixed(2)}"></b>`;
  }
  return `<div class="ln-tl"><div class="ln-line"></div><div class="ln-ticks">${ticks}</div><div class="ln-bars">${bars}</div></div>`;
}

/** Joue l'animation ; `ready` affiche l'application derrière et se résout quand elle est en place. */
export async function playLaunch(ready: Promise<void>, mode: LaunchMode): Promise<void> {
  const host = document.createElement("div");
  host.className = "launch";
  // La scène reste cachée tant que le son n'est pas prêt : rien ne doit apparaître avant son tour.
  host.innerHTML = `<div class="ln-stage" style="visibility:hidden"><div class="ln-logo">${ICON}${WORD}</div><div class="ln-rings"></div>${timeline()}</div>`;
  document.body.appendChild(host);
  const $ = <T extends Element>(s: string) => host.querySelector<T>(s)!;
  const $$ = <T extends Element>(s: string) => [...host.querySelectorAll<T>(s)];

  const audio = mode === "son" ? liveIntroSound() : null;
  await audio?.ready;
  let skipped = false;
  host.addEventListener("pointerdown", () => { skipped = true; audio?.sound.stop(); host.getAnimations({ subtree: true }).forEach((a) => a.finish()); });
  const fill = { fill: "both" as FillMode };
  if (audio && !skipped) audio.sound.launch();
  // Toutes les animations ci-dessous sont créées dans la même tâche : la scène s'affiche directement dans son état de départ.
  $<HTMLElement>(".ln-stage").style.visibility = "";

  // 1. La ligne de temps se déroule depuis le centre
  $<HTMLElement>(".ln-line").animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 520, easing: EASE, ...fill });
  $$<HTMLElement>(".ln-ticks i").forEach((t) => {
    const x = parseFloat(t.style.left) / 100;
    t.animate([{ opacity: 0, transform: "scaleY(0)" }, { opacity: 1, transform: "scaleY(1)" }], { duration: 300, delay: 40 + Math.abs(x - 0.5) * 520, easing: EASE, ...fill });
  });

  // 2. Le logo se construit
  const icon = $<SVGSVGElement>(".ln-icon"), word = $<SVGSVGElement>(".ln-word");
  icon.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, delay: 80, easing: BACK, ...fill });
  const clip = $<SVGRectElement>(".ln-clip");
  clip.style.transformOrigin = "60px 63px";
  clip.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 380, delay: 160, easing: EASE, ...fill });
  $$<SVGRectElement>(".ln-bar").forEach((b, i) => {
    b.style.transformOrigin = `0 ${Number(b.getAttribute("y")) + Number(b.getAttribute("height")) / 2}px`;
    b.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 360, delay: 300 + i * 70, easing: BACK, ...fill });
  });
  $<SVGGElement>(".ln-iph").animate([{ transform: "translateY(-30px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, delay: 600, easing: BACK, ...fill });
  $$<SVGElement>(".ln-word circle, .ln-word path").forEach((p, i) => {
    p.style.strokeDasharray = "1";
    p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 420, delay: 160 + i * 75, easing: EASE, ...fill });
  });

  // 3. La tête de lecture tombe dans le « d » (à 0,8 s) : tic, ondes, barres
  const ph = $<SVGGElement>(".ln-ph");
  ph.animate([{ transform: "translateY(-60px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, delay: 440, easing: BACK, ...fill });
  const rings = $<HTMLElement>(".ln-rings");
  const wave = (delay: number) => {
    // Les ondes partent de la tête de lecture du « d »
    const w = word.getBoundingClientRect(), s = $<HTMLElement>(".ln-stage").getBoundingClientRect();
    const cx = w.left - s.left + (181.5 / 256) * w.width, cy = w.top - s.top + (52 / 100) * w.height;
    for (let k = 0; k < 3; k++) {
      const r = document.createElement("span");
      r.style.left = `${cx}px`; r.style.top = `${cy}px`;
      rings.appendChild(r);
      // Invisible avant son tour, apparaît en fondu, puis s'efface en s'élargissant
      r.animate([{ transform: "translate(-50%, -50%) scale(.15)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(.27)", opacity: 0.9, offset: 0.14 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 0 }],
        { duration: 900, delay: delay + k * 140, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)", fill: "both" }).onfinish = () => r.remove();
    }
  };
  wave(800);
  $$<HTMLElement>(".ln-bars b").forEach((b) => {
    const x = Number(b.dataset.x);
    b.animate([{ transform: "scaleY(0)", opacity: 0 }, { transform: "scaleY(1)", opacity: 1, offset: 0.4 }, { transform: "scaleY(.35)", opacity: 0.55 }],
      { duration: 700, delay: 820 + Math.abs(x - 0.5) * 420, easing: "ease-out", ...fill });
  });
  await wait(skipped ? 0 : 1300);

  // Si la bibliothèque tarde : de nouvelles ondes partent régulièrement
  let isReady = false;
  void ready.then(() => { isReady = true; });
  while (!isReady && !skipped) { wave(0); await wait(700); }
  await ready;

  // 4. Le logo se range dans la barre, le bleu s'efface, l'application apparaît
  const targets = [...document.querySelectorAll<SVGSVGElement>(".brand svg")];
  const steps: Promise<unknown>[] = [];
  const fly = (el: SVGSVGElement, to?: SVGSVGElement) => {
    if (!to) return;
    const a = el.getBoundingClientRect(), b = to.getBoundingClientRect();
    const k = b.width / a.width;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    to.style.visibility = "hidden";
    steps.push(done(el.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }], { duration: 560, easing: IN_OUT, ...fill })));
  };
  fly(icon, targets[0]);
  fly(word, targets[1]);
  $$<HTMLElement>(".ln-tl, .ln-rings").forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: "ease-out", ...fill }));
  steps.push(done(host.animate([{ backgroundColor: "#002FA7" }, { backgroundColor: "rgba(0, 47, 167, 0)" }], { duration: 500, delay: 140, easing: IN_OUT, ...fill })));
  document.querySelectorAll<HTMLElement>(".titlebar .tb-actions, .body > *, .minibar").forEach((el, i) => {
    el.animate([{ opacity: 0, transform: "translateY(8px)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: 460, delay: 220 + i * 60, easing: EASE, fill: "backwards" });
  });
  await Promise.all(steps);
  targets.forEach((t) => (t.style.visibility = ""));
  host.remove();
  if (audio) setTimeout(() => audio.sound.stop(), 1500);
}

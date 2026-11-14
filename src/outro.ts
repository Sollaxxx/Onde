// Passage de l'écran d'accueil à l'application, comme un rideau :
// 1. la tête de lecture de la mini-timeline joue jusqu'au bout, le texte se dissout ;
// 2. le panneau bleu s'élargit jusqu'à couvrir la fenêtre (le rideau se ferme) ;
// 3. une grande tête de lecture rouge traverse l'écran de gauche à droite et,
//    derrière elle, l'application apparaît : chaque élément s'allume quand elle passe.
import { liveIntroSound } from "./sonIntro";

const IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const done = (a: Animation) => a.finished.catch(() => undefined);

export async function playOutro(showApp: () => void): Promise<void> {
  const side = document.querySelector<HTMLElement>(".ob-side");
  if (!side || matchMedia("(prefers-reduced-motion: reduce)").matches) { showApp(); return; }

  const audio = liveIntroSound();
  await audio?.ready;
  const W = window.innerWidth;
  const fill = { fill: "both" as FillMode };

  // 1. La mini-timeline joue jusqu'au bout, le contenu se dissout
  const head = side.querySelector<SVGGElement>(".ob-head");
  if (head) {
    head.style.transition = "none";
    head.animate([{ transform: getComputedStyle(head).transform }, { transform: "translateX(219px)" }], { duration: 520, easing: IN_OUT, ...fill });
  }
  document.querySelector(".ob-main")?.animate(
    [{ opacity: 1, filter: "blur(0)", transform: "none" }, { opacity: 0, filter: "blur(10px)", transform: "translateX(-24px)" }],
    { duration: 480, easing: EASE, ...fill },
  );
  side.querySelectorAll(".ob-steps, .ob-slogan").forEach((el, i) =>
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 180 + i * 60, ...fill }));

  // 2. Le rideau bleu se ferme sur toute la fenêtre
  const veil = document.createElement("div");
  veil.className = "outro";
  document.body.appendChild(veil);
  const right = W - side.getBoundingClientRect().right;
  audio?.sound.curtain(0.62);
  await done(veil.animate([{ clipPath: `inset(0 ${right}px 0 0)` }, { clipPath: "inset(0 0 0 0)" }], { duration: 620, delay: 120, easing: IN_OUT, ...fill }));

  // 3. L'application est rendue derrière le rideau, puis la tête de lecture la révèle
  showApp();
  await new Promise(requestAnimationFrame);
  const sweep = 1050;
  audio?.sound.sweep(sweep / 1000);
  // La tête de lecture est posée au-dessus du rideau, sur son bord
  const ph = document.createElement("div");
  ph.className = "outro-ph";
  ph.innerHTML = "<i></i>";
  document.body.appendChild(ph);
  ph.animate([{ transform: "translateX(-4px)" }, { transform: `translateX(${W + 4}px)` }], { duration: sweep, easing: IN_OUT, ...fill });
  const reveal = veil.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: `inset(0 0 0 ${W}px)` }], { duration: sweep, easing: IN_OUT, ...fill });

  // Chaque élément s'allume quand la tête de lecture passe dessus
  const targets = document.querySelectorAll<HTMLElement>(
    ".titlebar .brand, .titlebar .tb-btn, .side .nav > *, .side .folder, .searchbar, .chips, .list > .row:nth-child(-n+14), .detail > *, .minibar",
  );
  const at = (x: number) => {
    // Inverse approché de la courbe IN_OUT : instant où la tête atteint l'abscisse x
    const p = Math.min(1, Math.max(0, x / W));
    const u = p < 0.5 ? Math.cbrt(p / 4) : 1 - Math.cbrt((1 - p) / 4);
    return u * sweep;
  };
  targets.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    el.animate(
      [{ opacity: 0, transform: "translateY(10px)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: 520, delay: at(r.left + 8) + (i % 3) * 12, easing: EASE, fill: "backwards" },
    );
  });

  await done(reveal);
  veil.remove();
  ph.remove();
  if (audio) setTimeout(() => audio.sound.stop(), 2200);
}

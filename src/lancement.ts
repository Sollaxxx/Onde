// Petite animation à chaque lancement (≈ 1,3 s) :
// l'icône d'Onde se construit au centre (le clip, les barres, la tête de lecture qui tombe),
// la tête de lecture balaie le clip, puis l'icône vient se ranger à sa place dans la barre
// pendant que le bleu s'efface. Si la bibliothèque tarde, la tête de lecture balaie en boucle.

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
const BACK = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const done = (a: Animation) => a.finished.catch(() => undefined);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SVG = `<svg class="ln-icon" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
  <rect class="ln-clip" x="12" y="34" width="96" height="58" fill="#FFFFFF"/>
  <g fill="#002FA7"><rect class="ln-bar" x="22" y="50" width="12" height="26"/><rect class="ln-bar" x="40" y="42" width="12" height="42"/><rect class="ln-bar" x="76" y="46" width="12" height="34"/></g>
  <g class="ln-ph"><polygon points="50,4 78,4 78,20 64,32 50,20" fill="#E2231A"/><rect x="58" y="26" width="12" height="84" fill="#E2231A"/></g>
</svg>`;

export function launchWanted(enabled: boolean): boolean {
  return enabled && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Joue l'animation ; `ready` affiche l'application derrière et se résout quand elle est en place. */
export async function playLaunch(ready: Promise<void>): Promise<void> {
  const host = document.createElement("div");
  host.className = "launch";
  host.innerHTML = SVG;
  document.body.appendChild(host);
  const icon = host.querySelector<SVGSVGElement>(".ln-icon")!;
  const q = <T extends Element>(s: string) => icon.querySelector<T>(s)!;
  let skipped = false;
  host.addEventListener("pointerdown", () => { skipped = true; host.getAnimations({ subtree: true }).forEach((a) => a.finish()); });
  const fill = { fill: "both" as FillMode };

  // 1. L'icône se construit
  const clip = q<SVGRectElement>(".ln-clip");
  clip.style.transformOrigin = "60px 63px";
  clip.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 380, easing: EASE, ...fill });
  icon.querySelectorAll<SVGRectElement>(".ln-bar").forEach((b, i) => {
    const y = Number(b.getAttribute("y")) + Number(b.getAttribute("height")) / 2;
    b.style.transformOrigin = `0 ${y}px`;
    b.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 360, delay: 160 + i * 70, easing: BACK, ...fill });
  });
  const ph = q<SVGGElement>(".ln-ph");
  ph.animate([{ transform: "translateY(-46px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, delay: 300, easing: BACK, ...fill });
  await wait(skipped ? 0 : 720);

  // 2. La tête de lecture balaie le clip (en boucle tant que l'application n'est pas prête)
  let isReady = false;
  void ready.then(() => { isReady = true; });
  do {
    if (skipped) break;
    await done(ph.animate([{ transform: "none" }, { transform: "translateX(-38px)" }, { transform: "translateX(36px)" }, { transform: "none" }],
      { duration: 540, easing: IN_OUT }));
  } while (!isReady && !skipped);
  await ready;

  // 3. L'icône se range à sa place dans la barre, le bleu s'efface, l'application apparaît
  const target = document.querySelector<SVGSVGElement>(".brand svg");
  const from = icon.getBoundingClientRect();
  const steps: Promise<unknown>[] = [];
  if (target) {
    const to = target.getBoundingClientRect();
    const k = to.width / from.width;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    target.style.visibility = "hidden";
    steps.push(done(icon.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }], { duration: 520, easing: IN_OUT, ...fill })));
  }
  steps.push(done(host.animate([{ backgroundColor: "#002FA7" }, { backgroundColor: "rgba(0, 47, 167, 0)" }], { duration: 480, delay: 120, easing: IN_OUT, ...fill })));
  document.querySelectorAll<HTMLElement>(".titlebar .tb-actions, .body > *, .minibar").forEach((el, i) => {
    el.animate([{ opacity: 0, transform: "translateY(8px)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: 460, delay: 200 + i * 60, easing: EASE, fill: "backwards" });
  });
  await Promise.all(steps);
  if (target) target.style.visibility = "";
  host.remove();
}

// Écran de premier lancement : 4 étapes (mode, dossier des sons, logiciels, raccourcis).
// Affiché une seule fois ; on peut le revoir depuis les Réglages.
import type { Theme } from "./types";

export interface Accueil {
  step: number;              // 0 à 3
  defaultDir: string;        // Documents\Onde
  customDir: string | null;  // dossier choisi à l'étape 2
  useCustom: boolean;
}

export const STEPS = ["Bienvenue", "Dossier des sons", "Logiciels de montage", "C'est prêt"];

/** Recherches vérifiées sur la bibliothèque : chacune donne des résultats. */
export const SUGGESTIONS = ["porte qui grince", "whoosh", "orage", "explosion", "applaudissements"];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ARROW = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
const BACK = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M14 8H3M7 4L3 8l4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;

/** Mini timeline décorative du panneau bleu : la tête de lecture avance à chaque étape. */
function timeline(step: number): string {
  let ticks = "";
  for (let i = 0; i <= 20; i++) ticks += `<rect x="${i * 11}" y="0" width="1" height="5"/>`;
  let bars = "";
  for (let i = 0; i < 100; i++) {
    const h = 6 + Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.31)) * 16 + (i % 7 === 0 ? 4 : 0);
    bars += `<rect x="${4 + i * 2.12}" y="${(30 - h) / 2 + 30}" width="1" height="${h.toFixed(1)}"/>`;
  }
  const x = [26, 82, 140, 196][step];
  return `<svg class="ob-tl" viewBox="0 0 220 64" aria-hidden="true">
    <g fill="rgba(255,255,255,.7)">${ticks}</g>
    <g fill="rgba(255,255,255,.18)"><rect x="0" y="10" width="70" height="18"/><rect x="73" y="10" width="47" height="18"/><rect x="123" y="10" width="97" height="18"/></g>
    <rect x="0" y="30" width="220" height="30" fill="#fff"/>
    <g fill="#002FA7">${bars}</g>
    <g class="ob-head" style="transform:translateX(${x}px)"><polygon points="-4,1 4,1 4,5 0,8 -4,5" fill="#E2231A"/><rect x="-0.75" y="5" width="1.5" height="59" fill="#E2231A"/></g>
  </svg>`;
}

function panel(step: number, word: string): string {
  return `<aside class="ob-side">
    <div class="ob-word">${word}</div>
    ${timeline(step)}
    <ol class="ob-steps">
      ${STEPS.map((label, i) => `<li class="${i === step ? "on" : i < step ? "done" : ""}" ${i === step ? 'aria-current="step"' : ""}>
        <span class="n">${i < step ? "✓" : String(i + 1).padStart(2, "0")}</span><span>${label}</span></li>`).join("")}
    </ol>
    <p class="ob-slogan">Gratuit, et ça s'entend.</p>
  </aside>`;
}

function stepBody(a: Accueil, theme: Theme): string {
  switch (a.step) {
    case 0: {
      const mode = (v: Theme, label: string) => `<button class="ob-mode ${v}" role="radio" aria-checked="${theme === v}" data-act="ob-theme" data-value="${v}">
        <span class="prev" aria-hidden="true"><i></i><i></i><i></i><b></b></span><span>${label}</span></button>`;
      return `<h1>Bienvenue dans Onde.</h1>
        <p class="lead">Des bruitages et des musiques libres de droits, à glisser directement dans votre timeline. On règle deux ou trois choses et vous êtes prêt.</p>
        <div class="ob-pills"><span>GRATUIT</span><span>SANS COMPTE</span><span>SONS CC0</span></div>
        <p class="ob-label" id="ob-mode-l">Choisissez votre mode</p>
        <div class="ob-modes" role="radiogroup" aria-labelledby="ob-mode-l">${mode("clair", "Clair")}${mode("sombre", "Sombre")}</div>`;
    }
    case 1:
      return `<h1>Où ranger vos sons&nbsp;?</h1>
        <p class="lead">Votre logiciel de montage retrouve les sons par leur emplacement. Choisissez un dossier qui ne bougera pas.</p>
        <div class="ob-choices" role="radiogroup" aria-label="Dossier des sons">
          <button class="ob-choice" role="radio" aria-checked="${!a.useCustom}" data-act="ob-dir-default">
            <span class="box" aria-hidden="true"></span>
            <span><span><b>Dossier Onde</b> <em>· recommandé</em></span><span class="mono path">${esc(a.defaultDir)}</span></span>
          </button>
          <button class="ob-choice" role="radio" aria-checked="${a.useCustom}" data-act="ob-dir-pick">
            <span class="box" aria-hidden="true"></span>
            <span><b>Un autre dossier…</b>${a.customDir ? `<span class="mono path">${esc(a.customDir)}</span>` : `<span class="sub">Un disque externe ou un serveur partagé, par exemple.</span>`}</span>
          </button>
        </div>
        <p class="ob-note">Rien n'est téléchargé d'avance : un son arrive sur votre disque seulement quand vous l'utilisez. Vous pourrez changer de dossier dans les Réglages.</p>`;
    case 2: {
      const apps: [string, string, string][] = [
        ["Pr", "Premiere Pro", "Glissez vers la timeline ou le panneau Projet"],
        ["Dr", "DaVinci Resolve", "Glissez vers la timeline ou le Media Pool"],
        ["Cc", "CapCut", "Glissez vers le panneau Média ou la piste audio"],
        ["Av", "Avid Media Composer", "Glissez vers un chutier"],
      ];
      return `<h1>Ça marche avec vos logiciels.</h1>
        <p class="lead">Rien à installer : attrapez un son dans Onde et lâchez-le dans votre logiciel de montage. C'est tout.</p>
        <div class="ob-apps">${apps.map(([ini, name, info]) => `<div class="ob-app"><span class="ini" aria-hidden="true">${ini}</span>
          <span><b>${name}</b><span class="sub">${info}</span></span><span class="badge on">PRÊT</span></div>`).join("")}</div>
        <p class="ob-note">Des panneaux Onde intégrés à Premiere et DaVinci arrivent bientôt : ils apparaîtront dans le bouton Intégrations.</p>`;
    }
    default:
      return `<h1>C'est prêt.</h1>
        <p class="lead">Trois gestes à retenir, et vous ne quitterez plus votre timeline.</p>
        <div class="ob-keys">
          <div><span class="kbd">CTRL K</span><b>Chercher</b></div>
          <div><span class="kbd">ESPACE</span><b>Écouter</b></div>
          <div><span class="kbd">GLISSER</span><b>Insérer</b></div>
        </div>
        <p class="ob-label">Essayez une première recherche</p>
        <div class="ob-try">${SUGGESTIONS.map((q) => `<button data-act="ob-try" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
  }
}

export function accueilScreen(a: Accueil, theme: Theme, word: string, winButtons: string): string {
  const last = a.step === STEPS.length - 1;
  const next = a.step === 0 ? "Commencer" : last ? "Ouvrir la bibliothèque" : "Continuer";
  return `<div class="ob">
    <div class="ob-bar" data-tauri-drag-region>${winButtons}</div>
    ${panel(a.step, word)}
    <main class="ob-main">
      <div class="ob-content">
        <p class="eyebrow">Étape ${a.step + 1} sur ${STEPS.length}</p>
        ${stepBody(a, theme)}
      </div>
      <footer class="ob-foot">
        ${a.step === 0 ? `<button class="ob-skip" data-act="ob-skip">Passer la configuration</button>` : `<button class="ob-back" data-act="ob-back">${BACK}Retour</button>`}
        <button class="ob-next" data-act="ob-next">${next}${ARROW}</button>
      </footer>
    </main>
  </div>`;
}

// Panneau Onde, version DaVinci Resolve Studio (Workflow Integration).
// L'interface est celle du panneau Premiere ; fichiers, réseau et Resolve passent par preload.js → main.js.
import { startPanel, type Host, type TeamContent } from "../../premiere/src/ui";
import { t } from "../../src/i18n";

type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

interface OndeBridge {
  sep: string;
  libraryDir(): Promise<Reply<string>>;
  getJson(url: string): Promise<Reply<any>>;
  download(url: string, dest: string): Promise<Reply<void>>;
  insert(file: string, durationSec: number): Promise<Reply<{ track: number; timecode: string }>>;
  markUsed(file: string): Promise<Reply<void>>;
  teamContent(): Promise<Reply<TeamContent | null>>;
  startDrag(file: string): void;
}

declare global { interface Window { onde?: OndeBridge } }

const ERRORS: Record<string, string> = {
  "hors-resolve": "panneau ouvert hors de DaVinci Resolve",
  "pas-de-reponse": "DaVinci Resolve n'a pas répondu. Le panneau Onde demande DaVinci Resolve Studio.",
  noproject: "ouvrez d'abord un projet",
  notimeline: "ouvrez une timeline",
  import: "le son n'a pas pu être importé",
  refused: "Resolve a refusé l'insertion",
};

function errorText(code: string): string {
  const http = /^http-(\d+)$/.exec(code);
  if (http) return t("réponse {code} du serveur", { code: http[1] });
  return ERRORS[code] ? t(ERRORS[code]) : code;
}

async function call<T>(reply: Promise<Reply<T>>): Promise<T> {
  const r = await reply;
  if (!r.ok) throw new Error(errorText(r.error));
  return r.value;
}

const bridge = window.onde;

if (!bridge) {
  document.getElementById("status")!.textContent = t(ERRORS["hors-resolve"]);
} else {
  const host: Host = {
    canDrag: true,
    sep: bridge.sep,
    libraryDir: () => call(bridge.libraryDir()),
    getJson: (url) => call(bridge.getJson(url)),
    download: (url, dest) => call(bridge.download(url, dest)),
    async insert(file, durationSec, title) {
      const r = await call(bridge.insert(file, durationSec));
      return t("« {title} » posé sur A{track} à {tc}.", { title, track: r.track, tc: r.timecode });
    },
    markUsed: (file) => call(bridge.markUsed(file)),
    teamContent: () => call(bridge.teamContent()),
    setDragData() { /* remplacé par startNativeDrag */ },
    startNativeDrag: (file) => bridge.startDrag(file),
    dropHint: (title) => t("Lâchez « {title} » dans la timeline ou le Media Pool.", { title }),
  };
  startPanel(host);
}

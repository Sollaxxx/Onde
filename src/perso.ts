// Sons personnels → objets Sound, pour les mélanger à la banque (recherche, playlists, glisser).
import type { UserSound } from "./api";
import type { Sound } from "./types";

export const PERSO_CATEGORY = "Mes sons";

/** Identifiant stable tiré du chemin (les playlists retrouvent le son d'une session à l'autre). */
export function persoId(path: string): string {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619);
  return `perso-${(h >>> 0).toString(36)}-${path.length.toString(36)}`;
}

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** « pas_gravier-02.wav » → « pas gravier 02 » */
function titleOf(path: string): string {
  return base(path).replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim() || base(path);
}

export function toSound(u: UserSound): Sound {
  return {
    id: persoId(u.path),
    title: titleOf(u.path),
    code: "PERSO",
    category: PERSO_CATEGORY,
    tags: [base(u.root), ...u.dirs].filter(Boolean),
    durationMs: u.durationMs ?? 0,
    file: base(u.path),
    format: u.format ?? (base(u.path).split(".").pop() ?? "").toUpperCase(),
    license: "Votre son",
    peaks: u.peaks?.length ? u.peaks : [],
    local: u.path,
  };
}

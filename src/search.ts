import type { Sound } from "./types";

/** Minuscules, sans accents : « Cœur » et « coeur » se valent. */
export function normalize(s: string): string {
  return s
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "oe")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Quelques équivalences anglais/français et synonymes courants des monteurs.
const SYNONYMS: Record<string, string[]> = {
  boom: ["impact"], hit: ["impact"], trailer: ["bande-annonce"], door: ["porte"], porte: ["door"],
  rain: ["pluie"], wind: ["vent"], click: ["clic"], clic: ["click"], steps: ["pas"], footsteps: ["pas"],
  heart: ["coeur"], swoosh: ["whoosh"], woosh: ["whoosh"], whoosh: ["swoosh"], riser: ["montee"],
  clock: ["horloge"], radio: ["parasite"], drone: ["nappe"], ui: ["interface"],
};

function hay(s: Sound): string {
  return normalize([s.title, s.code, s.category, ...s.tags].join(" "));
}

export function search(catalog: Sound[], query: string): Sound[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return catalog;
  return catalog.filter((s) => {
    const h = hay(s);
    return words.every((w) => h.includes(w) || (SYNONYMS[w] ?? []).some((alt) => h.includes(alt)));
  });
}

export function formatDuration(ms: number): string {
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

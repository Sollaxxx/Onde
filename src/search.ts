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

/** Petits mots ignorés dans la recherche (« porte qui grince » = « porte grince »). */
const STOP = new Set("a au aux avec d de des du en et l la le les sur un une qui que dans par pour the of on in with and to for at".split(" "));

interface Index { title: string[]; tags: string[]; desc: string[] }
const indexCache = new WeakMap<Sound, Index>();
const words = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

function indexOf(s: Sound): Index {
  let idx = indexCache.get(s);
  if (!idx) {
    idx = {
      title: words(`${s.title} ${s.titleEn ?? ""}`),
      tags: words(`${s.tags.join(" ")} ${s.category} ${s.code} ${s.ucs ?? ""}`),
      desc: words(`${s.description ?? ""} ${s.descriptionEn ?? ""}`),
    };
    indexCache.set(s, idx);
  }
  return idx;
}

/** Score d'un mot de la recherche : titre (3) > mots-clés et catégorie (2) > description (1). */
function wordScore(idx: Index, w: string): number {
  const hit = (list: string[]) => list.some((x) => x.startsWith(w));
  const alts = [w, ...(SYNONYMS[w] ?? [])];
  if (alts.some((a) => idx.title.some((x) => x.startsWith(a)))) return 3;
  if (alts.some((a) => idx.tags.some((x) => x.startsWith(a)))) return 2;
  return hit(idx.desc) || alts.some((a) => idx.desc.some((x) => x.startsWith(a))) ? 1 : 0;
}

/** Tous les mots doivent être trouvés ; les meilleurs résultats (titre) d'abord. */
export function search(catalog: Sound[], query: string): Sound[] {
  const qs = words(query).filter((w) => !STOP.has(w));
  if (!qs.length) return catalog;
  const scored: { s: Sound; score: number; i: number }[] = [];
  catalog.forEach((s, i) => {
    const idx = indexOf(s);
    let score = 0;
    for (const w of qs) {
      const k = wordScore(idx, w);
      if (!k) return;
      score += k;
    }
    scored.push({ s, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.s);
}

export function formatDuration(ms: number): string {
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export interface Sound {
  id: string;
  title: string;
  code: string;
  category: string;
  tags: string[];
  durationMs: number;
  file: string;
  format: string;
  license: string;
  peaks: number[];
  titleEn?: string;
  /** Identifiant de la contribution d'origine (sons proposés par la communauté). */
  contribution?: string;
  description?: string;
  descriptionEn?: string;
  ucs?: string;
  author?: string;
  credit?: string;
  source?: string;
  sourceUrl?: string;
  bytes?: number;
}

/** « en ligne » : bibliothèque Cloudflare ; « cache » : dernière copie hors ligne ; « test » : sons de test. */
export interface Catalog {
  origin: "en ligne" | "cache" | "test";
  cdn: string;
  sounds: Sound[];
}

export type Theme = "clair" | "sombre" | "systeme";
export type View = "tout" | "favoris" | "recents";

export interface UpdateInfo {
  version: string;
  notes: string;
  install: () => Promise<void>;
}

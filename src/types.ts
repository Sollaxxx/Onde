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
}

export type Theme = "clair" | "sombre" | "systeme";
export type View = "tout" | "favoris" | "recents";

export interface UpdateInfo {
  version: string;
  notes: string;
  install: () => Promise<void>;
}

// Contenu partagé des équipes (Onde Équipe) : sons et playlists de l'équipe.
// Synchronisé avec le serveur (au démarrage, toutes les minutes et au retour sur la fenêtre) et gardé
// sur l'ordinateur : hors ligne, la liste reste là et les sons déjà téléchargés restent utilisables.
import * as api from "./api";
import type { Sound } from "./types";

export type Role = "proprietaire" | "membre";
export interface TeamInfo { id: string; name: string; role: Role; active: boolean; status: string; storageGb: number }
export interface TeamPlaylist { id: string; teamId: string; name: string; createdBy: string; updatedAt: string; ids: string[] }
interface RawSound {
  id: string; title: string; fileName: string; size: number; durationMs: number; peaks: number[]; tags: string[];
  format: string; addedBy: string | null; addedByName: string; createdAt: string; url: string;
}
interface Content {
  teamId: string; version: number; storageUsed: number; storageGb: number; linksExpireAt: string;
  sounds: RawSound[]; playlists: Omit<TeamPlaylist, "teamId">[];
}
interface Cache { teams: TeamInfo[]; me: string | null; contents: Content[] }

const CACHE_KEY = "onde.equipes";
const SYNC_EVERY = 60_000;
export const TEAM_CODE = "EQP";

export interface TeamsHost {
  changed: () => void;
  /** Le chemin local d'un son vient d'être connu (téléchargé ou déjà là). */
  located: (id: string, path: string) => void;
}

export function createTeams(host: TeamsHost) {
  let teams: TeamInfo[] = [];
  let me: string | null = null;
  const contents = new Map<string, Content>();
  let all: Sound[] = [];
  const raw = new Map<string, RawSound & { teamId: string }>(); // eq-<id> → son brut
  const present = new Map<string, string>(); // eq-<id> → chemin sur l'ordinateur
  let syncing = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  // ---------- Cache local ----------
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as Cache | null;
    if (c) { teams = c.teams ?? []; me = c.me ?? null; for (const x of c.contents ?? []) contents.set(x.teamId, x); }
  } catch { /* cache absent ou illisible */ }

  function save(): void {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ teams, me, contents: [...contents.values()] } satisfies Cache)); } catch { /* stockage plein : tant pis */ }
  }

  const teamOf = (id: string) => teams.find((t) => t.id === id) ?? null;

  function rebuild(): void {
    all = [];
    raw.clear();
    for (const c of contents.values()) {
      const team = teamOf(c.teamId);
      if (!team) continue;
      for (const r of c.sounds) {
        const id = `eq-${r.id}`;
        raw.set(id, { ...r, teamId: c.teamId });
        all.push({
          id, title: r.title, titleEn: r.title, code: TEAM_CODE, category: team.name, tags: r.tags ?? [],
          durationMs: r.durationMs, file: r.fileName, format: r.format, license: "Son de l'équipe",
          peaks: r.peaks ?? [], author: r.addedByName || undefined, team: c.teamId, remote: r.url,
        });
      }
    }
  }

  async function locate(): Promise<void> {
    for (const c of contents.values()) {
      const team = teamOf(c.teamId);
      if (!team || !c.sounds.length) continue;
      const found = await api.teamPresent(team.name, c.sounds.map((s) => ({ id: s.id, fileName: s.fileName }))).catch(() => ({} as Record<string, string>));
      for (const [id, path] of Object.entries(found)) {
        present.set(`eq-${id}`, path);
        host.located(`eq-${id}`, path);
      }
    }
  }

  async function syncTeam(team: TeamInfo): Promise<void> {
    const cur = contents.get(team.id);
    // Les liens temporaires durent 12 h : passé le délai, on recharge tout même si rien n'a changé.
    const fresh = cur && Date.parse(cur.linksExpireAt) > Date.now();
    const r = await api.accountApi("GET", `equipe/${team.id}/contenu?v=${fresh ? cur.version : -1}`);
    if (r.unchanged) return;
    contents.set(team.id, {
      teamId: team.id, version: r.version, storageUsed: r.storageUsed, storageGb: r.storageGb, linksExpireAt: r.linksExpireAt,
      sounds: r.sounds, playlists: r.playlists,
    });
  }

  async function sync(): Promise<void> {
    if (syncing || !teams.length || !navigator.onLine) return;
    syncing = true;
    try {
      for (const team of teams) {
        if (!team.active) { contents.delete(team.id); continue; }
        try { await syncTeam(team); } catch (e) {
          // Essai terminé ou équipe suspendue entre-temps : on retire son contenu
          if ((e as api.AccountError).code === "equipe-inactive" || (e as api.AccountError).status === 403) contents.delete(team.id);
        }
      }
      save();
      rebuild();
      await locate();
      host.changed();
    } finally {
      syncing = false;
    }
  }

  function startTimer(): void {
    if (timer || !teams.length) return;
    timer = setInterval(() => void sync(), SYNC_EVERY);
    window.addEventListener("focus", () => void sync());
  }

  /** Recharge tout de suite (après un changement fait par soi-même). */
  const refresh = () => sync();

  function playlistLocal(id: string): (TeamPlaylist & { content: Content }) | null {
    for (const c of contents.values()) {
      const p = c.playlists.find((x) => x.id === id);
      if (p) return { ...p, teamId: c.teamId, content: c };
    }
    return null;
  }

  rebuild();

  return {
    /** Équipes du compte (après connexion, ou au démarrage). Liste vide = déconnecté. */
    setTeams(list: TeamInfo[], accountId: string | null): void {
      teams = list;
      me = accountId;
      for (const id of [...contents.keys()]) if (!list.some((t) => t.id === id && t.active)) contents.delete(id);
      save();
      rebuild();
      host.changed();
      if (list.length) { startTimer(); void sync(); }
    },
    /** Au démarrage : retrouve les fichiers déjà téléchargés (utile hors ligne). */
    locate,
    refresh,

    sounds: () => all,
    teams: () => teams,
    activeTeams: () => teams.filter((t) => t.active),
    team: teamOf,
    teamSounds: (teamId: string | null) => all.filter((s) => s.team === teamId),
    playlists: (teamId: string) => (contents.get(teamId)?.playlists ?? []).map((p) => ({ ...p, teamId })),
    playlist: (id: string | null): TeamPlaylist | null => {
      const p = id ? playlistLocal(id) : null;
      return p ? { id: p.id, teamId: p.teamId, name: p.name, createdBy: p.createdBy, updatedAt: p.updatedAt, ids: p.ids } : null;
    },
    storage: (teamId: string) => ({ used: contents.get(teamId)?.storageUsed ?? 0, gb: contents.get(teamId)?.storageGb ?? teamOf(teamId)?.storageGb ?? 0 }),
    isLocal: (s: Sound) => present.has(s.id),
    localPath: (s: Sound) => present.get(s.id) ?? null,
    addedBy: (s: Sound) => raw.get(s.id)?.addedBy ?? null,

    /** L'auteur du son ou un propriétaire peut le renommer ou le supprimer. */
    canEdit(s: Sound): boolean {
      const r = raw.get(s.id);
      return !!r && (r.addedBy === me || teamOf(r.teamId)?.role === "proprietaire");
    },
    canEditPlaylist(p: TeamPlaylist): boolean {
      return p.createdBy === me || teamOf(p.teamId)?.role === "proprietaire";
    },

    /** Télécharge le son dans le dossier de l'équipe (s'il n'y est pas déjà) et renvoie son chemin. */
    async fetchFile(s: Sound): Promise<string> {
      const known = present.get(s.id);
      if (known) return known;
      const r = raw.get(s.id);
      const team = r ? teamOf(r.teamId) : null;
      if (!r || !team) throw new Error("son inconnu");
      const path = await api.teamFile(team.name, r.id, r.fileName, r.url);
      if (path) { present.set(s.id, path); host.located(s.id, path); }
      return path;
    },

    /** Envoie un fichier de l'ordinateur dans les sons de l'équipe ; renvoie l'identifiant du son (eq-…). */
    async upload(teamId: string, path: string, title?: string): Promise<{ id: string; duplicate: boolean }> {
      const r = await api.teamUpload(teamId, path, title);
      // Le fichier envoyé est déjà sur l'ordinateur : pas besoin de le retélécharger pour s'en servir
      return { id: `eq-${r.sound.id}`, duplicate: !!r.duplicate };
    },

    async deleteSound(s: Sound): Promise<void> {
      const r = raw.get(s.id);
      if (!r) return;
      await api.accountApi("DELETE", `equipe/${r.teamId}/sons/${r.id}`);
      await sync();
    },

    async createPlaylist(teamId: string, name: string): Promise<string> {
      const r = await api.accountApi("POST", `equipe/${teamId}/playlists`, { name });
      const c = contents.get(teamId);
      if (c) { c.playlists.push({ ...r.playlist }); rebuild(); host.changed(); }
      void sync();
      return r.playlist.id;
    },

    async renamePlaylist(id: string, name: string): Promise<void> {
      const p = playlistLocal(id);
      if (!p || !name.trim()) return;
      const local = p.content.playlists.find((x) => x.id === id);
      if (local) local.name = name.trim();
      save();
      await api.accountApi("POST", `equipe/${p.teamId}/playlists/${id}`, { name: name.trim() });
    },

    async deletePlaylist(id: string): Promise<void> {
      const p = playlistLocal(id);
      if (!p) return;
      await api.accountApi("DELETE", `equipe/${p.teamId}/playlists/${id}`);
      p.content.playlists = p.content.playlists.filter((x) => x.id !== id);
      save();
      host.changed();
      void sync();
    },

    /** Ajoute ou retire un son (de la banque ou de l'équipe) ; modification visible tout de suite, puis confirmée par le serveur. */
    async toggle(id: string, ref: string, add: boolean): Promise<void> {
      const p = playlistLocal(id);
      if (!p) return;
      const local = p.content.playlists.find((x) => x.id === id)!;
      const before = [...local.ids];
      local.ids = add ? [...local.ids.filter((x) => x !== ref), ref] : local.ids.filter((x) => x !== ref);
      host.changed();
      try {
        if (add) await api.accountApi("POST", `equipe/${p.teamId}/playlists/${id}/sons`, { ref });
        else await api.accountApi("DELETE", `equipe/${p.teamId}/playlists/${id}/sons/${encodeURIComponent(ref)}`);
        save();
      } catch (e) {
        local.ids = before;
        host.changed();
        throw e;
      }
    },
  };
}

export type Teams = ReturnType<typeof createTeams>;

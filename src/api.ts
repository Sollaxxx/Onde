// Pont entre l'interface et le cœur natif (Rust).
// Hors de Tauri (simple navigateur, pour tester l'interface), on lit les sons
// de test servis par Vite et les fonctions natives sont désactivées.
import type { Catalog, Sound, UpdateInfo } from "./types";
import { getLang } from "./i18n";

export const inTauri = "__TAURI_INTERNALS__" in window;
/** Onde tourne sur un Mac (feux tricolores d'Apple, raccourcis avec ⌘). */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Touche de raccourci affichée : ⌘ sur Mac, CTRL ailleurs. */
export const MOD = isMac ? "⌘" : "CTRL";
/** Adresse publique de la bibliothèque (bucket Cloudflare R2). */
export const CDN = "https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function getCatalog(): Promise<Catalog> {
  if (inTauri) return invoke<Catalog>("get_catalog");
  try {
    const res = await fetch(`${CDN}/catalogue/v1.json`);
    if (res.ok) return { origin: "en ligne", cdn: CDN, sounds: (await res.json()).sounds };
  } catch { /* pas de connexion : sons de test */ }
  const res = await fetch("/samples/catalog.json");
  return { origin: "test", cdn: "", sounds: await res.json() };
}

export async function libraryDir(): Promise<string> {
  return inTauri ? invoke<string>("library_dir") : "Documents\\Onde";
}

/** Dossier proposé par défaut (Documents\\Onde), sans rien changer aux réglages. */
export async function defaultLibraryDir(): Promise<string> {
  return inTauri ? invoke<string>("default_library_dir") : "Documents\\Onde";
}

/** Rend le son disponible sur le disque (copie ou téléchargement) et renvoie son chemin. */
export async function ensureLocal(id: string): Promise<string> {
  return inTauri ? invoke<string>("ensure_local", { id }) : "";
}

/** Adresse en ligne d'un son : la pré-écoute démarre sans attendre le téléchargement. */
export function streamUrl(cdn: string, sound: Sound): string {
  return `${cdn}/sons/${encodeURIComponent(sound.file)}`;
}

/** Ouvre une page web dans le navigateur (page d'origine d'un son, crédits). */
export async function openUrl(url: string): Promise<void> {
  if (!inTauri) { window.open(url, "_blank", "noopener"); return; }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** Adresse utilisable par le lecteur audio pour un son déjà sur le disque. */
export async function audioUrl(sound: Sound, localPath: string): Promise<string> {
  if (!inTauri) return `/samples/${sound.file}`;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(localPath);
}

let dragIcon: string | null = null;

/** Lance un vrai glisser-déposer système : le fichier peut être lâché dans n'importe quel logiciel. */
export async function dragOut(paths: string[]): Promise<void> {
  if (!inTauri) throw new Error("navigateur");
  const { startDrag } = await import("@crabnebula/tauri-plugin-drag");
  dragIcon ??= await invoke<string>("drag_icon_path");
  await startDrag({ item: paths, icon: dragIcon });
}

export async function revealInFolder(path: string): Promise<void> {
  if (!inTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function openFolder(path: string): Promise<void> {
  if (!inTauri) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

/** Fenêtre de choix de dossier de Windows. */
export async function chooseFolder(current: string): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, defaultPath: current || undefined, title: "Choisir le dossier des sons Onde" });
  return typeof picked === "string" ? picked : null;
}

/** Change le dossier des sons (null = dossier par défaut) et renvoie le dossier retenu. */
export async function setLibraryDir(path: string | null): Promise<string> {
  return inTauri ? invoke<string>("set_library_dir", { path }) : path ?? "Documents\\Onde";
}

// ---------- Sons personnels ----------
export interface UserSound {
  path: string; root: string; dirs: string[]; bytes: number; modified: number;
  durationMs: number | null; peaks: number[] | null; format: string | null;
}
export async function getUserDirs(): Promise<string[]> { return inTauri ? invoke<string[]>("get_user_dirs") : []; }
export async function addUserDir(path: string): Promise<string[]> { return invoke<string[]>("add_user_dir", { path }); }
export async function removeUserDir(path: string): Promise<string[]> { return invoke<string[]>("remove_user_dir", { path }); }
export async function scanUserSounds(): Promise<UserSound[]> { return inTauri ? invoke<UserSound[]>("scan_user_sounds") : []; }
export async function analyzeUserSounds(sounds: UserSound[]): Promise<UserSound[]> { return invoke<UserSound[]>("analyze_user_sounds", { sounds }); }

/** Identifiants des sons déjà présents sur l'ordinateur (utilisables hors ligne). */
export async function localSounds(): Promise<string[]> {
  return inTauri ? invoke<string[]>("local_sounds") : [];
}

/** Le son a été glissé dans un logiciel : il ne sera jamais effacé par le nettoyage automatique. */
export async function markDragged(path: string): Promise<void> {
  if (inTauri) await invoke("mark_dragged", { path });
}

export interface CleanupInfo { days: number; pendingCount: number; pendingBytes: number; keptCount: number }

/** Réglage du nettoyage automatique (jours sans écoute avant d'effacer ; 0 = jamais). */
export async function cleanupInfo(): Promise<CleanupInfo | null> {
  return inTauri ? invoke<CleanupInfo>("cleanup_info") : null;
}

export async function setCleanupDays(days: number): Promise<void> {
  if (inTauri) await invoke("set_cleanup_days", { days });
}

/** Affiche la fenêtre (elle démarre cachée pour éviter un flash blanc). */
export async function showWindow(): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.show();
  // Au premier plan, sinon sur Mac l'application démarre derrière les autres fenêtres
  await win.setFocus().catch(() => {});
}

export interface PanelStatus { installed: string | null; bundled: string | null }

/** Panneau Premiere : version installée et version fournie avec Onde. */
export async function premiereStatus(): Promise<PanelStatus> {
  return inTauri ? invoke<PanelStatus>("premiere_status") : { installed: null, bundled: "0.1.0" };
}

/** Installe (ou met à jour) le panneau Onde dans Premiere Pro et renvoie sa version. */
export async function installPremierePanel(): Promise<string> {
  if (inTauri) return invoke<string>("install_premiere_panel");
  throw new Error("l'installation se fait depuis l'application Onde");
}

/** Panneau DaVinci Resolve : versions, et présence de Resolve sur l'ordinateur. */
export interface ResolveStatus extends PanelStatus { resolve: boolean }

export async function resolveStatus(): Promise<ResolveStatus> {
  return inTauri ? invoke<ResolveStatus>("resolve_status") : { installed: null, bundled: "0.1.0", resolve: true };
}

/** Installe (ou met à jour) le panneau Onde dans DaVinci Resolve Studio et renvoie sa version. */
export async function installResolvePanel(): Promise<string> {
  if (inTauri) return invoke<string>("install_resolve_panel");
  throw new Error("l'installation se fait depuis l'application Onde");
}

// ---------- Compte et équipe (Onde Équipe) ----------
// Dans l'application, les appels passent par Rust, qui garde le jeton de session (l'interface ne le voit pas).
// Dans un navigateur (test de l'interface), ils vont au serveur de test local : node site/serveur-local.mjs
const DEV_API = "http://localhost:8787";
const DEV_TOKEN = "onde.dev.session";

export interface AccountError extends Error { code?: string; status?: number }

export async function accountApi(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<any> {
  const lang = getLang();
  let v: any;
  if (inTauri) {
    v = await invoke("account_api", { method, path, body: body ?? null, lang });
  } else {
    const token = localStorage.getItem(DEV_TOKEN);
    try {
      const r = await fetch(`${DEV_API}/api/${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Onde-Langue": lang, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      v = { ...(await r.json().catch(() => ({ ok: false, error: "Réponse illisible du serveur Onde." }))), status: r.status };
    } catch {
      v = { ok: false, error: "Pas de connexion au serveur Onde.", status: 0 };
    }
    if (v.ok && path === "compte/connexion" && v.token) { localStorage.setItem(DEV_TOKEN, v.token); delete v.token; }
    if ((v.ok && (path === "compte/deconnexion" || path === "compte/supprimer")) || (v.status === 401 && path !== "compte/connexion")) localStorage.removeItem(DEV_TOKEN);
  }
  if (!v?.ok) throw Object.assign(new Error(v?.error || "Erreur du serveur Onde."), { code: v?.code, status: v?.status }) as AccountError;
  return v;
}

/** Les comptes (Onde Équipe) sont-ils ouverts côté serveur ? Dans un navigateur de test : toujours. */
export async function accountsOpen(): Promise<boolean> {
  if (inTauri) return invoke<boolean>("accounts_open").catch(() => false);
  return true;
}

/** Une session est-elle enregistrée sur cet ordinateur ? */
export async function accountSignedIn(): Promise<boolean> {
  if (inTauri) return invoke<boolean>("account_signed_in");
  return !!localStorage.getItem(DEV_TOKEN);
}

// ---------- Contributions de la communauté ----------

/** Les contributions sont-elles ouvertes ? (interrupteur côté serveur) */
export async function contributionsOpen(): Promise<boolean> {
  if (inTauri) return invoke<boolean>("contributions_open").catch(() => false);
  return new URLSearchParams(location.search).has("contributions"); // pour tester l'interface dans un navigateur
}

// Hors de l'application (test de l'interface dans un navigateur) : fichiers choisis via le navigateur.
const browserFiles = new Map<string, File>();

/** Fenêtre de choix de fichiers audio. */
export async function chooseAudioFiles(): Promise<string[]> {
  if (!inTauri) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file"; input.multiple = true; input.accept = "audio/*";
      input.onchange = () => resolve([...(input.files ?? [])].map((f) => { browserFiles.set(f.name, f); return f.name; }));
      input.click();
    });
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: true, title: "Choisir des sons à proposer", filters: [{ name: "Audio", extensions: ["wav", "flac", "mp3", "aif", "aiff", "ogg", "m4a"] }] });
  return Array.isArray(picked) ? picked : picked ? [picked] : [];
}

/** Contenu d'un fichier audio local (pour la pré-écoute et l'analyse). */
export async function readAudio(path: string): Promise<ArrayBuffer> {
  if (!inTauri) { const f = browserFiles.get(path); if (!f) throw new Error("fichier introuvable"); return f.arrayBuffer(); }
  return invoke<ArrayBuffer>("read_audio", { path });
}

export interface ContributionMeta {
  title: string;
  category: string;
  code: string;
  tags: string[];
  description: string;
  pseudo: string;
  email: string;
  license: "CC0";
  durationMs: number;
}

/** Envoie un son proposé ; renvoie son identifiant de contribution. */
export async function sendContribution(path: string, meta: ContributionMeta): Promise<string> {
  if (!inTauri) throw new Error("L'envoi fonctionne dans l'application Onde.");
  return invoke<string>("send_contribution", { path, meta: encodeURIComponent(JSON.stringify(meta)) });
}

export type FeedbackKind = "bug" | "idee" | "autre";

/** Envoie un retour à l'équipe Onde (avec la version et le système). */
export async function sendFeedback(kind: FeedbackKind, message: string, email: string): Promise<void> {
  if (inTauri) return invoke<void>("send_feedback", { kind, message, email });
  throw new Error("L'envoi fonctionne dans l'application Onde.");
}

export async function appVersion(): Promise<string> {
  if (!inTauri) return "0.1.0";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function windowAction(action: "minimize" | "maximize" | "close"): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (action === "minimize") await w.minimize();
  else if (action === "maximize") await w.toggleMaximize();
  else await w.close();
}

/** Mode compact : petite fenêtre toujours au premier plan, pour le deuxième écran. */
export async function setCompactWindow(on: boolean): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await w.setAlwaysOnTop(on);
  await w.setSize(on ? new LogicalSize(420, 780) : new LogicalSize(1360, 860));
}

/** Vérifie s'il existe une version plus récente, signée par l'équipe Onde. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!inTauri || import.meta.env.DEV) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? "",
      install: async () => {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch {
    // Pas de connexion, ou mises à jour pas encore configurées : on ne dérange pas l'utilisateur.
    return null;
  }
}

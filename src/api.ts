// Pont entre l'interface et le cœur natif (Rust).
// Hors de Tauri (simple navigateur, pour tester l'interface), on lit les sons
// de test servis par Vite et les fonctions natives sont désactivées.
import type { Catalog, Sound, UpdateInfo } from "./types";

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

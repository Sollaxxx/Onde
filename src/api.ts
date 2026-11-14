// Pont entre l'interface et le cœur natif (Rust).
// Hors de Tauri (simple navigateur, pour tester l'interface), on lit les sons
// de test servis par Vite et les fonctions natives sont désactivées.
import type { Catalog, Sound, UpdateInfo } from "./types";

export const inTauri = "__TAURI_INTERNALS__" in window;
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

/** Affiche la fenêtre (elle démarre cachée pour éviter un flash blanc). */
export async function showWindow(): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().show();
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

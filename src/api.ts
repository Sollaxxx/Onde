// Pont entre l'interface et le cœur natif (Rust).
// Hors de Tauri (simple navigateur, pour tester l'interface), on lit les sons
// de test servis par Vite et les fonctions natives sont désactivées.
import type { Sound, UpdateInfo } from "./types";

export const inTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function getCatalog(): Promise<Sound[]> {
  if (inTauri) return invoke<Sound[]>("get_catalog");
  const res = await fetch("/samples/catalog.json");
  return res.json();
}

export async function libraryDir(): Promise<string> {
  return inTauri ? invoke<string>("library_dir") : "Documents\\Onde";
}

/** Rend le son disponible sur le disque (copie ou téléchargement) et renvoie son chemin. */
export async function ensureLocal(id: string): Promise<string> {
  return inTauri ? invoke<string>("ensure_local", { id }) : "";
}

/** Adresse utilisable par le lecteur audio. */
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

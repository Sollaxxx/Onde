//! Cœur natif d'Onde : catalogue, bibliothèque locale et chemins de fichiers.
//!
//! Règle importante : un logiciel de montage retrouve un son par son chemin.
//! Chaque son utilisé est donc copié dans un dossier stable
//! (Documents/Onde/<CODE UCS>/...) et n'est jamais supprimé par l'application.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

const SAMPLES: &str = "resources/samples";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Sound {
    id: String,
    title: String,
    code: String,
    category: String,
    tags: Vec<String>,
    duration_ms: u64,
    file: String,
    format: String,
    license: String,
    peaks: Vec<f32>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn resource(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    app.path().resolve(rel, BaseDirectory::Resource).map_err(err)
}

fn read_catalog(app: &AppHandle) -> Result<Vec<Sound>, String> {
    let path = resource(app, &format!("{SAMPLES}/catalog.json"))?;
    let text = fs::read_to_string(&path).map_err(|e| format!("Catalogue introuvable ({}) : {e}", path.display()))?;
    serde_json::from_str(&text).map_err(err)
}

/// Réglages enregistrés sur le PC (dossier de configuration de l'app).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    library_dir: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(path, serde_json::to_string_pretty(s).map_err(err)?).map_err(err)
}

/// Dossier par défaut : Documents/Onde.
fn default_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(err)?.join("Onde"))
}

/// Dossier stable où vivent les sons utilisés (choisi dans les Réglages, sinon Documents/Onde).
fn library_root(app: &AppHandle) -> Result<PathBuf, String> {
    match load_settings(app).library_dir {
        Some(dir) if !dir.trim().is_empty() => Ok(PathBuf::from(dir)),
        _ => default_root(app),
    }
}

/// Autorise le lecteur audio de l'interface à lire les fichiers de ce dossier.
fn allow_playback(app: &AppHandle, dir: &Path) {
    if let Err(e) = app.asset_protocol_scope().allow_directory(dir, true) {
        eprintln!("Lecture non autorisée dans {} : {e}", dir.display());
    }
}

/// Change le dossier des sons. `None` ou vide = retour au dossier par défaut.
/// Les sons déjà copiés restent où ils sont : les projets de montage les retrouvent toujours.
#[tauri::command]
fn set_library_dir(app: AppHandle, path: Option<String>) -> Result<String, String> {
    let default = default_root(&app)?;
    let dir = match path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => default.clone(),
    };
    if dir.parent().is_none() {
        return Err("choisissez un dossier, pas la racine d'un disque".into());
    }
    fs::create_dir_all(&dir).map_err(|e| format!("dossier inaccessible : {e}"))?;
    let mut settings = load_settings(&app);
    settings.library_dir = if dir == default { None } else { Some(dir.to_string_lossy().into_owned()) };
    save_settings(&app, &settings)?;
    allow_playback(&app, &dir);
    Ok(dir.to_string_lossy().into_owned())
}

/// Nom de fichier lisible hors de l'app : WHSH_Whoosh-rapide-metallique_whsh-rapide.wav
fn file_name(sound: &Sound) -> String {
    let slug: String = sound
        .title
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'œ' => 'o',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let ext = sound.file.rsplit('.').next().unwrap_or("wav");
    format!("{}_{}_{}.{}", sound.code, slug, sound.id, ext)
}

#[tauri::command]
fn get_catalog(app: AppHandle) -> Result<Vec<Sound>, String> {
    read_catalog(&app)
}

#[tauri::command]
fn library_dir(app: AppHandle) -> Result<String, String> {
    Ok(library_root(&app)?.to_string_lossy().into_owned())
}

/// Rend le son disponible sur le disque et renvoie son chemin.
/// Aujourd'hui : copie depuis les sons de test fournis avec l'app.
/// Plus tard : téléchargement depuis le serveur (Cloudflare R2).
#[tauri::command]
fn ensure_local(app: AppHandle, id: String) -> Result<String, String> {
    let catalog = read_catalog(&app)?;
    let sound = catalog
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Son inconnu : {id}"))?;
    let dir = library_root(&app)?.join(&sound.code);
    let dest = dir.join(file_name(sound));
    if !dest.exists() {
        fs::create_dir_all(&dir).map_err(err)?;
        let src = resource(&app, &format!("{SAMPLES}/{}", sound.file))?;
        fs::copy(&src, &dest).map_err(|e| format!("Copie impossible ({}) : {e}", src.display()))?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

/// Image affichée sous le curseur pendant le glisser-déposer.
#[tauri::command]
fn drag_icon_path(app: AppHandle) -> Result<String, String> {
    Ok(resource(&app, "resources/drag-icon.png")?.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Le dossier choisi dans les Réglages doit rester lisible par le lecteur audio.
            if let Ok(dir) = library_root(app.handle()) {
                allow_playback(app.handle(), &dir);
            }
            // Le module de mise à jour ne doit jamais empêcher l'app de démarrer,
            // par exemple tant que la clé publique n'est pas encore configurée.
            #[cfg(desktop)]
            if let Err(e) = app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                eprintln!("Mises à jour désactivées : {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_catalog, library_dir, set_library_dir, ensure_local, drag_icon_path])
        .run(tauri::generate_context!())
        .expect("Onde n'a pas pu démarrer");
}

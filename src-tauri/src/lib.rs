//! Cœur natif d'Onde : catalogue, bibliothèque locale et chemins de fichiers.
//!
//! Règle importante : un logiciel de montage retrouve un son par son chemin.
//! Chaque son utilisé est donc copié dans un dossier stable
//! (Documents/Onde/<CODE UCS>/...) et n'est jamais supprimé par l'application.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
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

/// Dossier stable où vivent les sons utilisés : Documents/Onde.
fn library_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(err)?.join("Onde"))
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
        .setup(|app| {
            // Le module de mise à jour ne doit jamais empêcher l'app de démarrer,
            // par exemple tant que la clé publique n'est pas encore configurée.
            #[cfg(desktop)]
            if let Err(e) = app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                eprintln!("Mises à jour désactivées : {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_catalog, library_dir, ensure_local, drag_icon_path])
        .run(tauri::generate_context!())
        .expect("Onde n'a pas pu démarrer");
}

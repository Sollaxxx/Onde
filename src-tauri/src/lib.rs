//! Cœur natif d'Onde : catalogue, bibliothèque locale et chemins de fichiers.
//!
//! Règle importante : un logiciel de montage retrouve un son par son chemin.
//! Chaque son utilisé est donc copié dans un dossier stable
//! (Documents/Onde/<CODE UCS>/...) et n'est jamais supprimé par l'application.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};

const SAMPLES: &str = "resources/samples";
/// Adresse publique de la bibliothèque (bucket Cloudflare R2 « onde-sons »).
const CDN: &str = "https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev";
const CATALOGUE: &str = "catalogue/v1.json";

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Sound {
    id: String,
    title: String,
    title_en: String,
    description: String,
    description_en: String,
    code: String,
    ucs: String,
    category: String,
    tags: Vec<String>,
    duration_ms: u64,
    file: String,
    format: String,
    license: String,
    author: String,
    credit: String,
    source: String,
    source_url: String,
    peaks: Vec<f32>,
    bytes: u64,
}

#[derive(Deserialize)]
struct RemoteCatalog {
    sounds: Vec<Sound>,
}

/// Catalogue envoyé à l'interface. `origin` : « en ligne », « cache » (hors ligne) ou « test ».
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    origin: String,
    cdn: String,
    sounds: Vec<Sound>,
}

/// Le catalogue chargé, gardé en mémoire pour retrouver un son par son identifiant.
struct Store(Mutex<Option<Catalog>>);

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Onde/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(err)
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

/// Indique au panneau Premiere où se trouve la bibliothèque, pour que les deux partagent les mêmes fichiers.
/// Fichier texte d'une ligne : <dossier de configuration d'Onde>/bibliotheque.txt
fn write_library_hint(app: &AppHandle, dir: &Path) {
    if let Ok(cfg) = app.path().app_config_dir() {
        let _ = fs::create_dir_all(&cfg);
        let _ = fs::write(cfg.join("bibliotheque.txt"), dir.to_string_lossy().as_bytes());
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
    write_library_hint(&app, &dir);
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

async fn fetch_remote_catalog() -> Result<String, String> {
    let res = http()?
        .get(format!("{CDN}/{CATALOGUE}"))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?;
    res.text().await.map_err(err)
}

fn parse_remote(text: &str, origin: &str) -> Result<Catalog, String> {
    let remote: RemoteCatalog = serde_json::from_str(text).map_err(err)?;
    Ok(Catalog { origin: origin.into(), cdn: CDN.into(), sounds: remote.sounds })
}

/// Charge la bibliothèque en ligne ; sans connexion, la dernière copie enregistrée ;
/// en dernier recours, les sons de test fournis avec l'application.
#[tauri::command]
async fn get_catalog(app: AppHandle, store: State<'_, Store>) -> Result<Catalog, String> {
    let cache = app.path().app_cache_dir().map_err(err)?.join("catalogue-v1.json");
    let catalog = match fetch_remote_catalog().await.and_then(|t| parse_remote(&t, "en ligne").map(|c| (c, t))) {
        Ok((catalog, text)) => {
            if let Some(dir) = cache.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let _ = fs::write(&cache, text);
            catalog
        }
        Err(e) => {
            eprintln!("Bibliothèque en ligne indisponible : {e}");
            match fs::read_to_string(&cache).map_err(err).and_then(|t| parse_remote(&t, "cache")) {
                Ok(catalog) => catalog,
                Err(_) => Catalog { origin: "test".into(), cdn: String::new(), sounds: read_catalog(&app)? },
            }
        }
    };
    *store.0.lock().map_err(err)? = Some(catalog.clone());
    Ok(catalog)
}

#[tauri::command]
fn library_dir(app: AppHandle) -> Result<String, String> {
    Ok(library_root(&app)?.to_string_lossy().into_owned())
}

/// Site d'Onde : retours des testeurs, contributions de sons.
const SITE: &str = "https://onde-nis.pages.dev";
/// Adresse qui reçoit les retours des testeurs (fonction du site Onde).
const FEEDBACK: &str = "https://onde-nis.pages.dev/api/retour";
/// Taille maximale d'un son proposé par la communauté.
const CONTRIB_MAX_BYTES: u64 = 60 * 1024 * 1024;

/// Envoie un retour (bug, idée…) avec la version d'Onde et le système.
#[tauri::command]
async fn send_feedback(app: AppHandle, kind: String, message: String, email: String) -> Result<(), String> {
    let body = serde_json::json!({
        "kind": kind,
        "message": message,
        "email": email,
        "version": app.package_info().version.to_string(),
        "os": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
    });
    let res = http()?
        .post(FEEDBACK)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Pas de connexion au serveur Onde.".to_string())?;
    if res.status().is_success() {
        return Ok(());
    }
    let text = res.text().await.unwrap_or_default();
    let msg = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v["error"].as_str().map(str::to_owned))
        .unwrap_or_else(|| "Le message n'a pas pu partir.".into());
    Err(msg)
}

// ---------- Panneau Premiere Pro (CEP) ----------

/// Identifiant du panneau, et nom de son dossier dans les extensions d'Adobe.
const PREMIERE_PANEL: &str = "app.onde.premiere";

/// Dossier des extensions CEP de l'utilisateur (Premiere 2019 et plus).
fn cep_extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Windows : %APPDATA%\Adobe\CEP\extensions ; macOS : ~/Library/Application Support/Adobe/CEP/extensions
    Ok(app.path().data_dir().map_err(err)?.join("Adobe").join("CEP").join("extensions"))
}

/// Version d'un panneau, lue dans son manifeste (ExtensionBundleVersion="x.y.z").
fn panel_version(dir: &Path) -> Option<String> {
    let xml = fs::read_to_string(dir.join("CSXS").join("manifest.xml")).ok()?;
    let start = xml.find("ExtensionBundleVersion=\"")? + "ExtensionBundleVersion=\"".len();
    let len = xml[start..].find('"')?;
    Some(xml[start..start + len].to_string())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Autorise Premiere à charger les panneaux non signés, pour l'utilisateur courant seulement.
/// (Adobe documente des signatures refusées à tort depuis fin 2024 : c'est leur contournement officiel.)
fn allow_unsigned_panels() {
    for v in 9..=13 {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("reg")
                .args(["add", &format!("HKCU\\Software\\Adobe\\CSXS.{v}"), "/v", "PlayerDebugMode", "/t", "REG_SZ", "/d", "1", "/f"])
                .creation_flags(0x0800_0000) // pas de fenêtre de console
                .status();
        }
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("defaults")
                .args(["write", &format!("com.adobe.CSXS.{v}"), "PlayerDebugMode", "1"])
                .status();
        }
        let _ = v;
    }
}

#[derive(Serialize)]
struct PanelStatus {
    installed: Option<String>, // version installée
    bundled: Option<String>,   // version fournie avec cette version d'Onde
}

#[tauri::command]
fn premiere_status(app: AppHandle) -> Result<PanelStatus, String> {
    let installed = panel_version(&cep_extensions_dir(&app)?.join(PREMIERE_PANEL));
    let bundled = panel_version(&resource(&app, "premiere-cep")?);
    Ok(PanelStatus { installed, bundled })
}

/// Installe (ou met à jour) le panneau Onde dans Premiere Pro.
#[tauri::command]
fn install_premiere_panel(app: AppHandle) -> Result<String, String> {
    let src = resource(&app, "premiere-cep")?;
    if !src.join("CSXS").join("manifest.xml").exists() {
        return Err("le panneau n'est pas inclus dans cette version d'Onde".into());
    }
    let dest = cep_extensions_dir(&app)?.join(PREMIERE_PANEL);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("ancien panneau impossible à remplacer ({e}). Fermez Premiere Pro et réessayez."))?;
    }
    copy_dir(&src, &dest).map_err(|e| format!("copie impossible : {e}"))?;
    allow_unsigned_panels();
    Ok(panel_version(&dest).unwrap_or_default())
}

// ---------- Contributions de la communauté ----------

/// Les contributions sont-elles ouvertes ? (interrupteur côté serveur ; fermé en cas de doute)
#[tauri::command]
async fn contributions_open() -> bool {
    let Ok(client) = http() else { return false };
    let Ok(res) = client.get(format!("{SITE}/api/config")).timeout(Duration::from_secs(6)).send().await else { return false };
    let Ok(text) = res.text().await else { return false };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v["contributions"].as_bool())
        .unwrap_or(false)
}

/// Lit un fichier audio choisi par l'utilisateur (pré-écoute et analyse dans l'interface).
#[tauri::command]
fn read_audio(path: String) -> Result<tauri::ipc::Response, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("fichier illisible : {e}"))?;
    if meta.len() > CONTRIB_MAX_BYTES {
        return Err("fichier trop lourd (60 Mo au maximum)".into());
    }
    Ok(tauri::ipc::Response::new(fs::read(&path).map_err(err)?))
}

/// Envoie un son proposé. `meta` est du JSON déjà encodé pour une en-tête HTTP (encodeURIComponent).
#[tauri::command]
async fn send_contribution(app: AppHandle, path: String, meta: String) -> Result<String, String> {
    let size = fs::metadata(&path).map_err(|e| format!("fichier illisible : {e}"))?.len();
    if size > CONTRIB_MAX_BYTES {
        return Err("fichier trop lourd (60 Mo au maximum)".into());
    }
    let bytes = fs::read(&path).map_err(err)?;
    let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let res = http()?
        .post(format!("{SITE}/api/contributions"))
        .header("Content-Type", "application/octet-stream")
        .header("X-Onde-Meta", meta)
        .header("X-Onde-Fichier", urlencode(&name))
        .header("X-Onde-Version", app.package_info().version.to_string())
        .body(bytes)
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|_| "Pas de connexion au serveur Onde.".to_string())?;
    let ok = res.status().is_success();
    let text = res.text().await.unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    if ok {
        Ok(v["id"].as_str().unwrap_or_default().to_string())
    } else {
        Err(v["error"].as_str().unwrap_or("Le son n'a pas pu être envoyé.").to_string())
    }
}

/// Encodage minimal pour une en-tête HTTP (lettres, chiffres et quelques signes gardés tels quels).
fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Dossier proposé par défaut (Documents/Onde), affiché à l'écran d'accueil.
#[tauri::command]
fn default_library_dir(app: AppHandle) -> Result<String, String> {
    Ok(default_root(&app)?.to_string_lossy().into_owned())
}

/// Rend le son disponible sur le disque et renvoie son chemin :
/// téléchargement depuis la bibliothèque en ligne, ou copie d'un son de test.
/// Un son déjà présent n'est jamais retéléchargé ni modifié.
#[tauri::command]
async fn ensure_local(app: AppHandle, store: State<'_, Store>, id: String) -> Result<String, String> {
    let (sound, test) = {
        let guard = store.0.lock().map_err(err)?;
        let catalog = guard.as_ref().ok_or("La bibliothèque n'est pas encore chargée")?;
        let sound = catalog.sounds.iter().find(|s| s.id == id).cloned().ok_or_else(|| format!("Son inconnu : {id}"))?;
        (sound, catalog.origin == "test")
    };
    let dir = library_root(&app)?.join(&sound.code);
    let dest = dir.join(if test { file_name(&sound) } else { sound.file.clone() });
    if dest.exists() {
        return Ok(dest.to_string_lossy().into_owned());
    }
    fs::create_dir_all(&dir).map_err(err)?;
    if test {
        let src = resource(&app, &format!("{SAMPLES}/{}", sound.file))?;
        fs::copy(&src, &dest).map_err(|e| format!("Copie impossible ({}) : {e}", src.display()))?;
    } else {
        let url = format!("{CDN}/sons/{}", sound.file.replace(' ', "%20"));
        let bytes = http()?
            .get(&url)
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| format!("Téléchargement impossible : {e}"))?
            .error_for_status()
            .map_err(|e| format!("Téléchargement impossible : {e}"))?
            .bytes()
            .await
            .map_err(err)?;
        // Écriture dans un fichier temporaire puis renommage : jamais de son à moitié écrit.
        let part = dest.with_extension("part");
        fs::write(&part, &bytes).map_err(err)?;
        fs::rename(&part, &dest).map_err(err)?;
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
        .manage(Store(Mutex::new(None)))
        .setup(|app| {
            // Le dossier choisi dans les Réglages doit rester lisible par le lecteur audio.
            if let Ok(dir) = library_root(app.handle()) {
                allow_playback(app.handle(), &dir);
                write_library_hint(app.handle(), &dir);
            }
            // Le module de mise à jour ne doit jamais empêcher l'app de démarrer,
            // par exemple tant que la clé publique n'est pas encore configurée.
            #[cfg(desktop)]
            if let Err(e) = app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                eprintln!("Mises à jour désactivées : {e}");
            }
            // La fenêtre démarre cachée : l'interface l'affiche une fois prête (pas de flash blanc).
            // Filet de sécurité : si l'interface ne l'a pas fait au bout de 4 secondes, on l'affiche.
            if let Some(win) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(4));
                    let _ = win.show();
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_catalog, library_dir, default_library_dir, set_library_dir, ensure_local, drag_icon_path, send_feedback, premiere_status, install_premiere_panel, contributions_open, read_audio, send_contribution])
        .run(tauri::generate_context!())
        .expect("Onde n'a pas pu démarrer");
}

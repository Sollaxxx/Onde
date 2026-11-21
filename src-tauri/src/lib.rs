//! Cœur natif d'Onde : catalogue, bibliothèque locale et chemins de fichiers.
//!
//! Règle importante : un logiciel de montage retrouve un son par son chemin.
//! Chaque son utilisé est donc copié dans un dossier stable
//! (Documents/Onde/<CODE UCS>/...) et n'est jamais supprimé par l'application.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
mod compte;
mod perso;

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
    /// Nettoyage automatique : nombre de jours sans écoute avant d'effacer un son jamais glissé.
    /// Absent = 30 jours ; 0 = jamais.
    cleanup_days: Option<u32>,
    /// Dossiers de sons personnels ajoutés à la bibliothèque
    user_dirs: Option<Vec<String>>,
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
/// L'ancienne adresse sert de secours si le nouveau domaine ne répond pas.
const SITES: [&str; 2] = ["https://ondesound.com", "https://onde-nis.pages.dev"];

/// Envoie une requête au site d'Onde, en essayant l'adresse de secours si la première est injoignable.
/// (Seule une absence de réponse fait passer à la suivante : une erreur renvoyée par le serveur est gardée.)
async fn site_request<F>(build: F) -> Result<reqwest::Response, String>
where
    F: Fn(&str) -> reqwest::RequestBuilder,
{
    let mut last = String::new();
    for site in SITES {
        match build(site).send().await {
            Ok(res) => return Ok(res),
            Err(e) => last = e.to_string(),
        }
    }
    eprintln!("Site Onde injoignable : {last}");
    Err("Pas de connexion au serveur Onde.".into())
}
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
    let client = http()?;
    let body = body.to_string();
    let res = site_request(|site| {
        client
            .post(format!("{site}/api/retour"))
            .header("Content-Type", "application/json")
            .body(body.clone())
            .timeout(Duration::from_secs(20))
    })
    .await?;
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

// ---------- Panneau DaVinci Resolve Studio (Workflow Integration) ----------

/// Identifiant du panneau (manifest.xml), et nom de son dossier dans les plugins de Resolve.
const RESOLVE_PANEL: &str = "com.ondesound.resolve";
/// Module de Blackmagic qui relie le panneau à Resolve : il n'est pas dans Onde, on le copie depuis Resolve.
const WORKFLOW_MODULE: &str = "WorkflowIntegration.node";

/// Dossier de Blackmagic où Resolve range ses fichiers communs (plugins, exemples pour développeurs).
fn resolve_support_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("PROGRAMDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\ProgramData"));
        return Some(base.join("Blackmagic Design").join("DaVinci Resolve").join("Support"));
    }
    #[cfg(target_os = "macos")]
    {
        return Some(PathBuf::from("/Library/Application Support/Blackmagic Design/DaVinci Resolve"));
    }
    #[allow(unreachable_code)]
    None
}

/// Racine des panneaux (« Workflow Integration Plugins »), d'après la documentation de Blackmagic.
fn resolve_plugins_dir() -> Option<PathBuf> {
    resolve_support_dir().map(|d| d.join("Workflow Integration Plugins"))
}

/// Cherche WorkflowIntegration.node dans les exemples pour développeurs installés avec Resolve
/// (Developer/Workflow Integrations/Examples/SamplePlugin), en priorité le plus récent (SamplePlugin).
fn find_workflow_module() -> Option<PathBuf> {
    let examples = resolve_support_dir()?.join("Developer").join("Workflow Integrations").join("Examples");
    let preferred = examples.join("SamplePlugin").join(WORKFLOW_MODULE);
    if preferred.is_file() {
        return Some(preferred);
    }
    fs::read_dir(&examples).ok()?.flatten().map(|e| e.path().join(WORKFLOW_MODULE)).find(|p| p.is_file())
}

/// Version d'un panneau Resolve, lue dans son manifest.xml (<Version>x.y.z</Version>).
fn resolve_panel_version(dir: &Path) -> Option<String> {
    let xml = fs::read_to_string(dir.join("manifest.xml")).ok()?;
    let start = xml.find("<Version>")? + "<Version>".len();
    let len = xml[start..].find("</Version>")?;
    Some(xml[start..start + len].trim().to_string())
}

#[derive(Serialize)]
struct ResolveStatus {
    installed: Option<String>, // version installée
    bundled: Option<String>,   // version fournie avec cette version d'Onde
    resolve: bool,             // DaVinci Resolve (avec son module de panneaux) est sur l'ordinateur
}

#[tauri::command]
fn resolve_status(app: AppHandle) -> Result<ResolveStatus, String> {
    let installed = resolve_plugins_dir().and_then(|d| resolve_panel_version(&d.join(RESOLVE_PANEL)));
    let bundled = resolve_panel_version(&resource(&app, "resolve-plugin")?);
    Ok(ResolveStatus { installed, bundled, resolve: find_workflow_module().is_some() })
}

/// Copie `from` dans `to` (remplacé s'il existe), avec les droits d'administrateur si le dossier de Resolve
/// est protégé (toujours le cas sur Mac). Le système demande alors le mot de passe une fois.
fn copy_as_admin(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let q = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', "'\\''"));
        let parent = to.parent().ok_or("dossier invalide")?;
        let shell = format!("mkdir -p {} && rm -rf {} && cp -R {} {}", q(parent), q(to), q(from), q(to));
        let script = format!("do shell script \"{}\" with administrator privileges", shell.replace('\\', "\\\\").replace('"', "\\\""));
        let out = std::process::Command::new("osascript").args(["-e", &script]).output().map_err(err)?;
        if !out.status.success() {
            return Err("installation annulée".into());
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // robocopy /MIR : copie le dossier et retire les anciens fichiers ; lancé avec « Exécuter en tant qu'administrateur »
        let ps = |p: &Path| p.display().to_string().replace('\'', "''");
        let cmd = format!(
            "Start-Process -FilePath robocopy -ArgumentList @('\"{}\"','\"{}\"','/MIR','/NJH','/NJS','/NP') -Verb RunAs -Wait -WindowStyle Hidden",
            ps(from), ps(to)
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
            .creation_flags(0x0800_0000) // pas de fenêtre de console
            .status()
            .map_err(err)?;
        if !status.success() || !to.join("manifest.xml").is_file() {
            return Err("installation annulée".into());
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let _ = (from, to);
        Err("installation annulée".into())
    }
}

/// Installe (ou met à jour) le panneau Onde dans DaVinci Resolve Studio.
#[tauri::command]
fn install_resolve_panel(app: AppHandle) -> Result<String, String> {
    let src = resource(&app, "resolve-plugin")?;
    if !src.join("manifest.xml").is_file() {
        return Err("le panneau n'est pas inclus dans cette version d'Onde".into());
    }
    let module = find_workflow_module()
        .ok_or("DaVinci Resolve n'est pas installé sur cet ordinateur (ou sa version ne gère pas les panneaux).")?;
    let root = resolve_plugins_dir().ok_or("le panneau n'est pas inclus dans cette version d'Onde")?;
    let dest = root.join(RESOLVE_PANEL);

    // Le panneau complet est préparé dans un dossier temporaire : panneau d'Onde + module de Resolve
    let stage = std::env::temp_dir().join(format!("onde-resolve-{}", now_secs()));
    copy_dir(&src, &stage).map_err(|e| format!("copie impossible : {e}"))?;
    fs::copy(&module, stage.join(WORKFLOW_MODULE)).map_err(|e| format!("copie impossible : {e}"))?;

    // D'abord sans droits particuliers (souvent possible sur Windows), sinon en administrateur
    let direct = (|| -> std::io::Result<()> {
        fs::create_dir_all(&root)?;
        if dest.exists() {
            fs::remove_dir_all(&dest)?;
        }
        copy_dir(&stage, &dest)
    })();
    let result = match direct {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => copy_as_admin(&stage, &dest),
        Err(e) => Err(format!("ancien panneau impossible à remplacer ({e}). Fermez DaVinci Resolve et réessayez.")),
    };
    let _ = fs::remove_dir_all(&stage);
    result?;
    // Fenêtre d'administrateur refusée : l'ancien panneau (ou rien) est resté en place
    let installed = resolve_panel_version(&dest);
    if installed.is_none() || installed != resolve_panel_version(&src) {
        return Err("installation annulée".into());
    }
    Ok(installed.unwrap_or_default())
}

// ---------- Contributions de la communauté ----------

/// Les contributions sont-elles ouvertes ? (interrupteur côté serveur ; fermé en cas de doute)
#[tauri::command]
async fn contributions_open() -> bool {
    site_switch("contributions").await
}

/// Un interrupteur de /api/config (fermé en cas de doute : pas de réseau, réponse illisible).
async fn site_switch(key: &str) -> bool {
    let Ok(client) = http() else { return false };
    let Ok(res) = site_request(|site| client.get(format!("{site}/api/config")).timeout(Duration::from_secs(6))).await else { return false };
    let Ok(text) = res.text().await else { return false };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v[key].as_bool())
        .unwrap_or(false)
}

/// Les comptes (Onde Équipe) sont-ils ouverts ? Tant que non, la section Compte reste cachée.
#[tauri::command]
async fn accounts_open() -> bool {
    site_switch("comptes").await
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
    let client = http()?;
    let version = app.package_info().version.to_string();
    let res = site_request(|site| {
        client
            .post(format!("{site}/api/contributions"))
            .header("Content-Type", "application/octet-stream")
            .header("X-Onde-Meta", meta.clone())
            .header("X-Onde-Fichier", urlencode(&name))
            .header("X-Onde-Version", version.clone())
            .body(bytes.clone())
            .timeout(Duration::from_secs(300))
    })
    .await?;
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
        record_use(&app, &dest, false);
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
    record_use(&app, &dest, false);
    Ok(dest.to_string_lossy().into_owned())
}

// ---------- Nettoyage automatique ----------
// Chaque son écouté est téléchargé dans la bibliothèque. Pour ne pas remplir le disque,
// les sons seulement écoutés sont effacés après N jours sans écoute.
// Un son glissé dans un logiciel de montage n'est JAMAIS effacé : un projet s'en sert peut-être.
// Les fichiers inconnus du registre (ajoutés à la main, par le panneau Premiere…) ne sont jamais touchés.

const DEFAULT_CLEANUP_DAYS: u32 = 30;

#[derive(Serialize, Deserialize, Clone)]
struct FileUse {
    /// Dernière écoute (secondes depuis 1970)
    last: u64,
    /// Glissé au moins une fois dans un logiciel : conservé pour toujours
    #[serde(default)]
    dragged: bool,
}

static USES_LOCK: Mutex<()> = Mutex::new(());

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn uses_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(err)?.join("utilisation-sons.json"))
}

fn load_uses(app: &AppHandle) -> HashMap<String, FileUse> {
    uses_path(app).ok().and_then(|p| fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_uses(app: &AppHandle, uses: &HashMap<String, FileUse>) {
    if let Ok(p) = uses_path(app) {
        if let Some(dir) = p.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = p.with_extension("tmp");
        if serde_json::to_vec(uses).ok().and_then(|b| fs::write(&tmp, b).ok()).is_some() {
            let _ = fs::rename(&tmp, &p);
        }
    }
}

/// Met à jour le registre pour ce fichier (écouté maintenant, et éventuellement glissé).
fn record_use(app: &AppHandle, path: &Path, dragged: bool) {
    let _g = USES_LOCK.lock();
    let mut uses = load_uses(app);
    let e = uses.entry(path.to_string_lossy().into_owned()).or_insert(FileUse { last: 0, dragged: false });
    e.last = now_secs();
    e.dragged |= dragged;
    save_uses(app, &uses);
}

/// Le son vient d'être glissé dans un logiciel : on ne l'effacera jamais.
#[tauri::command]
fn mark_dragged(app: AppHandle, path: String) {
    record_use(&app, Path::new(&path), true);
}

/// Noms des fichiers glissés depuis le panneau Premiere (il les note dans sons-glisses.txt).
/// On compare par nom de fichier : chaque son a un nom unique, et l'écriture du chemin peut varier.
fn panel_used(app: &AppHandle) -> std::collections::HashSet<String> {
    let Ok(cfg) = app.path().app_config_dir() else { return Default::default() };
    fs::read_to_string(cfg.join("sons-glisses.txt"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| Path::new(l.trim()).file_name().map(|n| n.to_string_lossy().to_lowercase()))
        .collect()
}

fn used_in_panel(panel: &std::collections::HashSet<String>, path: &str) -> bool {
    Path::new(path).file_name().is_some_and(|n| panel.contains(&n.to_string_lossy().to_lowercase()))
}

/// Règle du nettoyage, isolée pour être testée : efface les fichiers jamais glissés
/// et pas écoutés depuis `limit` (secondes). Renvoie (nombre, octets libérés).
fn sweep(uses: &mut HashMap<String, FileUse>, panel: &std::collections::HashSet<String>, limit: u64) -> (u32, u64) {
    let (mut count, mut bytes) = (0u32, 0u64);
    uses.retain(|path, u| {
        if used_in_panel(panel, path) {
            u.dragged = true; // glissé depuis Premiere : conservé pour toujours
        }
        if u.dragged || u.last >= limit {
            return true;
        }
        let p = Path::new(path);
        match fs::metadata(p) {
            Ok(m) if m.is_file() => {
                if fs::remove_file(p).is_err() {
                    return true; // fichier ouvert ailleurs : on réessaiera plus tard
                }
                count += 1;
                bytes += m.len();
                // Range le dossier de catégorie s'il est devenu vide
                if let Some(dir) = p.parent() {
                    let _ = fs::remove_dir(dir);
                }
                false
            }
            _ => false, // déjà disparu : on l'oublie
        }
    });
    (count, bytes)
}

/// Efface les sons jamais glissés et pas écoutés depuis `days` jours. Renvoie (nombre, octets libérés).
fn cleanup(app: &AppHandle, days: u32) -> (u32, u64) {
    if days == 0 {
        return (0, 0);
    }
    let _g = USES_LOCK.lock();
    let mut uses = load_uses(app);
    let panel = panel_used(app);
    let limit = now_secs().saturating_sub(days as u64 * 86_400);
    let (count, bytes) = sweep(&mut uses, &panel, limit);
    save_uses(app, &uses);
    (count, bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupInfo {
    days: u32,
    /// Sons qui seront effacés au prochain nettoyage, et leur poids
    pending_count: u32,
    pending_bytes: u64,
    /// Sons conservés car glissés dans un logiciel
    kept_count: u32,
}

#[tauri::command]
fn cleanup_info(app: AppHandle) -> CleanupInfo {
    let days = load_settings(&app).cleanup_days.unwrap_or(DEFAULT_CLEANUP_DAYS);
    let limit = now_secs().saturating_sub(days as u64 * 86_400);
    let mut info = CleanupInfo { days, pending_count: 0, pending_bytes: 0, kept_count: 0 };
    let panel = panel_used(&app);
    for (path, u) in load_uses(&app) {
        if u.dragged || used_in_panel(&panel, &path) {
            info.kept_count += 1;
        } else if days > 0 && u.last < limit {
            if let Ok(m) = fs::metadata(&path) {
                info.pending_count += 1;
                info.pending_bytes += m.len();
            }
        }
    }
    info
}

#[tauri::command]
fn set_cleanup_days(app: AppHandle, days: u32) -> Result<(), String> {
    let mut settings = load_settings(&app);
    settings.cleanup_days = Some(days);
    save_settings(&app, &settings)
}

/// Sons déjà présents sur l'ordinateur (écoutables et glissables sans connexion).
#[tauri::command]
fn local_sounds(app: AppHandle, store: State<'_, Store>) -> Result<Vec<String>, String> {
    let guard = store.0.lock().map_err(err)?;
    let Some(catalog) = guard.as_ref() else { return Ok(vec![]) };
    let root = library_root(&app)?;
    let test = catalog.origin == "test";
    Ok(catalog
        .sounds
        .iter()
        .filter(|s| root.join(&s.code).join(if test { file_name(s) } else { s.file.clone() }).is_file())
        .map(|s| s.id.clone())
        .collect())
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
            // Les dossiers de sons personnels doivent rester lisibles par le lecteur audio
            perso::allow_all(app.handle());
            // Nettoyage automatique au démarrage, en arrière-plan (ne retarde jamais l'ouverture).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let days = load_settings(&handle).cleanup_days.unwrap_or(DEFAULT_CLEANUP_DAYS);
                let (n, b) = cleanup(&handle, days);
                if n > 0 {
                    eprintln!("Nettoyage : {n} sons effacés ({} Mo libérés)", b / 1_000_000);
                }
            });
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
                    if !win.is_visible().unwrap_or(true) {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_catalog, library_dir, default_library_dir, set_library_dir, ensure_local, drag_icon_path, send_feedback, premiere_status, install_premiere_panel, resolve_status, install_resolve_panel, contributions_open, read_audio, send_contribution, mark_dragged, cleanup_info, set_cleanup_days, local_sounds, accounts_open, compte::account_api, compte::account_signed_in, perso::get_user_dirs, perso::add_user_dir, perso::remove_user_dir, perso::scan_user_sounds, perso::analyze_user_sounds])
        .run(tauri::generate_context!())
        .expect("Onde n'a pas pu démarrer");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nettoyage_ne_touche_que_les_sons_seulement_ecoutes() {
        let dir = std::env::temp_dir().join(format!("onde-test-{}", now_secs()));
        let cat = dir.join("WHSH");
        fs::create_dir_all(&cat).unwrap();
        let f = |n: &str| { let p = cat.join(n); fs::write(&p, b"son").unwrap(); p.to_string_lossy().into_owned() };
        let (ancien, recent, glisse, premiere, inconnu) = (f("ancien.wav"), f("recent.wav"), f("glisse.wav"), f("premiere.wav"), f("inconnu.wav"));
        let now = 10_000_000;
        let limit = now - 30 * 86_400;
        let mut uses = HashMap::new();
        uses.insert(ancien.clone(), FileUse { last: limit - 1, dragged: false });
        uses.insert(recent.clone(), FileUse { last: now, dragged: false });
        uses.insert(glisse.clone(), FileUse { last: 0, dragged: true });
        uses.insert(premiere.clone(), FileUse { last: 0, dragged: false });
        uses.insert(cat.join("disparu.wav").to_string_lossy().into_owned(), FileUse { last: 0, dragged: false });
        let panel: std::collections::HashSet<String> = ["PREMIERE.wav".to_lowercase()].into();

        let (n, b) = sweep(&mut uses, &panel, limit);

        assert_eq!((n, b), (1, 3), "seul l'ancien son écouté est effacé");
        assert!(!Path::new(&ancien).exists());
        for p in [&recent, &glisse, &premiere, &inconnu] {
            assert!(Path::new(p).exists(), "{p} doit rester");
        }
        assert!(uses[&premiere].dragged, "glissé depuis Premiere : marqué comme utilisé");
        assert_eq!(uses.len(), 3, "les fichiers effacés ou disparus sont oubliés");
        fs::remove_dir_all(&dir).unwrap();
    }
}

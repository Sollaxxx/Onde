// Compte Onde (offre Onde Équipe) : connexion par code e-mail, gestion de l'équipe.
// Le jeton de session reste côté Rust, dans un fichier du dossier de configuration de l'application :
// l'interface ne le voit jamais. Elle appelle `account_api`, qui ajoute le jeton aux requêtes.

use super::{err, http, library_root, perso, site_request, urlencode, SITES};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("session.json"))
}

fn read_token(app: &AppHandle) -> Option<String> {
    let text = fs::read_to_string(session_path(app).ok()?).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    v["token"].as_str().filter(|t| !t.is_empty()).map(str::to_owned)
}

fn write_token(app: &AppHandle, token: &str) -> Result<(), String> {
    let path = session_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(&path, json!({ "token": token }).to_string()).map_err(err)?;
    // Sur Mac, le fichier n'est lisible que par l'utilisateur (sur Windows, le dossier AppData l'est déjà)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn forget(app: &AppHandle) {
    if let Ok(path) = session_path(app) {
        let _ = fs::remove_file(path);
    }
}

/// Le chemin est-il une route de compte ou d'équipe ? (l'interface ne peut pas appeler autre chose)
/// Seul paramètre accepté : `?v=<nombre>` (version du contenu d'une équipe déjà connue).
fn allowed(path: &str) -> bool {
    let (route, query) = path.split_once('?').unwrap_or((path, ""));
    let query_ok = query.is_empty()
        || query.strip_prefix("v=").is_some_and(|v| {
            let digits = v.strip_prefix('-').unwrap_or(v);
            !digits.is_empty() && digits.len() <= 12 && digits.chars().all(|c| c.is_ascii_digit())
        });
    (route.starts_with("compte/") || route.starts_with("equipe/"))
        && !route.contains("..")
        && route.chars().all(|c| c.is_ascii_alphanumeric() || "/-_.".contains(c))
        && query_ok
}

/// Appelle l'API des comptes du site d'Onde. Renvoie toujours le JSON de la réponse, avec son `status` :
/// l'interface lit `ok` et `error`. Le jeton reçu à la connexion est gardé ici et retiré de la réponse.
#[tauri::command]
pub async fn account_api(app: AppHandle, method: String, path: String, body: Option<Value>, lang: String) -> Result<Value, String> {
    if !allowed(&path) {
        return Err("chemin refusé".into());
    }
    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("méthode refusée".into()),
    };
    // Se déconnecter marche même sans réseau : la session locale est oubliée tout de suite.
    let token = read_token(&app);
    if path == "compte/deconnexion" {
        forget(&app);
    }
    let mut body = body;
    if path == "compte/connexion" {
        if let Some(obj) = body.as_mut().and_then(Value::as_object_mut) {
            let device = format!("Onde {} · {} {}", app.package_info().version, std::env::consts::OS, std::env::consts::ARCH);
            obj.insert("device".into(), Value::String(device));
        }
    }
    let payload = body.map(|b| b.to_string());
    let lang = if lang == "en" { "en" } else { "fr" };
    let client = http()?;
    let res = site_request(|site| {
        let mut rb = client
            .request(method.clone(), format!("{site}/api/{path}"))
            .header("X-Onde-Langue", lang)
            .timeout(Duration::from_secs(20));
        if let Some(t) = &token {
            rb = rb.bearer_auth(t);
        }
        if let Some(p) = &payload {
            rb = rb.header("Content-Type", "application/json").body(p.clone());
        }
        rb
    })
    .await?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    let mut v: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "ok": false, "error": "Réponse illisible du serveur Onde." }));
    if status.as_u16() == 401 && token.is_some() && path != "compte/connexion" {
        forget(&app); // session expirée ou fermée ailleurs
    }
    if status.is_success() {
        if path == "compte/connexion" {
            if let Some(t) = v["token"].as_str() {
                write_token(&app, t)?;
            }
            if let Some(obj) = v.as_object_mut() {
                obj.remove("token");
            }
        }
        if path == "compte/supprimer" {
            forget(&app);
        }
    }
    if let Some(obj) = v.as_object_mut() {
        obj.insert("status".into(), json!(status.as_u16()));
    }
    Ok(v)
}

/// Une session est-elle enregistrée sur cet ordinateur ? (sans appel réseau, pour l'affichage au démarrage)
#[tauri::command]
pub fn account_signed_in(app: AppHandle) -> bool {
    read_token(&app).is_some()
}

// ---------- Sons d'équipe ----------
// Les sons partagés d'une équipe sont téléchargés dans <dossier des sons>/Equipes/<nom de l'équipe>/.
// Ils ne passent pas par le nettoyage automatique : on ne les efface jamais.

/// Taille maximale d'un son envoyé à l'équipe (limite des requêtes Cloudflare).
const TEAM_FILE_MAX: u64 = 100 * 1024 * 1024;

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Nom de dossier sans caractères interdits par Windows ou macOS.
fn folder_name(name: &str) -> String {
    let clean: String = name.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    let clean = clean.trim().trim_matches('.').trim().chars().take(60).collect::<String>();
    if clean.is_empty() { "Equipe".into() } else { clean }
}

fn team_dir(app: &AppHandle, team_name: &str) -> Result<PathBuf, String> {
    Ok(library_root(app)?.join("Equipes").join(folder_name(team_name)))
}

/// « whoosh.wav » du son 1a2b3c4d-… → « whoosh_1a2b3c4d.wav » (deux sons de même nom ne s'écrasent pas).
fn team_file_name(id: &str, file_name: &str) -> String {
    let p = Path::new(file_name);
    let stem = folder_name(&p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "son".into()));
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).filter(|e| e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or_else(|| "wav".into());
    format!("{stem}_{}.{ext}", &id[..id.len().min(8)])
}

/// « pas_gravier-02.wav » → « pas gravier 02 »
fn title_from(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let t = stem.replace(['_', '-', '.'], " ");
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() { stem } else { t }
}

/// Envoie un fichier audio de l'ordinateur dans les sons de l'équipe (durée et forme d'onde calculées ici).
#[tauri::command]
pub async fn team_upload(app: AppHandle, team_id: String, path: String, title: Option<String>, lang: String) -> Result<Value, String> {
    if !safe_id(&team_id) {
        return Err("équipe inconnue".into());
    }
    let token = read_token(&app).ok_or("Session expirée. Reconnectez-vous.")?;
    let file = PathBuf::from(&path);
    let size = fs::metadata(&file).map_err(|e| format!("fichier illisible : {e}"))?.len();
    if size > TEAM_FILE_MAX {
        return Err("fichier trop lourd (100 Mo au maximum)".into());
    }
    let probe = file.clone();
    let (ms, peaks, format) = tauri::async_runtime::spawn_blocking(move || perso::analyze(&probe))
        .await
        .map_err(err)?
        .unwrap_or((0, vec![], String::new()));
    let bytes = fs::read(&file).map_err(|e| format!("fichier illisible : {e}"))?;
    let meta = json!({
        "title": title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| title_from(&file)),
        "fileName": file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        "durationMs": ms,
        "peaks": peaks.iter().map(|p| (p * 1000.0).round() / 1000.0).collect::<Vec<f32>>(),
        "format": format,
    });
    let meta = urlencode(&meta.to_string());
    let lang = if lang == "en" { "en" } else { "fr" };
    let client = http()?;
    let res = site_request(|site| {
        client
            .post(format!("{site}/api/equipe/{team_id}/sons"))
            .bearer_auth(&token)
            .header("X-Onde-Langue", lang)
            .header("X-Onde-Meta", meta.clone())
            .header("Content-Type", "application/octet-stream")
            .body(bytes.clone())
            .timeout(Duration::from_secs(600))
    })
    .await?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    let mut v: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "ok": false, "error": "Réponse illisible du serveur Onde." }));
    if status.as_u16() == 401 {
        forget(&app);
    }
    if let Some(obj) = v.as_object_mut() {
        obj.insert("status".into(), json!(status.as_u16()));
    }
    Ok(v)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamItem {
    id: String,
    file_name: String,
}

/// Sons de l'équipe déjà sur l'ordinateur (identifiant → chemin) : utilisables hors ligne.
#[tauri::command]
pub fn team_present(app: AppHandle, team_name: String, items: Vec<TeamItem>) -> HashMap<String, String> {
    let Ok(dir) = team_dir(&app, &team_name) else { return HashMap::new() };
    items
        .into_iter()
        .filter(|i| safe_id(&i.id))
        .filter_map(|i| {
            let p = dir.join(team_file_name(&i.id, &i.file_name));
            p.is_file().then(|| (i.id, p.to_string_lossy().into_owned()))
        })
        .collect()
}

/// Rend un son de l'équipe disponible sur le disque (téléchargement par son lien temporaire) et renvoie son chemin.
#[tauri::command]
pub async fn team_file(app: AppHandle, team_name: String, id: String, file_name: String, url: String) -> Result<String, String> {
    if !safe_id(&id) {
        return Err("son inconnu".into());
    }
    let dir = team_dir(&app, &team_name)?;
    let dest = dir.join(team_file_name(&id, &file_name));
    if dest.is_file() {
        return Ok(dest.to_string_lossy().into_owned());
    }
    // Seuls les liens du site d'Onde sont téléchargés
    if !SITES.iter().any(|s| url.starts_with(&format!("{s}/api/fichier-equipe/"))) {
        return Err("lien refusé".into());
    }
    let bytes = http()?
        .get(&url)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| format!("Téléchargement impossible : {e}"))?
        .error_for_status()
        .map_err(|e| format!("Téléchargement impossible : {e}"))?
        .bytes()
        .await
        .map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    let part = dest.with_extension("part");
    fs::write(&part, &bytes).map_err(err)?;
    fs::rename(&part, &dest).map_err(err)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{allowed, folder_name, team_file_name, title_from};

    #[test]
    fn noms_de_fichiers_d_equipe() {
        assert_eq!(folder_name("Studio: Alpha/Beta?"), "Studio_ Alpha_Beta_");
        assert_eq!(folder_name("..."), "Equipe");
        assert_eq!(team_file_name("1a2b3c4d-5e6f", "whoosh.WAV"), "whoosh_1a2b3c4d.wav");
        assert_eq!(team_file_name("ab", "sans extension"), "sans extension_ab.wav");
        assert_eq!(title_from(std::path::Path::new("/x/pas_gravier-02.wav")), "pas gravier 02");
    }

    #[test]
    fn seules_les_routes_de_compte_sont_permises() {
        assert!(allowed("compte/moi"));
        assert!(allowed("equipe/1234-abcd/invitations"));
        assert!(!allowed("admin/equipes"));
        assert!(!allowed("compte/../admin/equipes"));
        assert!(!allowed("compte/moi?x=1"));
        assert!(allowed("equipe/1234-abcd/contenu?v=-1"));
        assert!(allowed("equipe/1234-abcd/contenu?v=12"));
        assert!(!allowed("equipe/1234-abcd/contenu?v=12&x=1"));
        assert!(!allowed("equipe/1234-abcd/contenu?v="));
        assert!(allowed("equipe/1234-abcd/playlists/p1/sons/bsb-0003"));
        assert!(!allowed("https://ailleurs.com/compte/moi"));
    }
}

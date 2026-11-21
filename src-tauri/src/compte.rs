// Compte Onde (offre Onde Équipe) : connexion par code e-mail, gestion de l'équipe.
// Le jeton de session reste côté Rust, dans un fichier du dossier de configuration de l'application :
// l'interface ne le voit jamais. Elle appelle `account_api`, qui ajoute le jeton aux requêtes.

use super::{err, http, site_request};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
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
fn allowed(path: &str) -> bool {
    (path.starts_with("compte/") || path.starts_with("equipe/"))
        && !path.contains("..")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || "/-_".contains(c))
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

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn seules_les_routes_de_compte_sont_permises() {
        assert!(allowed("compte/moi"));
        assert!(allowed("equipe/1234-abcd/invitations"));
        assert!(!allowed("admin/equipes"));
        assert!(!allowed("compte/../admin/equipes"));
        assert!(!allowed("compte/moi?x=1"));
        assert!(!allowed("https://ailleurs.com/compte/moi"));
    }
}

// Sons personnels : dossiers de l'utilisateur ajoutés à la bibliothèque d'Onde.
// Les fichiers restent où ils sont : Onde les lit, les analyse (durée, forme d'onde)
// et les mélange à la banque dans la recherche. Rien n'est copié, déplacé ni effacé.

use super::{allow_playback, err, library_root, load_settings, save_settings};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

const EXTENSIONS: [&str; 11] = ["wav", "wave", "aif", "aiff", "mp3", "flac", "ogg", "m4a", "aac", "caf", "opus"];
/// Garde-fou : au-delà, on arrête de parcourir (un disque entier choisi par erreur).
const MAX_FILES: usize = 100_000;
/// Nombre de barres de forme d'onde calculées par son.
const PEAKS: usize = 120;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserSound {
    pub path: String,
    /// Dossier ajouté par l'utilisateur qui contient ce son
    pub root: String,
    /// Sous-dossiers entre le dossier ajouté et le fichier (servent de mots-clés)
    pub dirs: Vec<String>,
    pub bytes: u64,
    pub modified: u64,
    pub duration_ms: Option<u64>,
    pub peaks: Option<Vec<f32>>,
    pub format: Option<String>,
}

static CACHE_LOCK: Mutex<()> = Mutex::new(());

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(err)?.join("sons-perso.json"))
}

fn load_cache(app: &AppHandle) -> HashMap<String, UserSound> {
    cache_path(app).ok().and_then(|p| fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_cache(app: &AppHandle, cache: &HashMap<String, UserSound>) {
    if let Ok(p) = cache_path(app) {
        if let Some(dir) = p.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = p.with_extension("tmp");
        if serde_json::to_vec(cache).ok().and_then(|b| fs::write(&tmp, b).ok()).is_some() {
            let _ = fs::rename(&tmp, &p);
        }
    }
}

pub fn user_dirs(app: &AppHandle) -> Vec<String> {
    load_settings(app).user_dirs.unwrap_or_default()
}

/// Autorise la lecture des dossiers personnels (au démarrage).
pub fn allow_all(app: &AppHandle) {
    for d in user_dirs(app) {
        allow_playback(app, Path::new(&d));
    }
}

fn is_audio(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Parcourt un dossier et ses sous-dossiers (dossiers cachés ignorés).
fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let name = e.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let p = e.path();
        match e.file_type() {
            Ok(t) if t.is_dir() => walk(&p, out),
            Ok(t) if t.is_file() && is_audio(&p) => out.push(p),
            _ => {}
        }
    }
}

#[tauri::command]
pub fn get_user_dirs(app: AppHandle) -> Vec<String> {
    user_dirs(&app)
}

#[tauri::command]
pub fn add_user_dir(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(path.trim());
    if !dir.is_dir() {
        return Err("ce dossier n'existe pas".into());
    }
    if dir.parent().is_none() {
        return Err("choisissez un dossier, pas un disque entier".into());
    }
    if let Ok(lib) = library_root(&app) {
        if dir.starts_with(&lib) || lib.starts_with(&dir) {
            return Err("ce dossier contient les sons de la banque Onde : choisissez un dossier avec vos propres sons".into());
        }
    }
    let mut settings = load_settings(&app);
    let mut dirs = settings.user_dirs.take().unwrap_or_default();
    let s = dir.to_string_lossy().into_owned();
    if dirs.iter().any(|d| Path::new(d) == dir) {
        settings.user_dirs = Some(dirs);
        return Err("ce dossier est déjà dans la liste".into());
    }
    dirs.push(s);
    settings.user_dirs = Some(dirs.clone());
    save_settings(&app, &settings)?;
    allow_playback(&app, &dir);
    Ok(dirs)
}

#[tauri::command]
pub fn remove_user_dir(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let mut settings = load_settings(&app);
    let mut dirs = settings.user_dirs.take().unwrap_or_default();
    dirs.retain(|d| d != &path);
    settings.user_dirs = Some(dirs.clone());
    save_settings(&app, &settings)?;
    Ok(dirs)
}

/// Liste les sons des dossiers personnels. Les sons déjà analysés (et inchangés) reviennent
/// avec leur durée et leur forme d'onde ; les autres sont à analyser avec `analyze_user_sounds`.
#[tauri::command]
pub async fn scan_user_sounds(app: AppHandle) -> Result<Vec<UserSound>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _g = CACHE_LOCK.lock();
        let cache = load_cache(&app);
        let mut list = Vec::new();
        for root in user_dirs(&app) {
            let mut files = Vec::new();
            walk(Path::new(&root), &mut files);
            for p in files {
                let Ok(m) = fs::metadata(&p) else { continue };
                let modified = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                let path = p.to_string_lossy().into_owned();
                let dirs = p
                    .parent()
                    .and_then(|par| par.strip_prefix(&root).ok())
                    .map(|rel| rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect())
                    .unwrap_or_default();
                let mut s = UserSound { path: path.clone(), root: root.clone(), dirs, bytes: m.len(), modified, duration_ms: None, peaks: None, format: None };
                if let Some(c) = cache.get(&path) {
                    if c.bytes == s.bytes && c.modified == s.modified {
                        s.duration_ms = c.duration_ms;
                        s.peaks = c.peaks.clone();
                        s.format = c.format.clone();
                    }
                }
                list.push(s);
            }
        }
        Ok(list)
    })
    .await
    .map_err(err)?
}

/// Analyse des sons (durée, format, forme d'onde) et garde le résultat pour les prochaines fois.
#[tauri::command]
pub async fn analyze_user_sounds(app: AppHandle, sounds: Vec<UserSound>) -> Result<Vec<UserSound>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let done: Vec<UserSound> = sounds
            .into_iter()
            .map(|mut s| {
                match analyze(Path::new(&s.path)) {
                    Ok((ms, peaks, format)) => {
                        s.duration_ms = Some(ms);
                        s.peaks = Some(peaks);
                        s.format = Some(format);
                    }
                    Err(_) => {
                        // Illisible : on le garde, sans forme d'onde, pour ne pas réessayer à chaque fois
                        s.duration_ms = Some(0);
                        s.peaks = Some(vec![]);
                        s.format = Some(Path::new(&s.path).extension().map(|e| e.to_string_lossy().to_uppercase()).unwrap_or_default());
                    }
                }
                s
            })
            .collect();
        let _g = CACHE_LOCK.lock();
        let mut cache = load_cache(&app);
        // On oublie les fichiers des dossiers retirés de la liste
        let roots = user_dirs(&app);
        cache.retain(|_, s| roots.contains(&s.root));
        for s in &done {
            cache.insert(s.path.clone(), s.clone());
        }
        save_cache(&app, &cache);
        Ok(done)
    })
    .await
    .map_err(err)?
}

/// Durée (ms), forme d'onde (valeurs 0–1) et description du format d'un fichier audio.
pub fn analyze(path: &Path) -> Result<(u64, Vec<f32>, String), String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
    use symphonia::core::errors::Error;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = fs::File::open(path).map_err(err)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(err)?;
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("aucune piste audio")?.clone();
    let params = &track.codec_params;
    let rate = params.sample_rate.unwrap_or(48_000).max(1);
    let channels = params.channels.map(|c| c.count()).unwrap_or(1).max(1);
    let bits = params.bits_per_sample;
    let mut decoder = symphonia::default::get_codecs().make(params, &DecoderOptions::default()).map_err(err)?;

    // Maximum par tranche de 10 ms, puis regroupé en PEAKS barres
    let chunk = (rate as usize / 100).max(1);
    let (mut maxima, mut cur, mut in_chunk, mut frames) = (Vec::<f32>::new(), 0f32, 0usize, 0u64);
    let mut buf: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(_)) | Err(Error::ResetRequired) => break,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id() != track.id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        };
        let spec = *decoded.spec();
        let nch = spec.channels.count().max(1);
        let need = decoded.capacity() as u64;
        if buf.as_ref().map_or(true, |b| (b.capacity() as u64) < need * nch as u64) {
            buf = Some(SampleBuffer::new(need, spec));
        }
        let b = buf.as_mut().unwrap();
        b.copy_interleaved_ref(decoded);
        for frame in b.samples().chunks(nch) {
            let v = frame.iter().fold(0f32, |m, x| m.max(x.abs()));
            cur = cur.max(v);
            in_chunk += 1;
            frames += 1;
            if in_chunk == chunk {
                maxima.push(cur);
                cur = 0.0;
                in_chunk = 0;
            }
        }
    }
    if in_chunk > 0 {
        maxima.push(cur);
    }
    let ms = frames * 1000 / rate as u64;
    let mut peaks = vec![0f32; PEAKS];
    if !maxima.is_empty() {
        for (i, p) in peaks.iter_mut().enumerate() {
            let a = i * maxima.len() / PEAKS;
            let b = ((i + 1) * maxima.len() / PEAKS).max(a + 1).min(maxima.len());
            *p = maxima[a.min(maxima.len() - 1)..b].iter().cloned().fold(0f32, f32::max);
        }
        let top = peaks.iter().cloned().fold(0f32, f32::max);
        if top > 0.0 {
            peaks.iter_mut().for_each(|p| *p = (*p / top * 100.0).round() / 100.0);
        }
    }
    let ext = path.extension().map(|e| e.to_string_lossy().to_uppercase()).unwrap_or_default();
    let khz = if rate % 1000 == 0 { format!("{}", rate / 1000) } else { format!("{:.1}", rate as f32 / 1000.0) };
    let mut desc = format!("{ext} · {khz} kHz");
    if let Some(b) = bits {
        desc.push_str(&format!(" · {b} bits"));
    }
    desc.push_str(if channels == 1 { " · mono" } else if channels == 2 { " · stéréo" } else { " · multicanal" });
    Ok((ms, peaks, desc))
}

#[cfg(test)]
mod tests {
    #[test]
    fn analyse_des_formats() {
        let Ok(dir) = std::env::var("ONDE_TEST_SONS") else { return };
        for e in ["wav", "mp3", "flac", "aiff", "m4a", "ogg"] {
            let p = std::path::Path::new(&dir).join(format!("test.{e}"));
            let (ms, peaks, fmt) = super::analyze(&p).unwrap_or_else(|x| panic!("{e} : {x}"));
            println!("{e:5} {ms:6} ms  {fmt:40}  barres={} max={:.2}", peaks.len(), peaks.iter().cloned().fold(0f32, f32::max));
            assert!(ms > 0 && peaks.len() == super::PEAKS);
        }
    }
}

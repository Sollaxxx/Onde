#!/bin/sh
# Sauvegarde nocturne d'Onde vers le NAS.
# Chaque nuit, la copie précédente est remplacée par l'état actuel (copie miroir) :
#   sons/   : tous les fichiers du bucket R2 (sons + catalogue)
#   base/   : la base D1 (liste d'attente, retours, contributions) en SQL
#   code/   : le dépôt GitHub complet, avec tout l'historique
# Garde-fou : si la source paraît soudain vide ou presque (panne, mauvaise clé),
# la copie miroir est annulée, pour ne pas effacer une bonne sauvegarde avec une mauvaise.
set -eu

DEST="${DEST:-/sauvegarde}"
R2_BUCKET="${R2_BUCKET:-onde-sons}"
D1_NOM="${D1_NOM:-Onde}"
DEPOT_GIT="${DEPOT_GIT:-https://github.com/Sollaxxx/Onde.git}"
# Source des sons (modifiable pour les tests). Par défaut : le bucket R2.
SOURCE_SONS="${SOURCE_SONS:-r2:$R2_BUCKET}"
# En dessous de cette proportion de fichiers par rapport à la dernière sauvegarde : on n'efface rien.
SEUIL_PCT="${SEUIL_PCT:-50}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
echec=0
fail() { log "ÉCHEC : $*"; echec=1; }

mkdir -p "$DEST/sons" "$DEST/base" "$DEST/code"
log "Sauvegarde d'Onde vers $DEST"

# Connexion à R2 sans fichier de configuration (rclone lit ces variables)
export RCLONE_CONFIG="${RCLONE_CONFIG:-/tmp/rclone.conf}"; touch "$RCLONE_CONFIG"
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
fi

# ---------- 1. Les sons ----------
log "1/3 Sons : comptage en ligne…"
if rclone lsf -R --files-only --fast-list "$SOURCE_SONS" >/tmp/liste.txt; then
  en_ligne=$(wc -l </tmp/liste.txt)
  sur_nas=$(find "$DEST/sons" -type f | wc -l)
  log "    $en_ligne fichiers en ligne, $sur_nas sur le NAS"
  if [ "$en_ligne" -eq 0 ] || { [ "$sur_nas" -gt 100 ] && [ $((en_ligne * 100)) -lt $((sur_nas * SEUIL_PCT)) ]; }; then
    fail "la source a beaucoup moins de fichiers que la dernière sauvegarde ($en_ligne contre $sur_nas). Rien n'a été effacé. Vérifiez R2, puis relancez avec SEUIL_PCT=0 si c'est voulu."
  elif rclone sync "$SOURCE_SONS" "$DEST/sons" --fast-list --transfers 8 --checkers 16 --stats-one-line --stats 5m --stats-log-level NOTICE; then
    log "    sons à jour"
  else
    fail "copie des sons interrompue (la sauvegarde précédente est conservée pour les fichiers non traités)"
  fi
else
  fail "impossible de lire le bucket R2 (clé R2 ou identifiant de compte incorrects ?)"
fi

# ---------- 2. La base de données ----------
log "2/3 Base de données D1…"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  fail "CLOUDFLARE_API_TOKEN manquant : base non sauvegardée"
elif wrangler d1 export "$D1_NOM" --remote --output "$DEST/base/onde.sql.tmp" >/tmp/wrangler.log 2>&1 && [ -s "$DEST/base/onde.sql.tmp" ]; then
  mv -f "$DEST/base/onde.sql.tmp" "$DEST/base/onde.sql"   # remplace l'ancienne version d'un coup
  log "    base exportée ($(wc -c <"$DEST/base/onde.sql") octets)"
else
  rm -f "$DEST/base/onde.sql.tmp"
  tail -n 5 /tmp/wrangler.log || true
  fail "export de la base impossible (l'ancienne copie est conservée)"
fi

# ---------- 3. Le code ----------
log "3/3 Code (GitHub)…"
if [ -d "$DEST/code/onde.git" ]; then
  if git --git-dir="$DEST/code/onde.git" remote update --prune >/dev/null 2>&1; then log "    code à jour"; else fail "mise à jour du code impossible"; fi
else
  if git clone --mirror --quiet "$DEPOT_GIT" "$DEST/code/onde.git"; then log "    code copié"; else fail "copie du code impossible"; fi
fi

# ---------- Bilan ----------
{
  echo "Dernière sauvegarde : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "Résultat : $([ "$echec" -eq 0 ] && echo 'OK' || echo 'ÉCHEC (voir le journal)')"
  echo "Sons : $(find "$DEST/sons" -type f | wc -l) fichiers, $(du -sh "$DEST/sons" | cut -f1)"
  echo "Base : $([ -f "$DEST/base/onde.sql" ] && wc -c <"$DEST/base/onde.sql" || echo 0) octets"
} > "$DEST/DERNIERE-SAUVEGARDE.txt"
cat "$DEST/DERNIERE-SAUVEGARDE.txt"
exit "$echec"

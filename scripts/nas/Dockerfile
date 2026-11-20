# Image de la sauvegarde nocturne d'Onde (pour un NAS, par exemple sous OpenMediaVault).
# rclone copie les sons depuis Cloudflare R2, wrangler exporte la base D1, git copie le code.
FROM node:22.11.0-alpine3.20
RUN apk add --no-cache rclone git ca-certificates tzdata \
 && npm install -g wrangler@4.149.0 \
 && npm cache clean --force
COPY sauvegarde.sh /usr/local/bin/sauvegarde
RUN chmod +x /usr/local/bin/sauvegarde
WORKDIR /tmp
ENTRYPOINT ["/usr/local/bin/sauvegarde"]

// Onde - partie ExtendScript du panneau CEP (Premiere Pro 2019 et plus).
// ExtendScript est un JavaScript ancien (ES3) : pas de JSON, pas de let, pas d'accents dans ce fichier.
// Chaque fonction renvoie une petite chaine JSON lue par le panneau.

function ondeResult(ok, fields) {
    return '{"ok":' + (ok ? 'true' : 'false') + (fields ? ',' + fields : '') + '}';
}

function ondeError(code) {
    return ondeResult(false, '"error":"' + String(code).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"');
}

function ondeNorm(p) {
    return String(p).replace(/\\/g, '/').toLowerCase();
}

function ondeFindBin() {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var it = root.children[i];
        if (it && it.type === ProjectItemType.BIN && it.name === 'Onde') return it;
    }
    return null;
}

function ondeFindClip(bin, path) {
    var want = ondeNorm(path);
    for (var i = 0; i < bin.children.numItems; i++) {
        var it = bin.children[i];
        if (it && (it.type === ProjectItemType.CLIP || it.type === ProjectItemType.FILE)) {
            try {
                if (ondeNorm(it.getMediaPath()) === want) return it;
            } catch (e) { /* element sans media */ }
        }
    }
    return null;
}

/** Premiere piste audio libre entre start et end (secondes), ou -1. */
function ondeFreeTrack(seq, start, end) {
    var tracks = seq.audioTracks;
    for (var t = 0; t < tracks.numTracks; t++) {
        var tr = tracks[t];
        try { if (tr.isLocked()) continue; } catch (e) { /* ancienne version */ }
        var free = true;
        for (var c = 0; c < tr.clips.numItems; c++) {
            var cl = tr.clips[c];
            if (cl.start.seconds < end && cl.end.seconds > start) { free = false; break; }
        }
        if (free) return t;
    }
    return -1;
}

/**
 * Importe le fichier dans le chutier "Onde" (une seule fois), puis le pose a la tete de lecture
 * sur la premiere piste audio libre. Aucun clip existant n'est deplace.
 */
function ondeInsert(path, duration) {
    try {
        if (!app.project) return ondeError('noproject');
        var seq = app.project.activeSequence;
        if (!seq) return ondeError('nosequence');

        var bin = ondeFindBin();
        if (!bin) { app.project.rootItem.createBin('Onde'); bin = ondeFindBin(); }
        if (!bin) bin = app.project.rootItem;

        var clip = ondeFindClip(bin, path);
        if (!clip) {
            app.project.importFiles([path], true, bin, false);
            clip = ondeFindClip(bin, path);
        }
        if (!clip) return ondeError('import');

        var start = seq.getPlayerPosition().seconds;
        var idx = ondeFreeTrack(seq, start, start + duration);
        if (idx < 0) {
            // Toutes les pistes sont occupees : on en ajoute une a la fin.
            var before = seq.audioTracks.numTracks;
            try {
                app.enableQE();
                qe.project.getActiveSequence().addTracks(0, 0, 1, 1, before, 0, 0);
            } catch (e) { /* QE indisponible */ }
            if (seq.audioTracks.numTracks > before) idx = seq.audioTracks.numTracks - 1;
        }
        if (idx < 0) return ondeError('notrack');

        seq.audioTracks[idx].overwriteClip(clip, start);
        return ondeResult(true, '"track":' + idx + ',"start":' + start);
    } catch (e) {
        return ondeError(e.toString());
    }
}

// Section « Compte » des Réglages : connexion par code e-mail et gestion de l'équipe (Onde Équipe).
// Pas de fonction de partage ici pour l'instant : seulement les comptes, les équipes, les membres et les invitations.
import * as api from "./api";
import { errText, getLang, t, tn } from "./i18n";

interface Member { id: string; email: string; name: string; role: Role; joinedAt: string }
interface PendingInvite { id: string; email: string; role: Role; createdAt: string; expiresAt: string }
type Role = "proprietaire" | "membre";
export interface Team {
  id: string; name: string; plan: string; planName: string; seats: number; storageGb: number;
  status: "essai" | "actif" | "suspendu"; trialUntil: string | null; active: boolean; role: Role;
  members?: Member[]; invitations?: PendingInvite[]; seatsUsed?: number;
}
interface ReceivedInvite { id: string; role: Role; team: { id: string; name: string }; invitedBy: string | null }
interface Account { id: string; email: string; name: string }

export interface AccountHost {
  render: () => void;
  toast: (msg: string) => void;
  /** Les équipes du compte ont changé (connexion, invitation acceptée, déconnexion…). */
  teamsChanged: (teams: Team[], accountId: string | null) => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(getLang() === "en" ? "en-US" : "fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");
const CONTACT = "contact.ondesound@gmail.com";
const TESTER = "onde.testeur";
const tester = () => { try { return localStorage.getItem(TESTER) === "1"; } catch { return false; } };

export function createAccount(host: AccountHost) {
  const st = {
    visible: false, // section affichée : comptes ouverts sur le serveur, ou déjà connecté sur cet ordinateur
    signedIn: false,
    loading: false,
    account: null as Account | null,
    teams: [] as Team[],
    invitations: [] as ReceivedInvite[],
    step: "email" as "email" | "code",
    email: "",
    code: "",
    name: "",
    invite: {} as Record<string, string>, // e-mail saisi dans le champ « Inviter », par équipe
    busy: "" as string, // action en cours (désactive les boutons)
    error: "",
    confirmDelete: false,
  };

  const fail = (e: unknown) => { st.error = errText(e); };

  async function load(): Promise<void> {
    st.loading = true;
    host.render();
    try {
      const me = await api.accountApi("GET", "compte/moi");
      st.account = me.account;
      st.name = me.account.name ?? "";
      st.invitations = me.invitations;
      // Détail de chaque équipe (membres, invitations en attente) : une requête par équipe, il y en a peu.
      st.teams = await Promise.all((me.teams as Team[]).map(async (team) => {
        try { return { ...team, ...(await api.accountApi("GET", `equipe/${team.id}`)).team }; } catch { return team; }
      }));
      st.error = "";
      host.teamsChanged(st.teams, st.account?.id ?? null);
    } catch (e) {
      if ((e as { status?: number }).status === 401) signOutLocally();
      else fail(e);
    }
    st.loading = false;
    host.render();
  }

  function signOutLocally(): void {
    st.signedIn = false;
    st.account = null;
    st.teams = [];
    st.invitations = [];
    st.step = "email";
    st.code = "";
    st.confirmDelete = false;
    host.teamsChanged([], null);
  }

  async function run(key: string, job: () => Promise<void>): Promise<void> {
    if (st.busy) return;
    st.busy = key;
    st.error = "";
    host.render();
    try { await job(); } catch (e) { fail(e); }
    st.busy = "";
    host.render();
  }

  // ---------- Connexion ----------
  const sendCode = () => run("code", async () => {
    const email = st.email.trim().toLowerCase();
    const r = await api.accountApi("POST", "compte/code", { email, lang: getLang() });
    st.email = email;
    st.step = "code";
    st.code = r.devCode ?? ""; // seulement avec le serveur de test local
    requestAnimationFrame(() => document.getElementById("ac-code")?.focus());
  });

  const signIn = () => run("signin", async () => {
    await api.accountApi("POST", "compte/connexion", { email: st.email, code: st.code.trim() });
    st.signedIn = true;
    st.code = "";
    host.toast(t("Vous êtes connecté."));
    await load();
  });

  // ---------- Affichage ----------
  function statusBadge(team: Team): string {
    if (team.status === "suspendu") return `<span class="badge red">${t("SUSPENDUE")}</span>`;
    if (team.status === "essai") {
      return team.active
        ? `<span class="badge on">${t("ESSAI JUSQU'AU {d}", { d: esc(day(team.trialUntil).toUpperCase()) })}</span>`
        : `<span class="badge red">${t("ESSAI TERMINÉ")}</span>`;
    }
    return `<span class="badge on">${t("ACTIVE")}</span>`;
  }

  function teamBlock(team: Team): string {
    const owner = team.role === "proprietaire";
    const me = st.account?.id;
    const used = team.seatsUsed ?? team.members?.length ?? 0;
    const members = (team.members ?? []).map((m) => `<li>
        <span class="ac-who"><b>${esc(m.name || m.email)}</b>${m.name ? `<span>${esc(m.email)}</span>` : ""}</span>
        <span class="ac-role">${m.role === "proprietaire" ? t("Propriétaire") : t("Membre")}${m.id === me ? ` · ${t("vous")}` : ""}</span>
        ${owner && m.id !== me ? `<span class="btns">
          <button class="link-btn" data-act="ac-role" data-team="${team.id}" data-member="${m.id}" data-role="${m.role === "proprietaire" ? "membre" : "proprietaire"}" ${st.busy ? "disabled" : ""}>${m.role === "proprietaire" ? t("Retirer le rôle de propriétaire") : t("Nommer propriétaire")}</button>
          <button class="link-btn danger" data-act="ac-remove" data-team="${team.id}" data-member="${m.id}" ${st.busy ? "disabled" : ""}>${t("Retirer")}</button></span>` : ""}
      </li>`).join("");
    const pending = (team.invitations ?? []).map((i) => `<li>
        <span class="ac-who"><b>${esc(i.email)}</b><span>${t("Invitation envoyée, en attente")}</span></span>
        <span class="ac-role">${i.role === "proprietaire" ? t("Propriétaire") : t("Membre")}</span>
        ${owner ? `<span class="btns"><button class="link-btn" data-act="ac-cancel" data-team="${team.id}" data-invite="${i.id}" ${st.busy ? "disabled" : ""}>${t("Annuler")}</button></span>` : ""}
      </li>`).join("");
    const full = used >= team.seats;
    return `<div class="ac-team">
      <div class="ac-team-head">
        <div><b>${esc(team.name)}</b><span>${t("Forfait {plan}", { plan: esc(team.planName) })} · ${tn(team.seats, "{used} / {n} place", "{used} / {n} places", { used })} · ${t("{n} Go de stockage partagé", { n: team.storageGb })} · ${team.role === "proprietaire" ? t("vous êtes propriétaire") : t("vous êtes membre")}</span></div>
        ${statusBadge(team)}
      </div>
      <ul class="ac-list">${members}${pending}</ul>
      ${owner ? `<div class="ac-invite">
        <label class="sr" for="ac-invite-${team.id}">${t("E-mail à inviter")}</label>
        <input id="ac-invite-${team.id}" data-team="${team.id}" type="email" placeholder="${t("E-mail à inviter")}" value="${esc(st.invite[team.id] ?? "")}" autocomplete="off" ${full || team.status === "suspendu" ? "disabled" : ""} />
        <button class="secondary strong" data-act="ac-invite" data-team="${team.id}" ${st.busy || full || team.status === "suspendu" ? "disabled" : ""}>${st.busy === `invite-${team.id}` ? t("Envoi…") : t("Inviter")}</button>
      </div>
      ${full ? `<p class="hint">${t("Toutes les places du forfait sont prises. Pour en ajouter, écrivez-nous à {mail}.", { mail: CONTACT })}</p>` : ""}`
      : `<div class="btns"><button class="link-btn danger" data-act="ac-leave" data-team="${team.id}" ${st.busy ? "disabled" : ""}>${t("Quitter l'équipe")}</button></div>`}
    </div>`;
  }

  function signedOutView(): string {
    if (st.step === "code") {
      return `<div class="set-row ac-form">
        <div><b>${t("Entrez le code reçu")}</b><span>${t("Un code à 6 chiffres a été envoyé à {email}. Il expire dans 10 minutes.", { email: esc(st.email) })}</span></div>
        <div class="ac-fields">
          <label class="sr" for="ac-code">${t("Code à 6 chiffres")}</label>
          <input id="ac-code" class="ac-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" value="${esc(st.code)}" />
          <button class="secondary strong" data-act="ac-signin" ${st.busy ? "disabled" : ""}>${st.busy === "signin" ? t("Connexion…") : t("Se connecter")}</button>
        </div>
      </div>
      <div class="btns ac-links"><button class="link-btn" data-act="ac-resend" ${st.busy ? "disabled" : ""}>${t("Renvoyer le code")}</button><button class="link-btn" data-act="ac-change">${t("Changer d'adresse")}</button></div>`;
    }
    return `<div class="set-row ac-form">
      <div><b>${t("Se connecter")}</b><span>${t("Le compte sert à rejoindre l'équipe de votre studio avec Onde Équipe. La bibliothèque reste gratuite et sans compte. Pas de mot de passe : on vous envoie un code par e-mail.")}</span></div>
      <div class="ac-fields">
        <label class="sr" for="ac-email">${t("Votre e-mail")}</label>
        <input id="ac-email" type="email" autocomplete="email" placeholder="${t("vous@exemple.fr")}" value="${esc(st.email)}" />
        <button class="secondary strong" data-act="ac-send" ${st.busy ? "disabled" : ""}>${st.busy === "code" ? t("Envoi…") : t("Recevoir un code")}</button>
      </div>
    </div>`;
  }

  function signedInView(): string {
    const a = st.account;
    if (!a) return `<div class="set-row"><div><span>${st.loading ? t("Chargement…") : ""}</span></div></div>`;
    const invites = st.invitations.map((i) => `<div class="set-row ac-received">
        <div><b>${t("{team} vous invite à rejoindre son équipe", { team: esc(i.team.name) })}</b><span>${i.role === "proprietaire" ? t("En tant que propriétaire : vous pourrez inviter et gérer les membres.") : t("En tant que membre.")}${i.invitedBy ? ` ${t("Invitation de {who}.", { who: esc(i.invitedBy) })}` : ""}</span></div>
        <div class="btns">
          <button class="secondary" data-act="ac-decline" data-invite="${i.id}" ${st.busy ? "disabled" : ""}>${t("Refuser")}</button>
          <button class="secondary strong" data-act="ac-accept" data-invite="${i.id}" ${st.busy ? "disabled" : ""}>${t("Rejoindre")}</button>
        </div>
      </div>`).join("");
    const teams = st.teams.length
      ? st.teams.map(teamBlock).join("")
      : st.invitations.length ? "" : `<div class="set-row"><div><b>${t("Aucune équipe pour l'instant")}</b><span>${t("Onde Équipe permet à un studio de partager ses sons et ses playlists. L'offre est proposée sur demande : écrivez-nous et on vous ouvre un essai gratuit de 30 jours.")}</span></div>
          <button class="secondary strong" data-act="ac-contact">${t("Nous écrire")}</button></div>`;
    return `<div class="set-row">
        <div><b>${t("Connecté")}</b><span class="path">${esc(a.email)}</span></div>
        <button class="secondary" data-act="ac-signout" ${st.busy ? "disabled" : ""}>${t("Se déconnecter")}</button>
      </div>
      <div class="set-row">
        <div><b>${t("Votre nom")}</b><span>${t("Affiché aux membres de votre équipe.")}</span></div>
        <div class="ac-fields">
          <label class="sr" for="ac-name">${t("Votre nom")}</label>
          <input id="ac-name" maxlength="60" placeholder="${t("Prénom Nom")}" value="${esc(st.name)}" />
          <button class="secondary" data-act="ac-save-name" ${st.busy || st.name.trim() === (a.name ?? "") ? "disabled" : ""}>${t("Enregistrer")}</button>
        </div>
      </div>
      ${invites}${teams}
      <div class="set-row">
        <div><b>${t("Supprimer mon compte")}</b><span>${t("Votre compte et votre place dans les équipes sont effacés. Vos sons et vos réglages sur cet ordinateur ne sont pas touchés.")}</span></div>
        ${st.confirmDelete
          ? `<div class="btns"><button class="secondary" data-act="ac-delete-no">${t("Annuler")}</button><button class="secondary danger" data-act="ac-delete-yes" ${st.busy ? "disabled" : ""}>${t("Supprimer définitivement")}</button></div>`
          : `<button class="secondary" data-act="ac-delete">${t("Supprimer…")}</button>`}
      </div>`;
  }

  return {
    /** Au démarrage : une session existe-t-elle sur cet ordinateur ? (rien n'est chargé tant qu'on n'ouvre pas les Réglages) */
    async init(): Promise<void> {
      st.signedIn = await api.accountSignedIn().catch(() => false);
      st.visible = st.signedIn || tester() || (await api.accountsOpen());
      if (st.signedIn) void load(); // équipes à jour dès le démarrage (sons et playlists partagés)
    },

    /** Mode testeur (5 clics sur la version dans À propos) : la section Compte apparaît même si les comptes sont fermés. */
    async toggleTester(): Promise<boolean> {
      const on = !tester();
      try { if (on) localStorage.setItem(TESTER, "1"); else localStorage.removeItem(TESTER); } catch { /* sans stockage */ }
      st.visible = st.signedIn || on || (await api.accountsOpen());
      host.render();
      return on;
    },

    /** La section Compte est-elle montrée ? (Onde Équipe n'est pas encore ouvert à tous) */
    visible(): boolean {
      return st.visible;
    },

    /** À l'ouverture des Réglages : données à jour. */
    refresh(): void {
      if (st.signedIn && !st.loading) void load();
    },

    section(): string {
      if (!st.visible) return "";
      return `<section id="r-compte" aria-labelledby="h-compte">
        <h2 id="h-compte" class="eyebrow">${t("Compte et équipe")}</h2>
        <div class="ac">
          ${st.signedIn ? signedInView() : signedOutView()}
          ${st.error ? `<p class="fb-err ac-err" role="alert">${esc(st.error)}</p>` : ""}
        </div>
      </section>`;
    },

    async action(act: string, el: HTMLElement): Promise<void> {
      const data = (k: string) => el.closest<HTMLElement>(`[data-${k}]`)?.getAttribute(`data-${k}`) ?? "";
      switch (act) {
        case "ac-send": return sendCode();
        case "ac-resend": return sendCode();
        case "ac-change": st.step = "email"; st.code = ""; st.error = ""; host.render(); document.getElementById("ac-email")?.focus(); return;
        case "ac-signin": return signIn();
        case "ac-signout": return run("signout", async () => {
          await api.accountApi("POST", "compte/deconnexion").catch(() => {}); // même hors ligne, la session locale est oubliée
          signOutLocally();
          host.toast(t("Vous êtes déconnecté."));
        });
        case "ac-save-name": return run("name", async () => {
          const r = await api.accountApi("POST", "compte/moi", { name: st.name.trim() });
          st.account = { ...st.account!, name: r.account.name };
          host.toast(t("Nom enregistré."));
          await load();
        });
        case "ac-accept": return run("accept", async () => {
          const r = await api.accountApi("POST", `compte/invitations/${data("invite")}/accepter`);
          host.toast(t("Bienvenue dans l'équipe {team} !", { team: r.team.name }));
          await load();
        });
        case "ac-decline": return run("decline", async () => {
          await api.accountApi("POST", `compte/invitations/${data("invite")}/refuser`);
          await load();
        });
        case "ac-invite": {
          const team = data("team");
          const email = (st.invite[team] ?? "").trim();
          if (!email) { document.getElementById(`ac-invite-${team}`)?.focus(); return; }
          return run(`invite-${team}`, async () => {
            const r = await api.accountApi("POST", `equipe/${team}/invitations`, { email });
            st.invite[team] = "";
            host.toast(r.emailSent ? t("Invitation envoyée à {email}.", { email }) : t("Invitation créée. L'e-mail n'a pas pu partir : prévenez {email} de se connecter à Onde avec cette adresse.", { email }));
            await load();
          });
        }
        case "ac-cancel": return run("cancel", async () => {
          await api.accountApi("DELETE", `equipe/${data("team")}/invitations/${data("invite")}`);
          await load();
        });
        case "ac-remove": return run("remove", async () => {
          await api.accountApi("DELETE", `equipe/${data("team")}/membres/${data("member")}`);
          await load();
        });
        case "ac-role": return run("role", async () => {
          await api.accountApi("POST", `equipe/${data("team")}/membres/${data("member")}`, { role: data("role") });
          await load();
        });
        case "ac-leave": return run("leave", async () => {
          await api.accountApi("DELETE", `equipe/${data("team")}/membres/${st.account!.id}`);
          host.toast(t("Vous avez quitté l'équipe."));
          await load();
        });
        case "ac-contact": {
          const subject = encodeURIComponent(t("Onde Équipe pour notre studio"));
          try { await api.openUrl(`mailto:${CONTACT}?subject=${subject}`); } catch { host.toast(t("Écrivez-nous à {mail}", { mail: CONTACT })); }
          return;
        }
        case "ac-delete": st.confirmDelete = true; host.render(); return;
        case "ac-delete-no": st.confirmDelete = false; host.render(); return;
        case "ac-delete-yes": return run("delete", async () => {
          await api.accountApi("POST", "compte/supprimer");
          signOutLocally();
          host.toast(t("Compte supprimé."));
        });
      }
    },

    /** Champs de saisie : mise à jour sans re-rendu (le curseur reste en place). */
    input(el: HTMLInputElement): void {
      if (el.id === "ac-email") st.email = el.value;
      else if (el.id === "ac-code") {
        st.code = el.value.replace(/\D/g, "").slice(0, 6);
        if (st.code.length === 6 && !st.busy) void signIn(); // connexion dès le 6e chiffre
      } else if (el.id === "ac-name") {
        st.name = el.value;
        const save = document.querySelector<HTMLButtonElement>('[data-act="ac-save-name"]');
        if (save) save.disabled = st.name.trim() === (st.account?.name ?? "");
      } else if (el.id.startsWith("ac-invite-")) st.invite[el.dataset.team!] = el.value;
    },

    /** Touche Entrée dans un champ de la section. */
    enter(id: string): void {
      if (id === "ac-email") void sendCode();
      else if (id === "ac-code") void signIn();
      else if (id === "ac-name") void this.action("ac-save-name", document.body);
      else if (id.startsWith("ac-invite-")) {
        const btn = document.querySelector<HTMLElement>(`[data-act="ac-invite"][data-team="${id.slice("ac-invite-".length)}"]`);
        if (btn) void this.action("ac-invite", btn);
      }
    },
  };
}

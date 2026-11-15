// « Nouveautés » : les notes de la version (CHANGELOG.md), montrées une fois après une mise à jour.
import changelogRaw from "../CHANGELOG.md?raw";

// Sur Windows, le fichier peut avoir des fins de ligne \r\n : on les ramène à \n
const changelog = changelogRaw.replace(/\r\n?/g, "\n");

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

/** Notes d'une version en HTML (titres ###, listes, gras), ou null si absentes. */
export function notesHtml(version: string): string | null {
  const head = `\n## ${version}\n`;
  const start = changelog.indexOf(head);
  if (start < 0) return null;
  const rest = changelog.slice(start + head.length);
  const end = rest.search(/\n## \d/);
  const lines = (end < 0 ? rest : rest.slice(0, end)).trim().split("\n");
  let html = "", inList = false;
  const close = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    if (line.startsWith("### ")) { close(); html += `<h3>${inline(line.slice(4))}</h3>`; continue; }
    if (line.startsWith("- ")) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    close();
    html += `<p class="lead">${inline(line)}</p>`;
  }
  close();
  return html;
}

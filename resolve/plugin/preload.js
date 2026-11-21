// Pont entre l'interface du panneau et le processus principal (main.js).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("onde", {
  sep: process.platform === "win32" ? "\\" : "/",
  libraryDir: () => ipcRenderer.invoke("onde:libraryDir"),
  getJson: (url) => ipcRenderer.invoke("onde:getJson", url),
  download: (url, dest) => ipcRenderer.invoke("onde:download", url, dest),
  insert: (file, durationSec) => ipcRenderer.invoke("onde:insert", file, durationSec),
  markUsed: (file) => ipcRenderer.invoke("onde:markUsed", file),
  teamContent: () => ipcRenderer.invoke("onde:teamContent"),
  startDrag: (file) => ipcRenderer.send("onde:drag", file),
});

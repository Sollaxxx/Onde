import { defineConfig } from "vite";

// En développement, les sons de test (src-tauri/resources) sont servis par Vite :
// l'interface peut ainsi être testée dans un simple navigateur, sans Tauri.
// À la compilation, on ne les copie pas : Tauri les embarque déjà comme ressources.
export default defineConfig(({ command }) => ({
  clearScreen: false,
  publicDir: command === "serve" ? "src-tauri/resources" : false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
}));

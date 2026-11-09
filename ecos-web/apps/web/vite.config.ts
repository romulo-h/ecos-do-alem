import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { exclude: ["@ecos/shared"] },
  // *.stackdump: o Git Bash grava esse arquivo quando trava, e o observador do Vite cai com ele bloqueado
  server: { port: 5174, watch: { ignored: ["**/*.stackdump"] } },
});

// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "./",
  build: mode === "demo" ? { outDir: "demo-dist" } : {
    copyPublicDir: false,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "spike-viewer", cssFileName: "style" },
    rollupOptions: {
      external: id => /^(react|react-dom|three)(\/|$)/.test(id),
    },
  },
}));

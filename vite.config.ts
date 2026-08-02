import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Split the two big, rarely-changing renderers out of the app chunk
        // (MVP 6, NF2 bundle hardening). The total shipped bytes are the same
        // — the win is caching: an app-code change no longer invalidates ~1.3
        // MB of Three and MapLibre, and the browser fetches the three chunks
        // in parallel. The gzip total was already well inside NF2's 5 MB
        // budget, so this is about load behaviour, not budget headroom.
        advancedChunks: {
          groups: [
            { name: "three", test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: "maplibre", test: /[\\/]node_modules[\\/]maplibre-gl[\\/]/ },
          ],
        },
      },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    rolldownOptions: {
      input: { main: "index.html", "cam-import": "cam-import.html" },
    },
  },
  plugins: [
    react(),
    {
      name: "offline-csp",
      apply: "build",
      transformIndexHtml: () => [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content:
              "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'",
          },
          injectTo: "head",
        },
      ],
    },
  ],
});

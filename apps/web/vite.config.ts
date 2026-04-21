import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: webRoot,
  base: "./",
  cacheDir: "../../node_modules/.vite/apps/web",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "../../dist/apps/web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("react-markdown") || id.includes("remark-") || id.includes("rehype-")) {
            return "markdown-preview";
          }

          if (id.includes("pdfjs-dist") || id.includes("react-pdf")) {
            return "pdf-preview";
          }

          return undefined;
        }
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "pwa-192.svg", "pwa-512.svg"],
      manifest: {
        name: "VS Text",
        short_name: "vstext",
        description: "A web and desktop text editor with synced workspace manifests.",
        theme_color: "#0f172a",
        background_color: "#f4efe6",
        display: "standalone",
        start_url: ".",
        icons: [
          {
            src: "pwa-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "pwa-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any"
          }
        ]
      }
    })
  ],
  test: {
    environment: "jsdom",
    setupFiles: fileURLToPath(new URL("./src/test/setup.ts", import.meta.url))
  }
});

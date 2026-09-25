import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
  environments: {
    client: { build: { rollupOptions: { input: { main: "index.html", admin: "admin.html" } } } },
  },
});

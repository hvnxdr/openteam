import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/v1": {
        target: process.env["OPENTEAM_PROXY_TARGET"] ?? "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});

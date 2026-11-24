import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    // Preserve source type entry points for checks before the first build.
    exports: false,
  },
});

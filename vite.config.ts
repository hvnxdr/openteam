import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    options: { typeAware: true, typeCheck: true },
    overrides: [{ files: ["apps/web/**"], plugins: ["react"] }],
  },
  run: {
    cache: true,
  },
});

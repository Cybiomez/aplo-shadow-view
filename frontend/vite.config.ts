import { defineConfig } from "vite";

// База './' — чтобы собранные пути были относительными: pywebview грузит
// index.html с файловой системы (file://), абсолютные пути там не работают.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
});

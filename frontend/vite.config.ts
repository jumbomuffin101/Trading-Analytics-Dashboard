import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/ssmif-quant-dev/",   // must match the REPO name with leading+trailing slashes
  build: { outDir: "dist" }
});

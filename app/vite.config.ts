import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works on GitHub Pages (/sivareddy/),
  // Vercel, or any static host.
  base: "./",
});

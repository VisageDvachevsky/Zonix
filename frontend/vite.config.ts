import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.ZONIX_DEV_PROXY_TARGET || "http://127.0.0.1:8010";
  const apiProxy = {
    target: proxyTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  };

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": apiProxy,
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      proxy: {
        "/api": apiProxy,
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      exclude: ["e2e/**", "playwright.config.ts"],
    },
  };
});

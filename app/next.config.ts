import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "NeteaseCloudMusicApi"],
  turbopack: {
    root: configDir,
  },
};

export default nextConfig;

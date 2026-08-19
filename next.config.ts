import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Lean, self-contained build output for Docker deployment (see Dockerfile).
  output: "standalone",
  turbopack: {
    // Pin the workspace root to this project so a stray lockfile above it
    // (e.g. a parent folder on a dev machine) never gets misdetected as root.
    root: path.resolve(__dirname),
  },
  serverExternalPackages: ["better-sqlite3"],
  // The dynamic fs.existsSync/mkdirSync calls in platform-db.ts (resolving DATA_DIR
  // at runtime) make Next's file tracer conservatively pull in the whole ./data
  // directory — which is exactly where live shop databases live. Never ship that.
  outputFileTracingExcludes: {
    "*": ["./data/**"],
  },
};

export default nextConfig;

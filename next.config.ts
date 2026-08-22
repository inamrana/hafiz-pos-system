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
  serverExternalPackages: ["@libsql/client", "libsql"],
  // The dynamic fs.existsSync/mkdirSync calls in db.ts (resolving DATA_DIR at
  // runtime, used only for the local-file fallback) make Next's file tracer
  // conservatively pull in the whole ./data directory — which is exactly where
  // the local dev database lives. Never ship that.
  outputFileTracingExcludes: {
    "*": ["./data/**"],
  },
};

export default nextConfig;

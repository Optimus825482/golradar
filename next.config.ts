import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  compiler: {
    styledJsx: false,
  },
  allowedDevOrigins: [".space-z.ai", ".vercel.app", "localhost"],
  // Exclude scripts/mini-services from output tracing (dynamic child_process refs)
  outputFileTracingExcludes: {
    "*": ["scripts/**/*", "mini-services/**/*", "docs/**/*", "data/**/*"],
  },
  // Keep Node built-ins out of client bundles; Turbopack resolves them
  // via import traces so listing them here prevents NFT over-collection.
  serverExternalPackages: ["fs", "fs/promises", "path", "node:fs", "node:fs/promises", "node:path"],
};

export default nextConfig;


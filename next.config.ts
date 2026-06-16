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
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  compiler: {
    styledJsx: false,
  },
  allowedDevOrigins: [
    ".space-z.ai",
    ".vercel.app",
    "localhost",
  ],
};

export default nextConfig;

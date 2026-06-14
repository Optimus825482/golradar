import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
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

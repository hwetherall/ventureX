import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;

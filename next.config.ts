import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 promoted typedRoutes out of `experimental`.
  typedRoutes: true,
  serverExternalPackages: ["pdf-parse", "mammoth"],
  experimental: {
    serverActions: {
      // M4 upload action allows up to 50 MB per file (src/app/ventures/new/actions.ts).
      // Next.js defaults Server Actions to 1 MB, which 413s on real ABB PDFs.
      // 64 MB leaves headroom for the description + a couple of large docs in one POST.
      bodySizeLimit: "64mb",
    },
  },
  // Pin the workspace root to this project so Turbopack doesn't pick up
  // C:\Users\hweth\package-lock.json (a stray lockfile in the user's home).
  turbopack: {
    root: path.resolve("."),
  },
};

export default nextConfig;

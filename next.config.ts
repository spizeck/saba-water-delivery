import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows the local dev server's assets to be requested via 127.0.0.1 in
  // addition to localhost (e.g. from browser preview tooling).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;

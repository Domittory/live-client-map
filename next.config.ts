import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The PDF report reads its embedded Cyrillic font from assets/fonts at
  // runtime (ticket 56). Next traces imports, not fs reads, so the files must
  // be listed explicitly or a standalone build would ship without them.
  outputFileTracingIncludes: {
    "/api/reports/snapshot": ["./assets/fonts/**"],
  },
};

export default nextConfig;

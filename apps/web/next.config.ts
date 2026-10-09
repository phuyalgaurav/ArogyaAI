import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

let buildId = process.env.AROGYA_BUILD_ID || "development";
if (buildId === "development") {
  try {
    buildId = execFileSync("git", ["describe", "--always", "--dirty"], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
  } catch {
    /* Source archives can set AROGYA_BUILD_ID. */
  }
}

const nextConfig: NextConfig = {
  distDir: process.env.AROGYA_WEB_DIST_DIR || ".next",
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  poweredByHeader: false,
  reactStrictMode: true,
  ...(process.env.AROGYA_WEB_EXPORT === "1"
    ? { output: "export" as const }
    : {
        experimental: {
          proxyClientMaxBodySize: "12mb",
          // The gateway bounds AI turns to 165 seconds; Next defaults to 30.
          proxyTimeout: 180000,
        },
        async rewrites() {
          return [
            {
              source: "/api/v1/:path*",
              destination: `${process.env.AROGYA_API_PROXY_URL || "http://127.0.0.1:8000"}/api/v1/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;

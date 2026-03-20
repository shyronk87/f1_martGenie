import type { NextConfig } from "next";

function isLocalBackendOrigin(value: string) {
  return value.includes("://127.0.0.1") || value.includes("://localhost");
}

const nextConfig: NextConfig = {
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN?.replace(/\/+$/, "");
    const isProductionBuild = process.env.NODE_ENV === "production";

    if (!backendOrigin) {
      throw new Error(
        "Missing BACKEND_ORIGIN. Set it to the deployed backend origin before building the frontend.",
      );
    }
    if (isProductionBuild && isLocalBackendOrigin(backendOrigin)) {
      throw new Error(
        `Invalid BACKEND_ORIGIN for production build: ${backendOrigin}. Do not point deployed frontend builds to localhost or 127.0.0.1.`,
      );
    }

    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

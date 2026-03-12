import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@radix-ui/themes"],
  experimental: { serverActions: { allowedOrigins: ["localhost:3000"] } },
  async rewrites() {
    return [
      {
        // Proxy /api/proxy/* → backend, so the browser never sees the internal URL.
        source:      "/api/proxy/:path*",
        destination: `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/:path*`,
      },
    ];
  },
};

export default nextConfig;

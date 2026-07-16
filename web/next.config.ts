import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project to avoid Next.js inferring a
  // parent directory when multiple lockfiles exist on the machine.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination:
          process.env.LR_API_PROXY ?? "http://127.0.0.1:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;

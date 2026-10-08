import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{source:"/platform/:path*",headers:[{key:"Cache-Control",value:"private, no-store, max-age=0"}]}];
  },
};

export default nextConfig;

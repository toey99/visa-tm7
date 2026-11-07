import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/", destination: "/today", permanent: false }];
  },
  experimental: {
    serverActions: {
      // Default is 1MB, which rejected TM.30 PDF uploads *before* the action ran
      // (surfacing as a misleading "AI service busy" error). 4.5MB is also the
      // Vercel serverless request-body ceiling, so going higher wouldn't help in
      // production — larger PDFs are blocked client-side with a clear message.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;

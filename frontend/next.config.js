/** @type {import('next').NextConfig} */

// Local dev: backend runs on :8000. In the cloud (e.g. Vercel), set BACKEND_URL
// to the deployed FastAPI URL (e.g. https://treasurymind-api.onrender.com).
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@splinetool/react-spline", "@splinetool/runtime"],
  outputFileTracingRoot: path.join(__dirname),
  // Reduce memory during build (avoids OOM "Killed" on low-memory ECS)
  productionBrowserSourceMaps: false,
  experimental: {
    cpus: 1,
    // Allow larger uploads (e.g. agreement template .docx) via proxy; 413 otherwise
    serverActions: { bodySizeLimit: "20mb" },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      // / → /login is handled in middleware for portal.* only; www rewrites to /home
      { source: '/homedemo', destination: '/home', permanent: true },
      { source: '/homedemo/:path*', destination: '/home', permanent: true },
      { source: '/availableunit', destination: '/available-unit', permanent: false },
      { source: '/availableunit/:path*', destination: '/available-unit', permanent: false },
    ]
  },
  /**
   * OAuth popup: default strict COOP can log "would block the window.close call" and break
   * opener↔popup close(). Allow popups to keep a safe opener relationship (postMessage + close).
   * If Nginx overrides headers, set the same COOP on these paths there.
   */
  async headers() {
    const coopAllowPopups = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ];
    return [
      { source: "/auth/callback", headers: coopAllowPopups },
      { source: "/login", headers: coopAllowPopups },
      { source: "/signup", headers: coopAllowPopups },
    ];
  },
}

export default nextConfig

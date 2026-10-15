import type { NextConfig } from "next";

// Sandbox/dev convenience: when no absolute API URL is configured, proxy
// same-origin /api/* requests straight to the FastAPI backend. This makes the
// app work BOTH through the preview gateway (XTransformPort) and when hitting
// the Next dev server on :3000 directly. In Docker, NEXT_PUBLIC_API_URL is
// set and the client calls the API absolutely — no proxy needed.
const BACKEND_PORT = process.env.BACKEND_PORT ?? "8001";

/** Static demo build for GitHub Pages (`bun run build:demo`): the app runs on
 * the in-browser backend (src/lib/demo-backend.ts), so no server is needed —
 * plain `out/` HTML + JS. basePath comes from the Pages project URL. */
const DEMO_EXPORT = process.env.DEMO_EXPORT === "1";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = DEMO_EXPORT
  ? {
      output: "export",
      basePath: BASE_PATH,
      assetPrefix: BASE_PATH,
      images: { unoptimized: true },
      reactStrictMode: false,
      typescript: { ignoreBuildErrors: true },
    }
  : {
      output: "standalone",
      async rewrites() {
        if (process.env.NEXT_PUBLIC_API_URL) {
          console.log("[deckio] NEXT_PUBLIC_API_URL set — API proxy rewrites disabled");
          return [];
        }
        // 127.0.0.1 (not localhost) to avoid IPv6 resolution issues with uvicorn.
        console.log(`[deckio] proxying /api/* → http://127.0.0.1:${BACKEND_PORT}/api/*`);
        return {
          beforeFiles: [
            {
              source: "/api/:path*",
              destination: `http://127.0.0.1:${BACKEND_PORT}/api/:path*`,
            },
          ],
        };
      },
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    };

export default nextConfig;

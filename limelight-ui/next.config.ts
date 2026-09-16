import type { NextConfig } from "next";

/* ONE PORT.
   The portal is the product: making, browsing and editing a show all happen in
   one place, and a person should never have to know that the API and the page
   are served by two different programs. So anything the page asks for that
   isn't a page -- /api/..., /audio/..., /hub/... -- is forwarded to the portal
   behind the scenes, and the browser only ever talks to this one address.

   PORTAL_URL is where the portal actually listens (default :8800). It is used
   only by this server, never by the browser, so moving the portal to another
   port or another machine changes one line here and nothing in the client --
   including inside the container, where `output: "standalone"` ships this
   server and the rewrites travel with it.

   NEXT_PUBLIC_API_URL stays empty on purpose: the client library falls back to
   a relative path, which resolves against whatever address the page was loaded
   from. That is what makes this work in dev, behind a proxy, and in a container
   without three different builds. Set it only to aim the browser at a portal
   that is genuinely somewhere else. */
const PORTAL = process.env.PORTAL_URL || "http://127.0.0.1:8800";

const nextConfig: NextConfig = {
  env: {
    /* empty = same origin as the page. The one place this must NOT be a URL. */
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${PORTAL}/api/:path*` },
      { source: "/audio/:path*", destination: `${PORTAL}/audio/:path*` },
      { source: "/hub/:path*", destination: `${PORTAL}/hub/:path*` },
    ];
  },
  output: "standalone",
};

export default nextConfig;

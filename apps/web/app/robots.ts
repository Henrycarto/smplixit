import type { MetadataRoute } from "next";

import { IS_SHOWCASE, SITE_URL } from "@/lib/site";

/**
 * Two postures, because the same application serves two purposes.
 *
 * The console handles PHI and must never be indexed, so a non-showcase
 * deployment disallows everything. The public showcase has no patient data and
 * exists to be found, but the console routes are still excluded: they are
 * non-functional without the backend, and an indexed page that renders a
 * connection error is worse than one that was never crawled.
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_SHOWCASE) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/case-study"],
        disallow: ["/simplify", "/dashboard", "/login", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

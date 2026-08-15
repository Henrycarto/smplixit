import type { MetadataRoute } from "next";

import { IS_SHOWCASE, SITE_URL } from "@/lib/site";

/** Only the two routes that work without a backend are listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!IS_SHOWCASE) return [];

  return [
    { url: SITE_URL, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/case-study`, changeFrequency: "monthly", priority: 0.8 },
  ];
}

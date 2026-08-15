/**
 * Public deployment configuration.
 *
 * The console and the public showcase are the same application, and which one
 * a visitor gets is a deployment flag rather than a separate build.
 *
 * Showcase mode exists because the Vercel deployment has no backend. The three
 * FastAPI services are not reachable from it, so `/simplify` and `/dashboard`
 * would render service errors to anyone who clicked through. Hiding the entries
 * that lead there is better than showing a visitor a broken screen and letting
 * them decide whether the product or the demo is at fault.
 */

export const IS_SHOWCASE = process.env.NEXT_PUBLIC_SHOWCASE === "1";

/** Absolute origin, needed for link preview metadata to resolve image URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Portfolio this project is linked from.
 *
 * Each project is its own deployment reached by an outbound link, so a visitor
 * arrives here with no browser history back to the portfolio and no way to
 * return except the address bar. This is the way back. Unset means no link is
 * rendered rather than a dead one.
 */
export const PORTFOLIO_URL = process.env.NEXT_PUBLIC_PORTFOLIO_URL ?? "";

export const SITE = {
  name: "Smplixit",
  tagline: "Adaptive health literacy engine",
  description:
    "Rewrites clinical discharge summaries to a measured reading grade, translates them into the patient's language, and proves no medication instruction was lost.",
} as const;

/** Navigation, filtered by what the current deployment can actually serve. */
export function navItems(): Array<{ href: string; label: string }> {
  if (IS_SHOWCASE) {
    return [{ href: "/case-study", label: "Case study" }];
  }
  return [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/simplify", label: "Simplify" },
    { href: "/case-study", label: "Case study" },
  ];
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";

import { IS_SHOWCASE, PORTFOLIO_URL, SITE, SITE_URL, navItems } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE.name,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  // The console handles PHI and must never be indexed. The public showcase
  // has no patient data in it and exists to be found.
  robots: IS_SHOWCASE ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name}, ${SITE.tagline}`,
    description: SITE.description,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name}, ${SITE.tagline}`,
    description: SITE.description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex h-full flex-col overflow-hidden">
        <TopBar />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </body>
    </html>
  );
}

/** Render the portfolio backlink as its hostname, without the www prefix. */
function portfolioLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Portfolio";
  }
}

/**
 * Fixed 48px chrome.
 *
 * Product mark, workspace navigation, and environment. Nothing else lives up
 * here. Every pixel the chrome takes is a pixel the before/after does not get.
 */
function TopBar() {
  const environment = process.env.NEXT_PUBLIC_ENVIRONMENT ?? "local";

  return (
    <header className="flex h-header shrink-0 items-center gap-6 border-b border-shell-border bg-shell px-4">
      <Link href="/" className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-tight text-white">Smplixit</span>
        <span className="text-2xs uppercase tracking-label text-accent">Health literacy engine</span>
      </Link>

      <nav className="flex items-center gap-1">
        {navItems().map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="px-2.5 py-1 text-xs text-slate transition-colors hover:bg-shell-hover hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {IS_SHOWCASE ? null : (
          <span className="border border-shell-border px-1.5 py-0.5 text-2xs uppercase tracking-label text-slate">
            {environment}
          </span>
        )}
        {IS_SHOWCASE ? (
          PORTFOLIO_URL ? (
            <a
              href={PORTFOLIO_URL}
              className="flex items-center gap-1.5 text-xs text-slate transition-colors hover:text-white"
            >
              <span aria-hidden="true">&larr;</span>
              {portfolioLabel(PORTFOLIO_URL)}
            </a>
          ) : null
        ) : (
          <Link href="/login" className="text-xs text-slate transition-colors hover:text-white">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

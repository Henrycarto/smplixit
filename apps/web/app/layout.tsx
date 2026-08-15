import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Smplixit",
  description:
    "Adaptive health literacy engine. Rewrites discharge summaries to a measured reading grade, translates them, and proves no medication instruction was lost.",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/simplify", label: "Simplify" },
];

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
        {NAV.map((item) => (
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
        <span className="border border-shell-border px-1.5 py-0.5 text-2xs uppercase tracking-label text-slate">
          {environment}
        </span>
        <Link
          href="/login"
          className="text-xs text-slate transition-colors hover:text-white"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}

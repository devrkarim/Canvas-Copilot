"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/chat", label: "Chat" },
  { href: "/proposals", label: "Proposals" },
  { href: "/forecast", label: "Forecast" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="app-header">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight whitespace-nowrap">
          <span className="brand-mark" aria-hidden="true">C<span>↗</span></span>
          <span>Canvas Copilot<span className="block text-xs font-normal tracking-normal text-zinc-500 dark:text-zinc-400">A little clarity for your day.</span></span>
        </Link>
        <nav aria-label="Main navigation" className="nav-links flex gap-1 text-sm whitespace-nowrap">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={path === l.href || (l.href === "/" && path.startsWith("/courses/")) ? "page" : undefined}
              className={`px-3 sm:px-4 py-2.5 rounded-md font-medium transition-colors ${
                path === l.href || (l.href === "/" && path.startsWith("/courses/"))
                  ? "bg-teal-700 text-white dark:bg-teal-400 dark:text-zinc-950"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

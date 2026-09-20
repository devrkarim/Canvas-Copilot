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
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4 overflow-x-auto">
        <Link href="/" className="font-semibold tracking-tight whitespace-nowrap">
          📚 Canvas Copilot
        </Link>
        <nav className="flex gap-1 text-sm whitespace-nowrap">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded-md ${
                path === l.href
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
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

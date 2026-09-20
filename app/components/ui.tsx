"use client";
import type { ReactNode } from "react";

export function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="surface-card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Button({
  children, onClick, disabled, variant = "primary", type = "button",
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "ghost" | "danger"; type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-400 dark:text-zinc-950 dark:hover:bg-teal-300",
    ghost: "border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800",
    danger: "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`text-sm font-medium px-4 py-2.5 min-h-11 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles}`}>
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

export function fmt(iso: string | null | undefined, tz?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function Pill({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "red" | "green" | "amber" | "blue" }) {
  const t = {
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  }[tone];
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-sm ${t}`}>{children}</span>;
}

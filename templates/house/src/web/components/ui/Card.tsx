import type { HTMLAttributes } from "react";
import { cn } from "./cn.ts";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-sm", className)} {...rest} />;
}

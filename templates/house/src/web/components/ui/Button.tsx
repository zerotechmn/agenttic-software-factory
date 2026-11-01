import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.ts";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" };

export function Button({ variant = "primary", className, ...rest }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50",
        variant === "primary" && "bg-accent text-accent-fg hover:brightness-110",
        variant === "ghost" && "border border-border bg-transparent hover:bg-surface-2",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
        className,
      )}
      {...rest}
    />
  );
}

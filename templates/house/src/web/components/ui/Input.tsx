import type { InputHTMLAttributes } from "react";
import { cn } from "./cn.ts";

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string };

/** Always labelled (accessible + gives e2e tests a stable getByLabel selector). */
export function Input({ label, id, className, ...rest }: Props) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        id={inputId}
        className={cn("rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-accent", className)}
        {...rest}
      />
    </label>
  );
}

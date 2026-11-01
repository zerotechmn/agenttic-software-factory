import type { ReactNode } from "react";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border p-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

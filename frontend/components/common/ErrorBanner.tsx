import type { ReactNode } from "react";

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded bg-bad-soft px-3 py-2 text-sm text-bad">
      {children}
    </div>
  );
}

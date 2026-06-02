"use client";

import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";

const UNIVERSITY_NAME = "Chhatrapati Shahu Ji Maharaj University, Kanpur";

interface Props {
  /** Optional small label on the right (e.g., "Admin view"). */
  rightLabel?: string;
}

/**
 * Returns true once the component has confirmed it's rendering in an iframe.
 * Defaults to true server-side so the SSR HTML never includes the brand strip —
 * iframe visitors thus never see a flash. Direct (non-iframe) visitors see the
 * strip appear ~50ms after hydration, which is imperceptible.
 */
function useInIframe(): boolean {
  const [inIframe, setInIframe] = useState(true);
  useEffect(() => {
    try {
      setInIframe(window.self !== window.top);
    } catch {
      // Cross-origin iframe access throws SecurityError — definitely in an iframe.
      setInIframe(true);
    }
  }, []);
  return inIframe;
}

export function TopBar({ rightLabel }: Props) {
  const inIframe = useInIframe();
  return (
    <header className="shrink-0 border-b bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/40">
      {/* University brand strip — auto-hidden inside an iframe */}
      {!inIframe && (
        <div className="bg-primary text-primary-foreground">
          <div className="mx-auto max-w-5xl px-4 py-1.5 sm:px-6">
            <p className="truncate text-center text-[11px] font-semibold uppercase tracking-[0.18em] sm:text-xs">
              {UNIVERSITY_NAME}
            </p>
          </div>
        </div>
      )}

      {/* App header */}
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              Vyasa AI Assistant
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              Your guide to PhD admissions
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rightLabel && (
            <span className="hidden sm:inline-flex rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {rightLabel}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary"
            title="Applicable for the 2026–27 academic session"
          >
            Admission 2026–27
          </span>
        </div>
      </div>
    </header>
  );
}

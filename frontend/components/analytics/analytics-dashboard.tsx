"use client";

import * as React from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AdminTokenDialog,
  getStoredToken,
  setStoredToken,
} from "@/components/admin-token-dialog";
import { fetchAllAnalytics, type AnalyticsBundle } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OverviewCards } from "./overview-cards";
import { UsageCharts } from "./usage-charts";
import { TimeHeatmap } from "./time-heatmap";
import { TopicBreakdown } from "./topic-breakdown";
import { RagQuality } from "./rag-quality";
import { PerformancePanel } from "./performance-panel";
import { GapsList } from "./gaps-list";
import { FeedbackPanel } from "./feedback-panel";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

export function AnalyticsDashboard() {
  const [days, setDays] = React.useState(30);
  const [bundle, setBundle] = React.useState<AnalyticsBundle | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [tokenDialog, setTokenDialog] = React.useState(false);

  const load = React.useCallback(async (rangeDays: number) => {
    const token = getStoredToken();
    if (!token) {
      setTokenDialog(true);
      return;
    }
    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const data = await fetchAllAnalytics(token, {
        from: now - rangeDays * 86400,
        to: now,
      });
      setBundle(data);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("401") || msg.includes("503")) {
        toast.error("Admin token rejected — set a valid token.");
        setTokenDialog(true);
      } else {
        toast.error(`Failed to load analytics: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(days);
  }, [load, days]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Anonymous usage insight — no personal data is collected.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border bg-card p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setDays(r.days)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    days === r.days
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(days)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
          </div>
        </div>

        {!bundle && !loading ? (
          <div className="rounded-xl border bg-card px-4 py-14 text-center shadow-sm">
            <KeyRound className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">Admin token required</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Analytics are only visible to the university team.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setTokenDialog(true)}>
              Set token
            </Button>
          </div>
        ) : !bundle ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            Loading analytics…
          </div>
        ) : (
          <>
            <OverviewCards data={bundle.overview} />
            <UsageCharts data={bundle.timeseries} />
            <TimeHeatmap data={bundle.timeseries} />
            <TopicBreakdown data={bundle.topics} />
            <GapsList data={bundle.gaps} />
            <RagQuality data={bundle.rag} />
            <PerformancePanel data={bundle.performance} />
            <FeedbackPanel data={bundle.feedback} />
          </>
        )}
      </div>

      <AdminTokenDialog
        open={tokenDialog}
        onOpenChange={setTokenDialog}
        onSubmit={(v) => {
          setStoredToken(v);
          void load(days);
        }}
      />
    </div>
  );
}

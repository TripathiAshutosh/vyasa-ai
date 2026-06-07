"use client";

import type { AnalyticsGaps } from "@/lib/api";
import { DataTable } from "./data-table";
import { SectionCard } from "./section";

/** Refused / low-confidence questions — content gaps in the source documents. */
export function GapsList({ data }: { data: AnalyticsGaps }) {
  return (
    <SectionCard
      title="Unanswered & low-confidence questions"
      hint={`${data.total} total — candidates for new content`}
    >
      {data.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing here — every question matched the documents well. 🎉
        </p>
      ) : (
        <DataTable
          rows={data.items}
          rowKey={(g) => g.id}
          maxHeightClassName="max-h-72"
          searchPlaceholder="Search questions…"
          columns={[
            {
              key: "question",
              label: "Question",
              className: "max-w-0 truncate",
              title: (g) => g.question,
              searchValue: (g) => `${g.question} ${g.canonical_question ?? ""}`,
              sortValue: (g) => g.question,
              render: (g) => g.question,
            },
            {
              key: "score",
              label: "Score",
              className: "tabular-nums text-muted-foreground",
              sortValue: (g) => g.top_score,
              render: (g) => (g.top_score !== null ? g.top_score.toFixed(2) : "–"),
            },
            {
              key: "status",
              label: "Status",
              sortValue: (g) => g.refused,
              searchValue: (g) => (g.refused ? "refused" : "low confidence"),
              defaultDir: "desc",
              render: (g) =>
                g.refused ? (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                    refused
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                    low confidence
                  </span>
                ),
            },
            {
              key: "when",
              label: "When",
              className: "whitespace-nowrap text-xs text-muted-foreground",
              sortValue: (g) => g.ts,
              defaultDir: "desc",
              render: (g) => new Date(g.ts).toLocaleString(),
            },
          ]}
        />
      )}
    </SectionCard>
  );
}

"use client";

import type { AnalyticsFeedback } from "@/lib/api";
import { DataTable } from "./data-table";
import { SectionCard, pct } from "./section";

export function FeedbackPanel({ data }: { data: AnalyticsFeedback }) {
  return (
    <SectionCard
      title="Answer feedback"
      hint={
        data.satisfaction_rate !== null
          ? `${pct(data.satisfaction_rate)} satisfaction · ${data.up} 👍 / ${data.down} 👎`
          : "no ratings yet"
      }
    >
      {data.negatives.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No 👎-rated answers in this period.
        </p>
      ) : (
        <DataTable
          rows={data.negatives}
          rowKey={(n, i) => `${n.ts}-${i}`}
          maxHeightClassName="max-h-72"
          searchPlaceholder="Search questions…"
          columns={[
            {
              key: "question",
              label: "Question (👎 answer)",
              className: "max-w-0 truncate",
              title: (n) => n.question,
              searchValue: (n) => `${n.question} ${n.comment ?? ""}`,
              sortValue: (n) => n.question,
              render: (n) => (
                <>
                  {n.question}
                  {n.comment && (
                    <>
                      <span
                        className="ml-1 text-xs text-muted-foreground print:hidden"
                        title={n.comment}
                      >
                        💬
                      </span>
                      {/* hover tooltip doesn't exist on paper — print the comment itself */}
                      <span className="ml-1 hidden text-xs italic text-muted-foreground print:inline">
                        — &ldquo;{n.comment}&rdquo;
                      </span>
                    </>
                  )}
                </>
              ),
            },
            {
              key: "topic",
              label: "Topic",
              className: "whitespace-nowrap text-xs text-muted-foreground",
              sortValue: (n) => n.topic,
              searchValue: (n) => n.topic,
              render: (n) => n.topic ?? "–",
            },
            {
              key: "when",
              label: "When",
              className: "whitespace-nowrap text-xs text-muted-foreground",
              sortValue: (n) => n.ts,
              defaultDir: "desc",
              render: (n) => new Date(n.ts).toLocaleString(),
            },
          ]}
        />
      )}
    </SectionCard>
  );
}

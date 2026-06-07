"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /** Value used when sorting by this column; omit to make it unsortable. */
  sortValue?: (row: T) => string | number | null;
  /** Text matched by the search box; omit to exclude from search. */
  searchValue?: (row: T) => string | null | undefined;
  /** Full-text tooltip for truncated cells (sets the td's title attr). */
  title?: (row: T) => string | undefined;
  className?: string;
  align?: "left" | "right";
  /** Direction of the first click on this column's header. */
  defaultDir?: "asc" | "desc";
};

/**
 * Lightweight client-side sortable/searchable table for analytics cards.
 * All data is already loaded, so filtering and sorting happen in memory.
 * The search box is hidden in print; the PDF captures the current view.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  searchPlaceholder = "Search…",
  maxHeightClassName = "max-h-72",
  initialSort,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => React.Key;
  searchPlaceholder?: string;
  maxHeightClassName?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null
  );

  const searchable = columns.some((c) => c.searchValue);

  const visible = React.useMemo(() => {
    let out = rows;
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((row) =>
        columns.some((c) => c.searchValue?.(row)?.toLowerCase().includes(q))
      );
    }
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.sortValue) {
      const mul = sort!.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const va = col.sortValue!(a);
        const vb = col.sortValue!(b);
        if (va == null) return vb == null ? 0 : 1; // nulls last either way
        if (vb == null) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
        return String(va).localeCompare(String(vb)) * mul;
      });
    }
    return out;
  }, [rows, columns, query, sort]);

  const toggleSort = (c: DataTableColumn<T>) =>
    setSort((prev) =>
      prev?.key === c.key
        ? { key: c.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: c.key, dir: c.defaultDir ?? "asc" }
    );

  return (
    <div>
      {searchable && (
        <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
          <div className="relative w-full max-w-56">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border bg-background py-1 pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {query && (
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
              {visible.length} / {rows.length}
            </span>
          )}
        </div>
      )}
      <div className={cn("overflow-y-auto", maxHeightClassName)}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "pb-2 pr-2 font-medium",
                    c.align === "right" && "text-right"
                  )}
                >
                  {c.sortValue ? (
                    <button
                      onClick={() => toggleSort(c)}
                      className={cn(
                        "inline-flex items-center gap-0.5 uppercase tracking-wider transition-colors hover:text-foreground",
                        c.align === "right" && "flex-row-reverse"
                      )}
                    >
                      {c.label}
                      {sort?.key === c.key ? (
                        sort.dir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40 print:hidden" />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-6 text-center text-xs text-muted-foreground"
                >
                  No rows match &ldquo;{query}&rdquo;.
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr key={rowKey(row, i)}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      title={c.title?.(row)}
                      className={cn(
                        "py-1.5 pr-2",
                        c.align === "right" && "text-right",
                        c.className
                      )}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

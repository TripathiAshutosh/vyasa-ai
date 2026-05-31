"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  RefreshCw,
  Trash2,
  GraduationCap,
  Loader2,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderBadge } from "@/components/provider-badge";
import {
  AdminTokenDialog,
  getStoredToken,
  setStoredToken,
} from "@/components/admin-token-dialog";
import {
  deleteDocument,
  fetchDocuments,
  fetchHealth,
  refreshIndex,
  uploadDocument,
  type DocumentEntry,
  type HealthInfo,
} from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

export function DocumentSidebar() {
  const [docs, setDocs] = React.useState<DocumentEntry[]>([]);
  const [health, setHealth] = React.useState<HealthInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [tokenDialog, setTokenDialog] = React.useState(false);
  const pendingAction = React.useRef<null | (() => void)>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(async () => {
    try {
      const [h, d] = await Promise.all([fetchHealth(), fetchDocuments()]);
      setHealth(h);
      setDocs(d.files);
    } catch (e) {
      toast.error(`Backend unreachable: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const withToken = (fn: (token: string) => Promise<void>) => {
    const t = getStoredToken();
    if (!t) {
      pendingAction.current = () => void fn(getStoredToken());
      setTokenDialog(true);
      return;
    }
    void fn(t);
  };

  const onPickFile = () => withToken(() => Promise.resolve(fileRef.current?.click()));

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const token = getStoredToken();
    if (!token) {
      setTokenDialog(true);
      return;
    }
    setBusy("upload");
    toast.promise(
      uploadDocument(file, token).then(async (r) => {
        await refresh();
        return r;
      }),
      {
        loading: `Ingesting ${file.name}…`,
        success: (r) => `Added ${r.chunks_added} chunks from ${r.name}`,
        error: (e) => `Upload failed: ${(e as Error).message}`,
        finally: () => setBusy(null),
      }
    );
  };

  const onRefresh = () =>
    withToken(async (token) => {
      setBusy("refresh");
      toast.promise(
        refreshIndex(token).then(async (r) => {
          await refresh();
          return r;
        }),
        {
          loading: "Re-indexing all documents…",
          success: (r) => `Re-indexed ${Object.keys(r.files).length} file(s), ${r.total_chunks} chunks`,
          error: (e) => `Refresh failed: ${(e as Error).message}`,
          finally: () => setBusy(null),
        }
      );
    });

  const onDelete = (name: string) =>
    withToken(async (token) => {
      setBusy(`del:${name}`);
      toast.promise(
        deleteDocument(name, token).then(async (r) => {
          await refresh();
          return r;
        }),
        {
          loading: `Removing ${name}…`,
          success: (r) => `Removed ${name} (${r.chunks_removed} chunks)`,
          error: (e) => `Delete failed: ${(e as Error).message}`,
          finally: () => setBusy(null),
        }
      );
    });

  return (
    <aside className="flex h-full w-80 flex-col border-r bg-card/40">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">PhD Admission Bot</div>
            <ProviderBadge health={health} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-xs font-medium text-muted-foreground">
          Documents
          {docs.length > 0 && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground/70">
              {docs.length}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRefresh}
            disabled={!!busy}
            title="Re-index all documents"
          >
            {busy === "refresh" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onPickFile}
            disabled={!!busy}
            title="Upload a PDF"
          >
            {busy === "upload" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="px-2 py-4 text-xs text-muted-foreground">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
            No documents indexed yet.
            <br />
            Upload a PDF or click <RefreshCw className="inline h-3 w-3" /> to ingest the
            data folder.
          </div>
        ) : (
          <ul className="space-y-1">
            {docs.map((d) => (
              <li
                key={d.name}
                className={cn(
                  "group flex items-center gap-2 rounded-md border bg-background px-2 py-2",
                  d.missing && "border-destructive/30"
                )}
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium" title={d.name}>
                    {d.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatBytes(d.size_bytes)} · {d.chunks} chunks
                    {d.missing ? " · file missing" : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100"
                  onClick={() => onDelete(d.name)}
                  disabled={busy === `del:${d.name}`}
                  title="Remove"
                >
                  {busy === `del:${d.name}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t px-3 py-3">
        <button
          onClick={() => setTokenDialog(true)}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <KeyRound className="h-3 w-3" />
          {getStoredToken() ? "Update admin token" : "Set admin token"}
        </button>
      </div>

      <AdminTokenDialog
        open={tokenDialog}
        onOpenChange={setTokenDialog}
        onSubmit={(v) => {
          setStoredToken(v);
          const next = pendingAction.current;
          pendingAction.current = null;
          if (next) next();
        }}
      />
    </aside>
  );
}

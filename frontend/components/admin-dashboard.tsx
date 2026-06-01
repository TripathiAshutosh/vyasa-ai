"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  RefreshCw,
  Trash2,
  Loader2,
  KeyRound,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AdminTokenDialog,
  getStoredToken,
  setStoredToken,
} from "@/components/admin-token-dialog";
import {
  deleteDocument,
  fetchDocuments,
  refreshIndex,
  uploadDocument,
  type DocumentEntry,
} from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

export function AdminDashboard() {
  const [docs, setDocs] = React.useState<DocumentEntry[]>([]);
  const [totalChunks, setTotalChunks] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [tokenDialog, setTokenDialog] = React.useState(false);
  const [hasToken, setHasToken] = React.useState(false);
  const pendingAction = React.useRef<null | (() => void)>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const reload = React.useCallback(async () => {
    try {
      const d = await fetchDocuments();
      setDocs(d.files);
      setTotalChunks(d.total_chunks);
    } catch (e) {
      toast.error(`Backend unreachable: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
    setHasToken(!!getStoredToken());
  }, [reload]);

  const withToken = (fn: (token: string) => void | Promise<void>) => {
    const t = getStoredToken();
    if (!t) {
      pendingAction.current = () => void fn(getStoredToken());
      setTokenDialog(true);
      return;
    }
    void fn(t);
  };

  const onPickFiles = () =>
    withToken(() => {
      fileRef.current?.click();
    });

  const onFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = "";
    const token = getStoredToken();
    if (!token) {
      setTokenDialog(true);
      return;
    }
    void uploadFiles(files, token);
  };

  const uploadFiles = async (files: File[], token: string) => {
    setBusy("upload");
    let succeeded = 0;
    let totalAdded = 0;
    const failures: string[] = [];

    for (const file of files) {
      const id = toast.loading(`Uploading ${file.name}…`);
      try {
        const r = await uploadDocument(file, token);
        succeeded += 1;
        totalAdded += r.chunks_added;
        toast.success(`${r.name}: +${r.chunks_added} chunks`, { id });
      } catch (e) {
        failures.push(file.name);
        toast.error(`${file.name} failed: ${(e as Error).message}`, { id });
      }
    }
    await reload();
    setBusy(null);
    if (succeeded > 1) {
      toast.success(
        `Uploaded ${succeeded} file${succeeded === 1 ? "" : "s"} · ${totalAdded} chunks added`
      );
    }
    if (failures.length > 0 && succeeded > 0) {
      toast.warning(`${failures.length} file(s) failed.`);
    }
  };

  const onRefresh = () =>
    withToken(async (token) => {
      setBusy("refresh");
      toast.promise(
        refreshIndex(token).then(async (r) => {
          await reload();
          return r;
        }),
        {
          loading: "Re-indexing all documents…",
          success: (r) =>
            `Re-indexed ${Object.keys(r.files).length} file(s) · ${r.total_chunks} chunks`,
          error: (e) => `Refresh failed: ${(e as Error).message}`,
          finally: () => setBusy(null),
        }
      );
    });

  const onDelete = (name: string) =>
    withToken(async (token) => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Remove "${name}" from the index and disk?\n\nThis cannot be undone.`
        )
      ) {
        return;
      }
      setBusy(`del:${name}`);
      toast.promise(
        deleteDocument(name, token).then(async (r) => {
          await reload();
          return r;
        }),
        {
          loading: `Removing ${name}…`,
          success: (r) => `Removed ${r.name} (${r.chunks_removed} chunks)`,
          error: (e) => `Delete failed: ${(e as Error).message}`,
          finally: () => setBusy(null),
        }
      );
    });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8 sm:py-10">
        {/* Page header */}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              Admin Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage the source documents that power the assistant.
            </p>
          </div>
          <a
            href="/"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Open the public chat view"
          >
            Public view
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Stats + actions */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 text-sm">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span>
              <span className="font-medium">{docs.length}</span>{" "}
              <span className="text-muted-foreground">
                file{docs.length === 1 ? "" : "s"}
              </span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span className="font-medium">{totalChunks}</span>{" "}
              <span className="text-muted-foreground">chunks indexed</span>
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={!!busy}
            >
              {busy === "refresh" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh index
            </Button>
            <Button size="sm" onClick={onPickFiles} disabled={!!busy}>
              {busy === "upload" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Upload PDFs
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={onFilesChange}
          />
        </div>

        {/* Documents */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Source documents
            </h2>
            <span className="text-[11px] text-muted-foreground">
              PDF only
            </span>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : docs.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">No documents yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload one or more PDFs to start answering questions.
              </p>
              <Button size="sm" className="mt-4" onClick={onPickFiles} disabled={!!busy}>
                <Upload className="h-3.5 w-3.5" />
                Upload PDFs
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {docs.map((d) => (
                <li
                  key={d.name}
                  className={cn(
                    "group flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors",
                    d.missing && "bg-destructive/5"
                  )}
                >
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={d.name}>
                      {d.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(d.size_bytes)} · {d.chunks} chunks
                      {d.missing && (
                        <span className="ml-1 text-destructive">
                          · file missing on disk
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(d.name)}
                    disabled={busy === `del:${d.name}`}
                    title="Delete this document"
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

        {/* Settings card */}
        <div className="mt-6 rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="shrink-0">Admin token</span>
              <span className="text-muted-foreground">·</span>
              {hasToken ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 truncate">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  saved in this browser
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-destructive truncate">
                  <XCircle className="h-3.5 w-3.5" />
                  not set
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTokenDialog(true)}
            >
              {hasToken ? "Update" : "Set token"}
            </Button>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Upload, refresh, and delete actions are protected by the admin token
          configured on the server.
        </p>
      </div>

      <AdminTokenDialog
        open={tokenDialog}
        onOpenChange={setTokenDialog}
        onSubmit={(v) => {
          setStoredToken(v);
          setHasToken(!!v);
          const next = pendingAction.current;
          pendingAction.current = null;
          if (next) next();
        }}
      />
    </div>
  );
}

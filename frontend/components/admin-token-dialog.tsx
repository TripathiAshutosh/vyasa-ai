"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "phd_admin_token";

export function getStoredToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setStoredToken(value: string): void {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(STORAGE_KEY, value);
  else localStorage.removeItem(STORAGE_KEY);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (token: string) => void;
}

export function AdminTokenDialog({ open, onOpenChange, onSubmit }: Props) {
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (open) setValue(getStoredToken());
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Admin token</DialogTitle>
          <DialogDescription>
            Required to upload, refresh or delete documents. Set on the server via the
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">ADMIN_TOKEN</code>
            environment variable. Stored in your browser only.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          autoFocus
          placeholder="Admin token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value) {
              setStoredToken(value);
              onSubmit(value);
              onOpenChange(false);
            }
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!value}
            onClick={() => {
              setStoredToken(value);
              onSubmit(value);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

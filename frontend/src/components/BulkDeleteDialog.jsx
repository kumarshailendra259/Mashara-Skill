import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Archive, Trash2 } from "lucide-react";

/**
 * Reusable confirmation dialog for bulk delete / archive.
 * Requires typing "DELETE N" (or "ARCHIVE N") if count > 10.
 *
 * Props:
 *   open, onClose, count, itemLabel ("transactions" | "staff" | …), busy,
 *   onConfirm (async), mode: "delete" | "archive" (default delete),
 *   warning: optional extra warning text.
 */
export default function BulkDeleteDialog({
  open, onClose, count = 0, itemLabel = "items", busy = false,
  onConfirm, mode = "delete", warning,
}) {
  const isArchive = mode === "archive";
  const verb = isArchive ? "ARCHIVE" : "DELETE";
  const needsPhrase = count > 10;
  const requiredPhrase = `${verb} ${count}`;
  const [typed, setTyped] = useState("");
  useEffect(() => { if (!open) setTyped(""); }, [open]);

  const phraseOk = !needsPhrase || typed.trim() === requiredPhrase;
  const Icon = isArchive ? Archive : Trash2;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="rounded-none max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <AlertTriangle size={20} className="text-[var(--danger)]" />
            {isArchive ? "Archive" : "Delete"} {count} {itemLabel}?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="bg-red-50 border-l-2 border-[var(--danger)] p-3 text-[var(--danger)]">
            {isArchive ? (
              <>
                <strong>Soft archive:</strong> these {itemLabel} will be hidden from default views.
                Linked login access will also be disabled. Data is preserved for historical reports.
              </>
            ) : (
              <>
                <strong>This action cannot be undone.</strong> {count} {itemLabel} will be
                permanently removed along with any directly related records.
              </>
            )}
          </div>
          {warning && (
            <div className="text-[var(--muted)] text-xs border-l-2 border-[var(--warning)] pl-2 py-1">
              {warning}
            </div>
          )}
          {needsPhrase && (
            <div>
              <Label className="overline">Type <code className="bg-gray-100 px-1 text-xs">{requiredPhrase}</code> to confirm</Label>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={requiredPhrase}
                className="rounded-none mt-1 font-mono"
                data-testid="bulk-confirm-phrase"
                autoFocus
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-none" disabled={busy} data-testid="bulk-cancel">
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy || !phraseOk || count === 0}
            className={`rounded-none gap-1 ${isArchive ? "brand-btn" : "bg-[var(--danger)] hover:bg-red-700 text-white"}`}
            data-testid="bulk-confirm"
          >
            <Icon size={14} />
            {busy ? "Working…" : (isArchive ? `Archive ${count}` : `Delete ${count}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

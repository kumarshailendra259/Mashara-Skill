import React, { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * SubmitButton — Global submission guard (Phase 32).
 *
 * - Locks the button IMMEDIATELY on first click so a rapid double-click can't
 *   fire the async handler twice, even before React re-renders.
 * - Shows a spinner + optional "loadingLabel" while `onClick` is pending.
 * - `onClick` may be sync or async — button unlocks once its promise resolves
 *   (or on the next tick for sync handlers).
 * - Passes through all other Button props (variant, size, className, disabled, ...).
 *
 * Usage:
 *   <SubmitButton onClick={async () => await api.post(...)}>Submit</SubmitButton>
 *   <SubmitButton onClick={handleSave} loadingLabel="Saving…">Save</SubmitButton>
 */
export function SubmitButton({
  onClick,
  children,
  loadingLabel,
  disabled,
  className,
  ...rest
}) {
  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false); // synchronous latch — beats React re-render lag

  const handle = useCallback(
    async (e) => {
      if (lockRef.current || busy) {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        return;
      }
      lockRef.current = true;
      setBusy(true);
      try {
        const result = onClick && onClick(e);
        if (result && typeof result.then === "function") {
          await result;
        }
      } catch (err) {
        // Re-throw so upstream handlers/error boundaries still see failures,
        // but only after unlocking so the user can retry.
        lockRef.current = false;
        setBusy(false);
        throw err;
      }
      lockRef.current = false;
      setBusy(false);
    },
    [onClick, busy],
  );

  return (
    <Button
      {...rest}
      className={className}
      disabled={disabled || busy}
      onClick={handle}
      data-busy={busy || undefined}
    >
      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" data-testid="submit-btn-spinner" />}
      {busy && loadingLabel ? loadingLabel : children}
    </Button>
  );
}

export default SubmitButton;

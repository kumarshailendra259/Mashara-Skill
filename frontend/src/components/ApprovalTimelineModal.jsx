import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, X, Bell } from "lucide-react";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

const STATE_STYLES = {
  done: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  current: "bg-[var(--brand)] text-white",
  skipped: "bg-gray-200 text-gray-600",
  pending: "bg-gray-100 text-gray-500",
};
const STATE_ICONS = { done: "✓", rejected: "✗", current: "→", skipped: "⟳", pending: "·" };

/**
 * Reusable approval-workflow timeline modal.
 * Props:
 *   - type: "reimbursement" | "leave" | "transaction"
 *   - requestId: string | null  (null = modal closed)
 *   - onClose: () => void
 *   - canAct: bool (if true, shows Approve/Reject inline at current step)
 *   - onAfterAct: () => void (parent reload after approve/reject/nudge)
 */
export default function ApprovalTimelineModal({ type, requestId, onClose, canAct = false, onAfterAct }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actOpen, setActOpen] = useState(null);  // "approve" | "reject" | null
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!requestId) { setData(null); return; }
    setLoading(true);
    try { const r = await api.get(`/approvals/${type}/${requestId}/timeline`); setData(r.data); }
    catch (e) { toast.error(formatError(e)); onClose(); }
    finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [type, requestId]);

  if (!requestId) return null;

  const submitAct = async () => {
    if (remarks.trim().length < 3) { toast.error("Remarks required (min 3 chars)"); return; }
    setBusy(true);
    try {
      await api.post("/approvals/act", { request_type: type, request_id: requestId, action: actOpen, remarks: remarks.trim() });
      toast.success(actOpen === "approve" ? "Approved" : "Rejected");
      setActOpen(null); setRemarks("");
      onAfterAct?.();
      reload();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const nudge = async () => {
    try {
      await api.post(`/approvals/${type}/${requestId}/nudge`);
      toast.success("Approver nudged");
      onAfterAct?.();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <Dialog open={!!requestId} onOpenChange={(o) => { if (!o) { onClose(); setActOpen(null); setRemarks(""); } }}>
      <DialogContent className="rounded-none max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading">Approval Workflow</DialogTitle></DialogHeader>
        {loading || !data ? (
          <div className="overline text-center py-8 text-[var(--muted)]">Loading…</div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-[var(--muted)]">
              Status: <span className="font-bold uppercase">{data.status}</span> · Level {data.current_level} of {data.total_levels}
              {data.amount ? <> · {inr(data.amount)}</> : null}
            </div>

            <ol className="space-y-3">
              {data.timeline.map((s) => (
                <li key={s.level} className="flex items-start gap-3">
                  <div className={`w-8 h-8 flex items-center justify-center font-bold shrink-0 ${STATE_STYLES[s.state] || STATE_STYLES.pending}`}>{STATE_ICONS[s.state] || "·"}</div>
                  <div className="flex-1 text-sm">
                    <div className="font-medium">L{s.level} — {s.label}</div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {s.state === "current" && "Pending with: "}
                      {s.state === "pending" && "Will go to: "}
                      {s.state === "done" && "Approved by: "}
                      {s.state === "rejected" && "Rejected by: "}
                      {s.history.length > 0
                        ? s.history.map((h) => h.by).join(", ")
                        : (s.approver_names.slice(0, 3).join(", ") + (s.approver_names.length > 3 ? ` +${s.approver_names.length - 3}` : ""))}
                    </div>
                    {s.history.map((h, i) => (
                      <div key={i} className="text-[11px] mt-1 bg-gray-50 border border-[var(--border)] p-1.5">
                        <span className="capitalize font-medium">{h.action}</span> · {new Date(h.at).toLocaleString()}
                        {h.remarks && <div className="text-[var(--muted)] mt-0.5 italic">&ldquo;{h.remarks}&rdquo;</div>}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>

            {/* Action footer */}
            {data.status !== "paid" && data.status !== "approved" && data.status !== "rejected" && (
              <div className="pt-3 border-t border-[var(--border)] flex gap-2">
                {canAct && (
                  <>
                    <Button size="sm" onClick={() => setActOpen("approve")} className="brand-btn rounded-none gap-1 flex-1" data-testid="timeline-approve"><Check size={14} /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => setActOpen("reject")} className="rounded-none gap-1 flex-1 text-[var(--danger)] hover:bg-red-50" data-testid="timeline-reject"><X size={14} /> Reject</Button>
                  </>
                )}
                {!canAct && data.current_level > 0 && (
                  <Button size="sm" variant="outline" onClick={nudge} className="rounded-none gap-1 w-full" data-testid="timeline-nudge"><Bell size={14} /> Nudge approver</Button>
                )}
              </div>
            )}

            {/* Remarks dialog (mandatory) */}
            {actOpen && (
              <div className="border border-[var(--brand)] p-3 bg-blue-50 space-y-2">
                <div className="overline text-[var(--brand)]">{actOpen === "approve" ? "Approve" : "Reject"} — Remarks required</div>
                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Enter at least 3 characters…" className="rounded-none" rows={2} data-testid="timeline-remarks" autoFocus />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setActOpen(null); setRemarks(""); }} className="rounded-none flex-1">Cancel</Button>
                  <Button size="sm" onClick={submitAct} disabled={busy || remarks.trim().length < 3} className="brand-btn rounded-none flex-1" data-testid="timeline-submit">{busy ? "Saving…" : "Submit"}</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

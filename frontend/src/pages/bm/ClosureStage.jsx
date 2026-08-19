import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Clock, CheckCircle2, XCircle, CalendarClock, LockKeyhole } from "lucide-react";

/**
 * Stage 5 — Batch Closure & Extension Requests
 * ---------------------------------------------
 * • Auto-Closure: every day at 01:15 IST the scheduler closes batches whose
 *   end_date has passed. Admin can also trigger it via "Run Auto-Close Now".
 * • Extension: center managers request a new end date; only admin approves.
 *   On approval the batch's end_date is updated and locks are cleared.
 */

const STATUS_TONE = {
  pending:  "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
  rejected: "bg-red-100 text-red-800 border-red-300",
};

export default function ClosureStage({ batches, refreshBatches }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canRequest = ["admin", "manager", "senior_manager", "hr", "center_manager"].includes(user?.role);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusF, setStatusF] = useState("pending");
  const [reqOpen, setReqOpen] = useState(false);
  const [reqDraft, setReqDraft] = useState({ batch_id: "", new_end_date: "", reason: "" });
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusF !== "all" ? { status: statusF } : {};
      const r = await api.get("/batch-extension-requests", { params });
      setRequests(r.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [statusF]);
  useEffect(() => { load(); }, [load]);

  const eligibleBatches = useMemo(() => batches.filter((b) => b.end_date && !b.closed), [batches]);
  const closedBatches = useMemo(() => batches.filter((b) => b.closed || b.lifecycle_status === "Closed"), [batches]);

  const activeBatchForReq = useMemo(() => batches.find((b) => b.id === reqDraft.batch_id), [batches, reqDraft.batch_id]);

  const submitRequest = async () => {
    if (!reqDraft.batch_id) return toast.error("Select a batch");
    if (!reqDraft.new_end_date) return toast.error("Pick a new end date");
    if (!reqDraft.reason?.trim() || reqDraft.reason.trim().length < 3) return toast.error("Reason must be at least 3 characters");
    if (activeBatchForReq?.end_date && reqDraft.new_end_date <= activeBatchForReq.end_date) return toast.error(`New end date must be after current end (${activeBatchForReq.end_date})`);
    setBusy(true);
    try {
      await api.post("/batch-extension-requests", reqDraft);
      toast.success("Extension request submitted");
      setReqOpen(false);
      setReqDraft({ batch_id: "", new_end_date: "", reason: "" });
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const approve = async (r) => {
    if (!window.confirm(`Approve extension of "${r.batch_name}" from ${r.current_end_date} to ${r.new_end_date}?`)) return;
    setBusy(true);
    try {
      await api.patch(`/batch-extension-requests/${r.id}/approve`);
      toast.success(`Approved · new end date ${r.new_end_date}`);
      load(); refreshBatches && refreshBatches();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };
  const doReject = async () => {
    if (!rejectReason?.trim()) return toast.error("Rejection reason is required");
    setBusy(true);
    try {
      await api.patch(`/batch-extension-requests/${rejectFor.id}/reject`, { rejection_reason: rejectReason });
      toast.success("Request rejected");
      setRejectFor(null); setRejectReason(""); load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const runAutoClose = async () => {
    if (!window.confirm("Run auto-close for every batch whose end_date is in the past? Batches will be locked.")) return;
    setBusy(true);
    try {
      const r = await api.post("/batches/auto-close/run");
      toast.success(`Auto-close complete · ${r.data.closed_count} batch(es) closed`);
      refreshBatches && refreshBatches();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="bm-closure-stage">
      {/* Header actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="overline text-[10px]">Auto-Closure</div>
          <div className="text-xs text-[var(--muted)]">Runs daily at 01:15 IST · closes any batch whose end date has passed.</div>
        </div>
        {isAdmin && (
          <Button onClick={runAutoClose} disabled={busy} variant="outline" className="rounded-none gap-1 text-xs ml-auto" data-testid="bm-closure-autoclose-btn">
            <CalendarClock size={13} /> Run Auto-Close Now
          </Button>
        )}
        {canRequest && (
          <Button
            onClick={() => setReqOpen(true)}
            disabled={eligibleBatches.length === 0}
            title={eligibleBatches.length === 0 ? "No active batches with an end date to extend" : ""}
            className="brand-btn rounded-none gap-1 text-xs"
            data-testid="bm-closure-request-btn"
          >
            <Clock size={13} /> Request Extension
          </Button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="swiss-card p-2 border-l-4 border-emerald-500"><div className="overline text-[10px]">Active Batches</div><div className="font-heading font-black text-xl text-emerald-700">{batches.filter((b) => !b.closed).length}</div></div>
        <div className="swiss-card p-2 border-l-4 border-gray-400"><div className="overline text-[10px]">Closed Batches</div><div className="font-heading font-black text-xl text-gray-700">{closedBatches.length}</div></div>
        <div className="swiss-card p-2 border-l-4 border-amber-500"><div className="overline text-[10px]">Pending Extensions</div><div className="font-heading font-black text-xl text-amber-700">{requests.filter((r) => r.status === "pending").length}</div></div>
        <div className="swiss-card p-2 border-l-4 border-indigo-500"><div className="overline text-[10px]">Total Requests</div><div className="font-heading font-black text-xl">{requests.length}</div></div>
      </div>

      {/* Requests list */}
      <div className="flex items-end gap-2">
        <div className="w-48">
          <Label className="overline">Filter Status</Label>
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="rounded-none" data-testid="bm-closure-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="swiss-card overflow-x-auto">
        <table className="w-full text-xs min-w-max">
          <thead className="bg-gray-50 border-b border-[var(--border)]">
            <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px]">
              <th>Batch</th><th>Current End</th><th>Requested End</th><th>Reason</th>
              <th>Requested By</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
            {!loading && requests.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-[var(--muted)]">No {statusF !== "all" ? statusF + " " : ""}extension requests.</td></tr>
            )}
            {requests.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)] [&>td]:p-2" data-testid={`bm-closure-req-${r.id}`}>
                <td className="font-mono font-semibold">{r.batch_name}</td>
                <td>{r.current_end_date || "—"}</td>
                <td className="font-bold text-emerald-700">{r.new_end_date}</td>
                <td className="max-w-xs truncate" title={r.reason}>{r.reason}</td>
                <td className="text-[11px]">{r.requested_by_name}<br /><span className="text-[9px] text-[var(--muted)]">{r.requested_at?.slice(0, 10)}</span></td>
                <td><span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border ${STATUS_TONE[r.status] || "bg-gray-100"}`}>{r.status}</span></td>
                <td className="whitespace-nowrap">
                  {r.status === "pending" && isAdmin && (
                    <>
                      <Button size="sm" onClick={() => approve(r)} className="rounded-none h-6 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`bm-closure-approve-${r.id}`}>
                        <CheckCircle2 size={11} /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejectFor(r)} className="rounded-none h-6 text-[10px] gap-1 ml-1 hover:text-red-700" data-testid={`bm-closure-reject-${r.id}`}>
                        <XCircle size={11} /> Reject
                      </Button>
                    </>
                  )}
                  {r.status === "approved" && <span className="text-[10px] text-emerald-700">Approved by {r.approved_by_name}</span>}
                  {r.status === "rejected" && <span className="text-[10px] text-red-700" title={r.rejection_reason}>Rejected</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Closed batches sidebar */}
      <details className="swiss-card p-3">
        <summary className="cursor-pointer font-heading font-black text-sm flex items-center gap-2"><LockKeyhole size={13} /> Closed Batches ({closedBatches.length})</summary>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto text-xs">
          {closedBatches.length === 0 && <div className="text-[var(--muted)]">None yet.</div>}
          {closedBatches.map((b) => (
            <div key={b.id} className="border border-[var(--border)] p-2">
              <div className="font-mono font-semibold">{b.name}</div>
              <div className="text-[10px] text-[var(--muted)]">Ended {b.end_date}{b.auto_closed_at ? " · auto-closed" : ""}</div>
            </div>
          ))}
        </div>
      </details>

      {/* Extension request dialog */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent className="rounded-none max-w-lg" data-testid="bm-closure-req-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Request Batch Extension</DialogTitle>
            <DialogDescription className="text-xs">Only admin can approve. New end date takes effect once approved.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="overline text-[10px]">Batch *</Label>
              <Select value={reqDraft.batch_id || undefined} onValueChange={(v) => setReqDraft({ ...reqDraft, batch_id: v })}>
                <SelectTrigger className="rounded-none" data-testid="bm-closure-req-batch"><SelectValue placeholder="Select an active batch" /></SelectTrigger>
                <SelectContent>
                  {eligibleBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} · ends {b.end_date}</SelectItem>)}
                </SelectContent>
              </Select>
              {activeBatchForReq && (
                <div className="text-[10px] text-[var(--muted)] mt-1">Current end date: <b>{activeBatchForReq.end_date}</b></div>
              )}
            </div>
            <div>
              <Label className="overline text-[10px]">New End Date *</Label>
              <Input type="date" value={reqDraft.new_end_date} min={activeBatchForReq?.end_date} onChange={(e) => setReqDraft({ ...reqDraft, new_end_date: e.target.value })} className="rounded-none" data-testid="bm-closure-req-newend" />
            </div>
            <div>
              <Label className="overline text-[10px]">Reason *</Label>
              <Textarea value={reqDraft.reason} onChange={(e) => setReqDraft({ ...reqDraft, reason: e.target.value })} rows={3} className="rounded-none" placeholder="e.g. Weather delay caused missed training days" data-testid="bm-closure-req-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={submitRequest} disabled={busy} className="brand-btn rounded-none" data-testid="bm-closure-req-submit">{busy ? "Submitting…" : "Submit request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent className="rounded-none max-w-md" data-testid="bm-closure-reject-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Reject Extension Request</DialogTitle>
            <DialogDescription className="text-xs">Reason will be visible to the requester.</DialogDescription>
          </DialogHeader>
          <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} placeholder="Reason for rejection…" className="rounded-none" data-testid="bm-closure-reject-reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)} className="rounded-none">Cancel</Button>
            <Button onClick={doReject} disabled={busy} className="brand-btn rounded-none bg-red-600 hover:bg-red-700" data-testid="bm-closure-reject-confirm">{busy ? "Rejecting…" : "Reject"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

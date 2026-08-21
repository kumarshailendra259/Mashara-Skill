import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft, CheckCircle2, Circle, Clock, FileText, History, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const STAGE_TONES = {
  generated:  { dot: "bg-slate-400",  ring: "ring-slate-200",  chip: "bg-slate-100 text-slate-700 border-slate-300" },
  submitted:  { dot: "bg-blue-500",   ring: "ring-blue-200",   chip: "bg-blue-50 text-blue-700 border-blue-300" },
  approved:   { dot: "bg-indigo-500", ring: "ring-indigo-200", chip: "bg-indigo-50 text-indigo-700 border-indigo-300" },
  processing: { dot: "bg-amber-500",  ring: "ring-amber-200",  chip: "bg-amber-50 text-amber-700 border-amber-300" },
  disbursed:  { dot: "bg-emerald-500", ring: "ring-emerald-200", chip: "bg-emerald-50 text-emerald-700 border-emerald-300" },
};

function fmtDT(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return { date, time, full: `${date} | ${time}` };
  } catch {
    return { date: iso, time: "", full: iso };
  }
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const canWrite = ["admin", "accountant", "hr", "senior_manager", "manager"].includes(user?.role);

  const [inv, setInv] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);

  const [advanceDlgOpen, setAdvanceDlgOpen] = useState(false);
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({
    remarks: "",
    disbursed_amount: "", payment_reference: "", bank_reference: "", payment_remarks: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setInv(data);
      const a = await api.get(`/invoices/${id}/audit`).catch(() => ({ data: [] }));
      setAudit(a.data || []);
    } catch (e) {
      toast.error(formatError(e));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  if (loading || !inv) {
    return <div className="p-6 text-center text-[var(--muted)]" data-testid="inv-loading">Loading invoice…</div>;
  }

  const nextStageCode = (inv.current_stage || 0) + 1;
  const nextStageInfo = inv.timeline?.find((t) => t.code === nextStageCode);

  const openAdvance = () => {
    setAdvanceForm({
      remarks: "",
      disbursed_amount: nextStageCode === 5 ? inv.net_payable : "",
      payment_reference: "", bank_reference: "", payment_remarks: "",
    });
    setAdvanceDlgOpen(true);
  };

  const submitAdvance = async () => {
    setAdvanceBusy(true);
    try {
      const payload = {
        to_stage: nextStageCode,
        remarks: advanceForm.remarks || undefined,
      };
      if (nextStageCode === 5) {
        payload.disbursed_amount = Number(advanceForm.disbursed_amount);
        payload.payment_reference = advanceForm.payment_reference || undefined;
        payload.bank_reference = advanceForm.bank_reference || undefined;
        payload.payment_remarks = advanceForm.payment_remarks || undefined;
      }
      await api.post(`/invoices/${id}/advance`, payload);
      toast.success(`Advanced to ${nextStageInfo?.label}`);
      setAdvanceDlgOpen(false);
      load();
    } catch (e) {
      toast.error(formatError(e));
    }
    setAdvanceBusy(false);
  };

  return (
    <div className="space-y-5" data-testid="invoice-detail-page">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={() => nav("/invoices")} className="text-sm text-[var(--muted)] hover:text-[var(--brand)] flex items-center gap-1 mb-1" data-testid="btn-back">
            <ArrowLeft size={14} /> Back to Invoices
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-heading font-black text-3xl tracking-tight">{inv.invoice_no}</h1>
            <Badge className={`${STAGE_TONES[inv.current_stage_id]?.chip || ""} border`}>
              {inv.current_stage_label || "Not Started"}
            </Badge>
          </div>
          <div className="text-sm text-[var(--muted)] mt-1">
            {inv.invoice_type || "—"} · {inv.milestone_type || "—"} · Generated {fmtDT(inv.generated_date).full}
          </div>
        </div>
        {canWrite && inv.current_stage < 5 && nextStageInfo && (
          <Button onClick={openAdvance} data-testid="btn-advance">
            Advance to: {nextStageInfo.label} <ChevronRight size={14} className="ml-1" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Timeline (main column) */}
        <div className="lg:col-span-2 space-y-5">
          <div className="border border-[var(--border)] bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="overline text-[11px] font-semibold">Invoice Journey</div>
                <h2 className="font-heading font-bold text-lg tracking-tight">Stage Timeline</h2>
              </div>
              {inv.days_pending !== null && inv.days_pending !== undefined && (
                <div className="text-right">
                  <div className="overline text-[10px]">Pending For</div>
                  <div className="font-heading font-black text-lg num text-amber-700">{inv.days_pending} days</div>
                </div>
              )}
            </div>
            <div className="relative">
              {inv.timeline?.map((stg, idx) => {
                const tone = STAGE_TONES[stg.id] || STAGE_TONES.generated;
                const isLast = idx === (inv.timeline.length - 1);
                const dt = stg.timestamp ? fmtDT(stg.timestamp) : null;
                return (
                  <div key={stg.id} className="flex gap-4 pb-6 relative" data-testid={`stage-${stg.id}`}>
                    {/* line */}
                    {!isLast && (
                      <div className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${stg.completed ? "bg-emerald-400" : "bg-slate-200"}`} />
                    )}
                    {/* dot */}
                    <div className={`relative z-10 h-8 w-8 rounded-full flex items-center justify-center ring-4 ${stg.completed ? tone.dot + " " + tone.ring : "bg-white ring-slate-100 border border-slate-300"}`}>
                      {stg.completed
                        ? <CheckCircle2 size={16} className="text-white" />
                        : <Circle size={12} className="text-slate-400" />}
                    </div>
                    <div className="flex-1 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-heading font-bold text-[15px]">
                          Stage {stg.code} — {stg.label}
                        </div>
                        {stg.completed && (
                          <Badge className={`${tone.chip} border font-normal text-[10px]`}>Completed</Badge>
                        )}
                        {!stg.completed && inv.current_stage === stg.code - 1 && (
                          <Badge className="bg-amber-50 text-amber-700 border-amber-200 border font-normal text-[10px]">Pending</Badge>
                        )}
                      </div>
                      {dt ? (
                        <div className="mt-1 text-sm">
                          <span className="text-[var(--ink)] font-medium">{dt.date}</span>
                          <span className="text-[var(--muted)] mx-1.5">|</span>
                          <span className="text-[var(--ink)]">{dt.time}</span>
                        </div>
                      ) : (
                        <div className="mt-1 text-sm text-[var(--muted)]">Not yet reached</div>
                      )}
                      {/* Duration info */}
                      <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-[var(--muted)]">
                        {stg.duration_from_prev_label && (
                          <span><Clock size={10} className="inline mr-1" />From previous stage: <span className="font-medium text-[var(--ink)]">{stg.duration_from_prev_label}</span></span>
                        )}
                        {stg.stayed_label && (
                          <span>Stayed at this stage: <span className="font-medium text-[var(--ink)]">{stg.stayed_label}</span></span>
                        )}
                      </div>
                      {stg.remarks && (
                        <div className="mt-1.5 text-[12px] italic text-[var(--muted)]">&ldquo;{stg.remarks}&rdquo;</div>
                      )}
                      {stg.completed_by_name && (
                        <div className="mt-1 text-[10px] text-[var(--muted)]">By {stg.completed_by_name}</div>
                      )}
                      {/* Special: disbursement details */}
                      {stg.id === "disbursed" && stg.completed && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] p-3 bg-emerald-50 border border-emerald-200">
                          <div><span className="text-[var(--muted)]">Disbursed Amount:</span> <span className="font-semibold num">{inr(inv.disbursed_amount)}</span></div>
                          <div><span className="text-[var(--muted)]">UTR / Reference:</span> <span className="font-mono">{inv.payment_reference || "—"}</span></div>
                          {inv.bank_reference && <div><span className="text-[var(--muted)]">Bank:</span> <span className="font-medium">{inv.bank_reference}</span></div>}
                          {inv.payment_remarks && <div className="col-span-2"><span className="text-[var(--muted)]">Remarks:</span> {inv.payment_remarks}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Audit history */}
          <div className="border border-[var(--border)] bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <History size={16} className="text-[var(--muted)]" />
              <h2 className="font-heading font-bold text-lg tracking-tight">Audit History</h2>
              <span className="text-[11px] text-[var(--muted)]">({audit.length} entries)</span>
            </div>
            {audit.length === 0 ? (
              <div className="text-[var(--muted)] text-sm">No history yet.</div>
            ) : (
              <div className="space-y-2">
                {audit.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 border-l-2 border-slate-200 pl-3 py-1" data-testid={`audit-${a.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px]">
                        <span className="font-semibold uppercase text-[11px] mr-2">{a.action}</span>
                        {a.stage_name && <span>→ {a.stage_name}</span>}
                      </div>
                      {a.remarks && <div className="text-[11px] text-[var(--muted)] italic">&ldquo;{a.remarks}&rdquo;</div>}
                      <div className="text-[10px] text-[var(--muted)]">{a.user_name || "System"} · {fmtDT(a.timestamp).full}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: Financial + Info */}
        <div className="space-y-5">
          <div className="border border-[var(--border)] bg-white p-5">
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider text-[var(--muted)] mb-3">Financial Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-[var(--muted)]">Amount Payable</span><span className="num">{inr(inv.amount_payable)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--muted)]">Adjustment</span><span className="num">{inr(inv.adjustment)}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="text-[var(--muted)]">Gross Payment</span><span className="num font-medium">{inr(inv.gross_payment)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--muted)]">Deduction</span><span className="num text-red-600">- {inr(inv.deduction)}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-semibold">Net Payable</span><span className="num font-heading font-black text-base">{inr(inv.net_payable)}</span></div>
              <div className="flex justify-between mt-3"><span className="text-[var(--muted)]">Disbursed</span><span className="num text-emerald-700 font-medium">{inr(inv.disbursed_amount)}</span></div>
              <div className="flex justify-between border-t pt-2 bg-red-50 -mx-2 px-2 py-2">
                <span className="font-semibold text-red-800">Outstanding</span>
                <span className="num font-heading font-black text-base text-red-700">{inr(inv.outstanding_amount)}</span>
              </div>
            </div>
          </div>

          <div className="border border-[var(--border)] bg-white p-5">
            <h3 className="font-heading font-bold text-sm uppercase tracking-wider text-[var(--muted)] mb-3">Invoice Info</h3>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between gap-2"><span className="text-[var(--muted)]">Invoice Type</span><span className="text-right">{inv.invoice_type || "—"}</span></div>
              <div className="flex justify-between gap-2"><span className="text-[var(--muted)]">Milestone</span><span className="text-right">{inv.milestone_type || "—"}</span></div>
              <div className="flex justify-between gap-2"><span className="text-[var(--muted)]">TSP / Company</span><span className="text-right font-medium">{inv.tsp_company_name || "—"}</span></div>
              <div className="flex justify-between gap-2"><span className="text-[var(--muted)]">District</span><span className="text-right">{inv.district || "—"}</span></div>
              <div className="flex justify-between gap-2"><span className="text-[var(--muted)]">Training Centre</span>
                {inv.center_id
                  ? <button type="button" onClick={() => nav(`/centers`)} className="text-right text-[var(--brand)] hover:underline">{inv.center_name || "—"}</button>
                  : <span className="text-right">{inv.center_name || "—"}</span>}
              </div>
              <div className="flex justify-between gap-2"><span className="text-[var(--muted)]">Project</span>
                {inv.project_id
                  ? <button type="button" onClick={() => nav(`/projects`)} className="text-right text-[var(--brand)] hover:underline">{inv.project_name || "—"}</button>
                  : <span className="text-right">{inv.project_name || "—"}</span>}
              </div>
              <div className="flex justify-between gap-2"><span className="text-[var(--muted)]">Batch No.</span>
                {inv.batch_id
                  ? <button type="button" onClick={() => nav(`/batch-management`)} className="text-right text-[var(--brand)] hover:underline">{inv.batch_no || "—"}</button>
                  : <span className="text-right">{inv.batch_no || "—"}</span>}
              </div>
              <div className="flex justify-between gap-2"><span className="text-[var(--muted)]">Candidates</span><span className="text-right num">{inv.total_candidates}</span></div>
              {inv.remarks && (
                <div className="pt-2 border-t"><div className="overline text-[10px]">Remarks</div><div className="italic text-[12px] mt-1">{inv.remarks}</div></div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Advance dialog */}
      <Dialog open={advanceDlgOpen} onOpenChange={setAdvanceDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Advance to Stage {nextStageCode}: {nextStageInfo?.label}</DialogTitle>
            <DialogDescription>Timestamp will be recorded automatically. Sequence is strictly enforced.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {nextStageCode === 5 && (
              <>
                <div>
                  <Label>Disbursed Amount *</Label>
                  <Input type="number" step="0.01" value={advanceForm.disbursed_amount} onChange={(e) => setAdvanceForm({ ...advanceForm, disbursed_amount: e.target.value })} data-testid="adv-disb-amount" />
                  <div className="text-[10px] text-[var(--muted)] mt-1">Net Payable is {inr(inv.net_payable)}</div>
                </div>
                <div>
                  <Label>Payment Reference / UTR</Label>
                  <Input value={advanceForm.payment_reference} onChange={(e) => setAdvanceForm({ ...advanceForm, payment_reference: e.target.value })} data-testid="adv-utr" />
                </div>
                <div>
                  <Label>Bank Reference</Label>
                  <Input value={advanceForm.bank_reference} onChange={(e) => setAdvanceForm({ ...advanceForm, bank_reference: e.target.value })} data-testid="adv-bank" />
                </div>
                <div>
                  <Label>Payment Remarks</Label>
                  <Textarea rows={2} value={advanceForm.payment_remarks} onChange={(e) => setAdvanceForm({ ...advanceForm, payment_remarks: e.target.value })} data-testid="adv-pay-remarks" />
                </div>
              </>
            )}
            <div>
              <Label>Remarks</Label>
              <Textarea rows={2} value={advanceForm.remarks} onChange={(e) => setAdvanceForm({ ...advanceForm, remarks: e.target.value })} data-testid="adv-remarks" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceDlgOpen(false)}>Cancel</Button>
            <Button onClick={submitAdvance} disabled={advanceBusy} data-testid="btn-submit-advance">
              {advanceBusy ? "Saving…" : "Confirm Advance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

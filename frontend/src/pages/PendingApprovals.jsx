import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Inbox, ArrowLeftRight, Plane, Receipt, Check, X, ExternalLink, RefreshCw, Box, UserCog, AlertCircle, FileSignature, IndianRupee,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

// Unified inbox showing every request awaiting MY action across:
// - Transactions (chain approver OR partner cross-approval eligible)
// - Leave requests
// - Reimbursements
// - Asset purchase requests
// - Employee transfer requests
// - Attendance regularisations

const TYPE_META = {
  transaction:       { icon: ArrowLeftRight, label: "Transaction",       color: "bg-blue-50 text-[var(--brand)]" },
  leave:             { icon: Plane,          label: "Leave",              color: "bg-purple-50 text-purple-700" },
  reimbursement:     { icon: Receipt,        label: "Reimbursement",      color: "bg-orange-50 text-orange-700" },
  asset_purchase:    { icon: Box,            label: "Asset Purchase",     color: "bg-emerald-50 text-emerald-700" },
  employee_transfer: { icon: UserCog,        label: "Employee Transfer",  color: "bg-amber-50 text-amber-700" },
  regularisation:    { icon: AlertCircle,    label: "Regularisation",     color: "bg-rose-50 text-rose-700" },
  quotation:         { icon: FileSignature,  label: "Quotation",          color: "bg-indigo-50 text-indigo-700" },
  payment:           { icon: IndianRupee,    label: "Payment",            color: "bg-teal-50 text-teal-700" },
};
const FALLBACK_META = { icon: Inbox, label: "Approval", color: "bg-gray-100 text-gray-700" };

export default function PendingApprovals() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [acting, setActing] = useState(null);  // { item, action: "approve" | "reject" }
  const [remarks, setRemarks] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/approvals/pending");
      setItems(r.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => filterType === "all" ? items : items.filter((i) => i.request_type === filterType),
    [items, filterType],
  );

  const counts = useMemo(() => {
    const c = { all: items.length, transaction: 0, leave: 0, reimbursement: 0, asset_purchase: 0, employee_transfer: 0, regularisation: 0 };
    items.forEach((i) => { c[i.request_type] = (c[i.request_type] || 0) + 1; });
    return c;
  }, [items]);

  const totalAmount = useMemo(
    () => filtered.reduce((s, i) => s + (Number(i.summary?.amount) || 0), 0),
    [filtered],
  );

  const openAct = (item, action) => {
    setActing({ item, action });
    setRemarks("");
  };

  const confirmAct = async () => {
    if (!acting) return;
    if (!remarks.trim() || remarks.trim().length < 3) {
      toast.error("Remarks required (min 3 chars)");
      return;
    }
    const { item, action } = acting;
    try {
      if (item.request_type === "transaction" && item.via === "partner_cross") {
        if (action === "approve") {
          await api.post(`/transactions/${item.request_id}/partner-approve`, { remarks });
        } else {
          // Partner cross-rejection uses dedicated endpoint with same eligibility check
          await api.post(`/transactions/${item.request_id}/partner-reject`, { remarks });
        }
      } else {
        // Chain-based: transactions / leaves / reimbursements all dispatch through /approvals/act
        await api.post(`/approvals/act`, {
          request_type: item.request_type, request_id: item.request_id,
          action, remarks,
        });
      }
      toast.success(`${action === "approve" ? "Approved" : "Rejected"} successfully`);
      setActing(null);
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const openDetail = (item) => {
    if (item.request_type === "transaction") nav("/transactions");
    else if (item.request_type === "asset_purchase") nav("/assets");
    else if (item.request_type === "employee_transfer") nav("/employee-transfers");
    else if (item.request_type === "regularisation") nav("/pending-approvals");
    else if (item.request_type === "quotation" || item.request_type === "payment") nav("/quotations");
    else nav("/hrms");
  };

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto" data-testid="pending-approvals-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="overline">Inbox</div>
          <h1 className="font-heading font-black tracking-tight text-3xl flex items-center gap-2">
            <Inbox size={28} className="text-[var(--brand)]" />
            Pending Approvals
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            All requests awaiting <span className="font-medium">your</span> action across transactions, leaves and reimbursements.
          </div>
        </div>
        <Button variant="outline" onClick={load} className="rounded-none gap-1" data-testid="btn-refresh-approvals">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 border-b border-[var(--border)] flex-wrap">
        {[
          { key: "all",               label: "All" },
          { key: "transaction",       label: "Transactions" },
          { key: "leave",             label: "Leaves" },
          { key: "reimbursement",     label: "Reimbursements" },
          { key: "asset_purchase",    label: "Assets" },
          { key: "employee_transfer", label: "Transfers" },
          { key: "regularisation",    label: "Regularisations" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setFilterType(t.key)}
            data-testid={`tab-${t.key}`}
            className={`px-4 py-2 text-sm border-b-2 transition-colors -mb-px ${
              filterType === t.key
                ? "border-[var(--brand)] text-[var(--brand)] font-semibold"
                : "border-transparent hover:text-[var(--brand)]"
            }`}
          >
            {t.label}
            {(counts[t.key] || 0) > 0 && (
              <span className="ml-2 bg-[var(--brand)] text-white text-[10px] px-1.5 py-0.5 rounded-none num font-bold">
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="swiss-card p-3"><div className="overline">Total Awaiting</div><div className="num font-bold text-2xl">{filtered.length}</div></div>
        <div className="swiss-card p-3"><div className="overline">Total Amount</div><div className="num font-bold text-xl value-positive">{inr(totalAmount)}</div></div>
        <div className="swiss-card p-3"><div className="overline">Oldest (days)</div><div className="num font-bold text-2xl">{oldestDays(filtered)}</div></div>
        <div className="swiss-card p-3"><div className="overline">Updated</div><div className="text-xs num font-medium pt-2">{new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div></div>
      </div>

      {/* List */}
      {loading ? (
        <div className="swiss-card p-12 text-center overline">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="swiss-card p-12 text-center" data-testid="empty-approvals">
          <Inbox size={48} className="text-[var(--muted)] mx-auto mb-3" />
          <div className="font-heading font-bold text-lg">Inbox Zero! 🎉</div>
          <div className="overline text-sm mt-1">Nothing awaits your action right now.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const meta = TYPE_META[item.request_type] || FALLBACK_META;
            const Icon = meta.icon;
            return (
              <div
                key={`${item.request_type}-${item.request_id}`}
                className="swiss-card p-4 flex items-start gap-4 flex-wrap"
                data-testid={`approval-row-${item.request_id}`}
              >
                <div className={`${meta.color} p-2.5 rounded-none shrink-0`}><Icon size={18} /></div>
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="overline text-xs">{meta.label}</span>
                    {item.via === "partner_cross" && (
                      <span className="bg-[var(--brand)] text-white text-[10px] px-1.5 py-0.5 num font-bold">PARTNER CROSS-APPROVAL</span>
                    )}
                    {item.step_label && <span className="text-xs text-[var(--muted)]">· {item.step_label}</span>}
                  </div>
                  <div className="font-medium mt-1 line-clamp-2">{item.summary?.description || "—"}</div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-[var(--muted)]">
                    {item.summary?.amount != null && <span className="num font-medium text-[var(--foreground)]">{inr(item.summary.amount)}</span>}
                    {item.summary?.date && <span>📅 {item.summary.date}</span>}
                    {item.created_at && <span>⏱ {new Date(item.created_at).toLocaleDateString("en-IN")}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openDetail(item)} className="rounded-none h-8 gap-1" data-testid={`btn-detail-${item.request_id}`}>
                    <ExternalLink size={12} /> View
                  </Button>
                  <Button size="sm" onClick={() => openAct(item, "approve")} className="brand-btn rounded-none h-8 gap-1" data-testid={`btn-approve-${item.request_id}`}>
                    <Check size={12} /> Approve
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openAct(item, "reject")} className="rounded-none h-8 gap-1 hover:text-[var(--danger)] hover:border-[var(--danger)]" data-testid={`btn-reject-${item.request_id}`}>
                    <X size={12} /> Reject
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Act dialog (approve / reject with remarks) */}
      <Dialog open={!!acting} onOpenChange={(v) => !v && setActing(null)}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {acting?.action === "approve" ? "Approve" : "Reject"} {(TYPE_META[acting?.item?.request_type] || FALLBACK_META).label}
            </DialogTitle>
          </DialogHeader>
          {acting && (
            <div className="space-y-3">
              <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-3 text-sm">
                <div className="font-medium">{acting.item.summary?.description || "—"}</div>
                <div className="num text-xs mt-1">
                  {acting.item.summary?.amount != null && <>Amount: <span className="font-bold">{inr(acting.item.summary.amount)}</span> · </>}
                  {acting.item.summary?.date}
                </div>
              </div>

              {/* Payee details — only relevant for payment requests. Approver sees exact
                  bank/UPI target BEFORE signing off so they can cross-verify with the
                  attached cancelled cheque / QR. */}
              {acting.item.request_type === "payment" && (
                <div className="border border-amber-200 bg-amber-50/40 p-3 text-xs space-y-2" data-testid="approval-payee-block">
                  <div className="overline font-bold text-amber-900">Payee Details</div>
                  <div className="grid grid-cols-2 gap-y-1 gap-x-3">
                    <div><span className="text-[var(--muted)]">QRN:</span> <span className="font-mono">{acting.item.summary?.qrn || "—"}</span></div>
                    <div><span className="text-[var(--muted)]">Mode:</span> <span className="uppercase font-medium">{acting.item.summary?.payment_mode || "—"}</span></div>
                    <div className="col-span-2"><span className="text-[var(--muted)]">Vendor:</span> {acting.item.summary?.vendor_name || "—"}</div>
                    {acting.item.summary?.payee_account_no && <>
                      <div className="col-span-2"><span className="text-[var(--muted)]">Account Holder:</span> {acting.item.summary?.payee_account_holder}</div>
                      <div><span className="text-[var(--muted)]">Account No:</span> <span className="font-mono">{acting.item.summary?.payee_account_no}</span></div>
                      <div><span className="text-[var(--muted)]">IFSC:</span> <span className="font-mono">{acting.item.summary?.payee_ifsc}</span></div>
                      <div className="col-span-2"><span className="text-[var(--muted)]">Bank:</span> {acting.item.summary?.payee_bank_name}</div>
                    </>}
                    {acting.item.summary?.payee_upi_id && (
                      <div className="col-span-2"><span className="text-[var(--muted)]">UPI ID:</span> <span className="font-mono">{acting.item.summary?.payee_upi_id}</span></div>
                    )}
                  </div>
                  {(acting.item.summary?.payee_proof_attachments || []).length > 0 && (
                    <div className="border-t border-amber-200 pt-2">
                      <div className="text-[10px] uppercase text-amber-900 font-bold mb-1">Payee Proof (cheque / QR)</div>
                      <div className="flex flex-wrap gap-1">
                        {acting.item.summary.payee_proof_attachments.map((a) => (
                          <a key={a.id} href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[10px] text-amber-900 hover:underline inline-flex items-center gap-1 border border-amber-300 bg-white px-1.5 py-0.5">
                            📎 {a.filename}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {(acting.item.summary?.attachments || []).length > 0 && (
                    <div className="border-t border-amber-200 pt-2">
                      <div className="text-[10px] uppercase text-amber-900 font-bold mb-1">Other attachments</div>
                      <div className="flex flex-wrap gap-1">
                        {acting.item.summary.attachments.map((a) => (
                          <a key={a.id} href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[10px] text-amber-900 hover:underline inline-flex items-center gap-1 border border-amber-200 bg-white px-1.5 py-0.5">
                            📎 {a.filename}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Prior approval history — helps see the remarks / conditions of earlier approvers */}
              {(acting.item.summary?.chain_history || []).filter((h) => h.action !== "auto-skip").length > 0 && (
                <div className="border border-emerald-200 bg-emerald-50/40 p-3 text-xs space-y-1">
                  <div className="overline font-bold text-emerald-900">Previous approvals</div>
                  {acting.item.summary.chain_history.filter((h) => h.action !== "auto-skip").map((h, i) => (
                    <div key={i}>
                      <span className={h.action === "reject" ? "text-red-700" : "text-emerald-700"}>
                        {h.action === "reject" ? "✕" : "✓"} L{h.level} · <strong>{h.by_user_name}</strong>
                      </span>
                      {h.remarks && <span className="text-[var(--muted)]"> — &ldquo;{h.remarks}&rdquo;</span>}
                      <span className="text-[var(--muted)]"> · {(h.at || "").slice(0, 16).replace("T", " ")}</span>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="overline text-xs mb-1">
                  Remarks <span className="text-[var(--danger)]">*</span>
                  <span className="text-[var(--muted)] ml-1 normal-case">(min 3 chars, mandatory — kis shart pe approve/reject kiya)</span>
                </div>
                <Textarea
                  rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)}
                  placeholder={acting.action === "approve" ? "e.g. Verified bank details & invoice — approved" : "e.g. Missing cancelled cheque — please attach and resubmit"}
                  className="rounded-none" data-testid="approval-remarks"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)} className="rounded-none">Cancel</Button>
            <Button
              onClick={confirmAct}
              className={`rounded-none gap-1 ${acting?.action === "approve" ? "brand-btn" : "bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90"}`}
              data-testid="confirm-act"
            >
              {acting?.action === "approve" ? <Check size={14} /> : <X size={14} />}
              Confirm {acting?.action === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function oldestDays(items) {
  if (!items.length) return 0;
  const dates = items.map((i) => new Date(i.created_at || Date.now()).getTime());
  const oldest = Math.min(...dates);
  return Math.floor((Date.now() - oldest) / (1000 * 60 * 60 * 24));
}

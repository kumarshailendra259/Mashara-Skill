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
  Inbox, ArrowLeftRight, Plane, Receipt, Check, X, ExternalLink, RefreshCw, Box, UserCog, AlertCircle, FileSignature, IndianRupee, Undo2, Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

// Unified inbox showing every request awaiting MY action across:
// - Transactions (chain approver OR partner cross-approval eligible)
// - Leave requests
// - Reimbursements
// - Asset purchase requests
// - Employee transfer requests
// - Attendance regularisations
// - Advance requests

const TYPE_META = {
  transaction:       { icon: ArrowLeftRight, label: "Transaction",       color: "bg-blue-50 text-[var(--brand)]" },
  leave:             { icon: Plane,          label: "Leave",              color: "bg-purple-50 text-purple-700" },
  reimbursement:     { icon: Receipt,        label: "Reimbursement",      color: "bg-orange-50 text-orange-700" },
  asset_purchase:    { icon: Box,            label: "Asset Purchase",     color: "bg-emerald-50 text-emerald-700" },
  employee_transfer: { icon: UserCog,        label: "Employee Transfer",  color: "bg-amber-50 text-amber-700" },
  regularisation:    { icon: AlertCircle,    label: "Regularisation",     color: "bg-rose-50 text-rose-700" },
  quotation:         { icon: FileSignature,  label: "Quotation",          color: "bg-indigo-50 text-indigo-700" },
  payment:           { icon: IndianRupee,    label: "Payment",            color: "bg-teal-50 text-teal-700" },
  advance_request:   { icon: Wallet,         label: "Advance",            color: "bg-cyan-50 text-cyan-700" },
};
const FALLBACK_META = { icon: Inbox, label: "Approval", color: "bg-gray-100 text-gray-700" };

export default function PendingApprovals() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [acting, setActing] = useState(null);  // { item, action: "approve" | "reject" | "send_back" }
  const [remarks, setRemarks] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);  // guards double-submit on approvals
  // Payer roster (accountants, admins, cashiers…). Lazily fetched the first
  // time an accountant opens the approve dialog for a payment/reimbursement.
  const [payers, setPayers] = useState([]);
  const [paidByUserId, setPaidByUserId] = useState("");
  // Center + Partner attribution — captured at final approval so the auto-
  // created transaction reflects the correct dashboard dimensions.
  const [centers, setCenters] = useState([]);
  const [partners, setPartners] = useState([]);
  const [txnCenterId, setTxnCenterId] = useState("");
  const [txnPartnerId, setTxnPartnerId] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/approvals/pending");
      setItems(r.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    // Pre-fetch centers/partners/payers so the final-approval dialog opens
    // with dropdowns already populated (no perceived lag when Accountant clicks Approve).
    api.get("/entities/center").then((r) => setCenters(r.data || [])).catch(() => {});
    api.get("/entities/partner").then((r) => setPartners(r.data || [])).catch(() => {});
    api.get("/users/payers").then((r) => setPayers(r.data || [])).catch(() => {});
  }, []);

  const filtered = useMemo(
    () => filterType === "all" ? items : items.filter((i) => i.request_type === filterType),
    [items, filterType],
  );

  const counts = useMemo(() => {
    const c = {
      all: items.length,
      transaction: 0, leave: 0, reimbursement: 0, asset_purchase: 0,
      employee_transfer: 0, regularisation: 0,
      quotation: 0, payment: 0, advance_request: 0,
    };
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
    setPaidByUserId("");
    setTxnCenterId(item?.summary?.center_id || "");
    setTxnPartnerId("");
    // Ask "Paid By" on the FINAL step of a payment, reimbursement, or advance approval.
    // For advance_request the block is optional but the dropdowns still need populated data.
    if (action === "approve" && item.is_final_step && (
      item.request_type === "payment"
      || item.request_type === "reimbursement"
      || item.request_type === "advance_request"
    )) {
      // Lazy fetch — cache once loaded so subsequent dialogs stay snappy.
      if (payers.length === 0) {
        api.get("/users/payers").then((r) => setPayers(r.data || [])).catch(() => {});
      }
      if (centers.length === 0) {
        api.get("/entities/center").then((r) => setCenters(r.data || [])).catch(() => {});
      }
      if (partners.length === 0) {
        api.get("/entities/partner").then((r) => setPartners(r.data || [])).catch(() => {});
      }
    }
  };

  // Payment attribution (Center / Partner / Paid By) is captured at final approval
  // for: payment, reimbursement, and advance_request. For advance_request it's
  // OPTIONAL (release step re-collects if not provided) but showing it in the same
  // dialog lets accounts one-shot the workflow.
  const needsPaidBy = !!(
    acting && acting.action === "approve" && acting.item.is_final_step &&
    (acting.item.request_type === "payment"
     || acting.item.request_type === "reimbursement"
     || acting.item.request_type === "advance_request")
  );
  const paidByOptional = acting?.item?.request_type === "advance_request";

  const confirmAct = async () => {
    if (!acting) return;
    if (confirmBusy) return;  // guard: rapid double-click won't fire twice
    if (!remarks.trim() || remarks.trim().length < 3) {
      toast.error("Remarks required (min 3 chars)");
      return;
    }
    // For advance_request the attribution is OPTIONAL — approver can skip it and
    // let the Release dialog capture it later. For payment/reimbursement it stays mandatory.
    if (needsPaidBy && !paidByUserId && !paidByOptional) {
      toast.error("Please select who is making the payment (Paid By is mandatory)");
      return;
    }
    if (needsPaidBy && !txnCenterId && !paidByOptional) {
      toast.error("Please select the Center for this payment");
      return;
    }
    const { item, action } = acting;
    const payer = payers.find((p) => p.id === paidByUserId);
    setConfirmBusy(true);
    try {
      if (item.request_type === "transaction" && item.via === "partner_cross") {
        if (action === "approve") {
          await api.post(`/transactions/${item.request_id}/partner-approve`, { remarks });
        } else if (action === "reject") {
          // Partner cross-rejection uses dedicated endpoint with same eligibility check
          await api.post(`/transactions/${item.request_id}/partner-reject`, { remarks });
        } else {
          toast.error("Send-back is not supported for partner cross-approval");
          return;
        }
      } else {
        // Chain-based: transactions / leaves / reimbursements / advance requests dispatch through /approvals/act
        await api.post(`/approvals/act`, {
          request_type: item.request_type, request_id: item.request_id,
          action, remarks,
          paid_by_user_id: needsPaidBy ? (paidByUserId || null) : null,
          paid_by_name: needsPaidBy ? (payer?.name || null) : null,
          txn_center_id: needsPaidBy ? (txnCenterId || null) : null,
          txn_partner_id: needsPaidBy ? (txnPartnerId || null) : null,
        });
      }
      const verb = action === "approve" ? "Approved" : (action === "reject" ? "Rejected" : "Sent back");
      toast.success(`${verb} successfully`);
      setActing(null);
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setConfirmBusy(false); }
  };

  const openDetail = (item) => {
    if (item.request_type === "transaction") nav("/transactions");
    else if (item.request_type === "asset_purchase") nav("/assets");
    else if (item.request_type === "employee_transfer") nav("/employee-transfers");
    else if (item.request_type === "regularisation") nav("/pending-approvals");
    else if (item.request_type === "quotation" || item.request_type === "payment") nav("/quotations");
    else if (item.request_type === "advance_request") nav("/advances");
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
          { key: "quotation",         label: "Quotations" },
          { key: "payment",           label: "Payments" },
          { key: "advance_request",   label: "Advances" },
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
                className="swiss-card p-4 flex items-start gap-4 flex-wrap hover:border-[var(--brand)] transition-colors"
                data-testid={`approval-row-${item.request_id}`}
              >
                <div className={`${meta.color} p-2.5 rounded-none shrink-0`}><Icon size={18} /></div>
                <div className="flex-1 min-w-[240px]">
                  {/* Meta strip: type · step */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="overline text-xs">{meta.label}</span>
                    {item.via === "partner_cross" && (
                      <span className="bg-[var(--brand)] text-white text-[10px] px-1.5 py-0.5 num font-bold">PARTNER CROSS-APPROVAL</span>
                    )}
                    {item.step_label && <span className="text-xs text-[var(--muted)]">· {item.step_label}</span>}
                    {item.is_final_step && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold">FINAL STEP</span>
                    )}
                  </div>

                  {/* Requester + Center — the "who/where" line so approver sees the source at a glance */}
                  <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[13px]">
                    {item.requester_name && (
                      <span className="inline-flex items-center gap-1 text-[var(--foreground)]" data-testid={`row-requester-${item.request_id}`}>
                        👤 <b>{item.requester_name}</b>
                      </span>
                    )}
                    {item.center_name_of_request && (
                      <span className="inline-flex items-center gap-1 text-cyan-800 bg-cyan-50 border border-cyan-200 px-1.5 py-0.5 text-[11px] font-medium" data-testid={`row-center-${item.request_id}`}>
                        🏢 {item.center_name_of_request}
                      </span>
                    )}
                  </div>

                  {/* Purpose (short header — e.g. QRN, advance purpose) */}
                  {item.summary?.purpose && (
                    <div className="mt-2 text-[14px] font-bold text-slate-900" data-testid={`row-purpose-${item.request_id}`}>
                      {item.summary.purpose}
                    </div>
                  )}

                  {/* Vendor / Payee chip — visible for payment / quotation / advance rows */}
                  {item.summary?.vendor_name && (
                    <div className="mt-1.5">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-bold text-amber-900 bg-amber-100 border border-amber-300"
                        data-testid={`row-vendor-${item.request_id}`}
                      >
                        🏷 {(item.request_type === "advance_request" ? "Payee: " : "Vendor: ")}{item.summary.vendor_name}
                      </span>
                    </div>
                  )}

                  {/* Full description — no truncation, bold indigo for readability */}
                  {item.summary?.description && item.summary.description !== item.summary.purpose && (
                    <div
                      className="mt-2 text-[14px] font-bold text-indigo-900 bg-indigo-50/60 border-l-4 border-indigo-400 pl-3 py-2 whitespace-pre-wrap break-words leading-relaxed"
                      data-testid={`row-desc-${item.request_id}`}
                    >
                      {item.summary.description}
                    </div>
                  )}

                  {/* Amount + dates — amount in emerald + bold */}
                  <div className="flex items-center gap-4 mt-2 text-xs text-[var(--muted)] flex-wrap">
                    {item.summary?.amount != null && (
                      <span className="num font-black text-[15px] text-emerald-800" data-testid={`row-amount-${item.request_id}`}>
                        {inr(item.summary.amount)}
                      </span>
                    )}
                    {item.summary?.date && <span>📅 <b>{item.summary.date}</b></span>}
                    {item.created_at && <span>⏱ Raised {new Date(item.created_at).toLocaleDateString("en-IN")}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openDetail(item)} className="rounded-none h-8 gap-1" data-testid={`btn-detail-${item.request_id}`}>
                    <ExternalLink size={12} /> View
                  </Button>
                  <Button size="sm" onClick={() => openAct(item, "approve")} className="brand-btn rounded-none h-8 gap-1" data-testid={`btn-approve-${item.request_id}`}>
                    <Check size={12} /> Approve
                  </Button>
                  {(item.request_type === "quotation" || item.request_type === "payment") && (
                    <Button variant="outline" size="sm" onClick={() => openAct(item, "send_back")} className="rounded-none h-8 gap-1 text-amber-800 border-amber-300 hover:bg-amber-50" data-testid={`btn-sendback-${item.request_id}`}>
                      <Undo2 size={12} /> Send Back
                    </Button>
                  )}
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
              {acting?.action === "approve" ? "Approve" : (acting?.action === "reject" ? "Reject" : "Send Back")} {(TYPE_META[acting?.item?.request_type] || FALLBACK_META).label}
            </DialogTitle>
          </DialogHeader>
          {acting && (
            <div className="space-y-3">
              <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-3 text-sm space-y-1.5">
                {/* Requester + center — first line so approver sees source immediately */}
                {(acting.item.requester_name || acting.item.center_name_of_request) && (
                  <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--muted)]">
                    {acting.item.requester_name && (
                      <span>👤 <b className="text-[var(--foreground)]">{acting.item.requester_name}</b></span>
                    )}
                    {acting.item.center_name_of_request && (
                      <span className="inline-block bg-cyan-50 text-cyan-800 border border-cyan-200 px-1.5 py-0.5 text-[11px]">
                        🏢 {acting.item.center_name_of_request}
                      </span>
                    )}
                  </div>
                )}
                {acting.item.summary?.purpose && (
                  <div className="font-bold text-[14px] text-slate-900">{acting.item.summary.purpose}</div>
                )}
                {acting.item.summary?.vendor_name && (
                  <div className="mt-1">
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-bold text-amber-900 bg-amber-100 border border-amber-300">
                      🏷 {(acting.item.request_type === "advance_request" ? "Payee: " : "Vendor: ")}{acting.item.summary.vendor_name}
                    </span>
                  </div>
                )}
                {acting.item.summary?.description && acting.item.summary.description !== acting.item.summary.purpose && (
                  <div className="mt-1.5 text-[14px] font-bold text-indigo-900 bg-indigo-50/70 border-l-4 border-indigo-400 pl-3 py-2 whitespace-pre-wrap break-words leading-relaxed">
                    {acting.item.summary.description}
                  </div>
                )}
                <div className="num text-xs pt-1">
                  {acting.item.summary?.amount != null && <>Amount: <span className="font-black text-emerald-800 text-[14px]">{inr(acting.item.summary.amount)}</span> · </>}
                  {acting.item.summary?.date}
                </div>
              </div>

              {/* Payee details — shown for both PAYMENT and ADVANCE REQUEST so
                  approver sees exact bank/UPI target BEFORE signing off (and can
                  cross-verify with the attached cancelled cheque / QR / passbook). */}
              {(acting.item.request_type === "payment" || acting.item.request_type === "advance_request") && (
                (acting.item.summary?.payee_account_no || acting.item.summary?.payee_upi_id || acting.item.summary?.vendor_name || acting.item.summary?.qrn) && (
                <div className="border border-amber-200 bg-amber-50/40 p-3 text-xs space-y-2" data-testid="approval-payee-block">
                  <div className="overline font-bold text-amber-900">
                    {acting.item.request_type === "advance_request" ? "Payee Details (from Advance Request)" : "Payee Details"}
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 gap-x-3">
                    {acting.item.summary?.qrn && (
                      <div><span className="text-[var(--muted)]">QRN:</span> <span className="font-mono">{acting.item.summary?.qrn}</span></div>
                    )}
                    {acting.item.summary?.payment_mode && (
                      <div><span className="text-[var(--muted)]">Mode:</span> <span className="uppercase font-medium">{acting.item.summary?.payment_mode}</span></div>
                    )}
                    {acting.item.summary?.vendor_name && (
                      <div className="col-span-2"><span className="text-[var(--muted)]">
                        {acting.item.request_type === "advance_request" ? "Employee" : "Vendor"}:
                      </span> {acting.item.summary?.vendor_name}</div>
                    )}
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
                      <div className="text-[10px] uppercase text-amber-900 font-bold mb-1">Payee Proof (cheque / QR / passbook)</div>
                      <div className="flex flex-wrap gap-1">
                        {acting.item.summary.payee_proof_attachments.map((a) => (
                          <a key={a.id} href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[10px] text-amber-900 hover:underline inline-flex items-center gap-1 border border-amber-300 bg-white px-1.5 py-0.5">
                            📎 {a.filename}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Supporting attachments — visible for EVERY request type so the
                  approver can review bills / receipts / photos before deciding.
                  Previously this was tucked inside the payment-only block and
                  reimbursement approvers couldn't see the raiser's uploaded bill. */}
              {(acting.item.summary?.attachments || []).length > 0 && (
                <div className="border border-blue-200 bg-blue-50/30 p-3 text-xs" data-testid="approval-attachments-block">
                  <div className="overline font-bold text-blue-900 mb-1">Attachments ({acting.item.summary.attachments.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {acting.item.summary.attachments.map((a) => (
                      <a key={a.id} href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-900 hover:underline inline-flex items-center gap-1 border border-blue-200 bg-white px-1.5 py-0.5">
                        📎 {a.filename}
                      </a>
                    ))}
                  </div>
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

              {/* Paid By — final step of payment / reimbursement only */}
              {needsPaidBy && (
                <div className="border border-emerald-300 bg-emerald-50/60 p-3 space-y-3" data-testid="paid-by-block">
                  <div className="overline font-bold text-emerald-900">
                    Payment attribution {paidByOptional ? "(optional — can be filled at Release)" : "(mandatory)"}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Center {paidByOptional ? "" : "*"}</div>
                      <select
                        value={txnCenterId}
                        onChange={(e) => setTxnCenterId(e.target.value)}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                        data-testid="txn-center-select"
                      >
                        <option value="">— Select center —</option>
                        {centers.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Partner (optional)</div>
                      <select
                        value={txnPartnerId}
                        onChange={(e) => setTxnPartnerId(e.target.value)}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                        data-testid="txn-partner-select"
                      >
                        <option value="">— Auto-derive from center —</option>
                        {partners.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase text-emerald-900 mb-1">Paid By (who is releasing the money) {paidByOptional ? "" : "*"}</div>
                    <select
                      value={paidByUserId}
                      onChange={(e) => setPaidByUserId(e.target.value)}
                      className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                      data-testid="paid-by-select"
                    >
                      <option value="">— Select payer —</option>
                      {payers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
                      ))}
                    </select>
                  </div>
                  <div className="text-[10px] text-emerald-900/80">
                    {paidByOptional
                      ? "Advance approval hai — abhi Center/Partner/Paid-By skip kar sakte hain, Release step par bhi enter kar sakte hain. Enter karne pe automatically release txn me stamp ho jayega."
                      : "Center, Partner aur Paid By — teenon auto-created transaction pe stamp ho jayenge, jisse Dashboard mein sahi center/partner filter ke saath update dikhega."}
                  </div>
                </div>
              )}

              <div>
                <div className="overline text-xs mb-1">
                  Remarks <span className="text-[var(--danger)]">*</span>
                  <span className="text-[var(--muted)] ml-1 normal-case">
                    {acting.action === "send_back"
                      ? "(min 3 chars — kya change karna hai raiser ko batayein)"
                      : "(min 3 chars, mandatory — kis shart pe approve/reject kiya)"}
                  </span>
                </div>
                <Textarea
                  rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)}
                  placeholder={
                    acting.action === "approve"
                      ? "e.g. Verified bank details & invoice — approved"
                      : (acting.action === "reject"
                          ? "e.g. Missing cancelled cheque — please attach and resubmit"
                          : "e.g. Amount galat hai, invoice se match kariye aur dobara submit karein")
                  }
                  className="rounded-none" data-testid="approval-remarks"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)} className="rounded-none">Cancel</Button>
            <Button
              onClick={confirmAct}
              disabled={confirmBusy}
              className={`rounded-none gap-1 ${
                acting?.action === "approve"
                  ? "brand-btn"
                  : (acting?.action === "reject"
                      ? "bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90"
                      : "bg-amber-600 text-white hover:bg-amber-700")
              } ${confirmBusy ? "opacity-60 cursor-not-allowed" : ""}`}
              data-testid="confirm-act"
            >
              {confirmBusy ? (
                <>⏳ Processing…</>
              ) : (
                <>
                  {acting?.action === "approve" && <Check size={14} />}
                  {acting?.action === "reject" && <X size={14} />}
                  {acting?.action === "send_back" && <Undo2 size={14} />}
                  Confirm {acting?.action === "approve" ? "Approve" : (acting?.action === "reject" ? "Reject" : "Send Back")}
                </>
              )}
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

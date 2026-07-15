import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, FileText, IndianRupee, Trash2, Info, CheckCircle2, XCircle, Clock, Paperclip, Undo2, Pencil } from "lucide-react";

const STATUS_LABEL = {
  pending: { text: "Awaiting Approval", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { text: "Approved · Awaiting Payment", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  payment_pending: { text: "Payment In Progress", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  paid: { text: "Paid · Txn Created", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { text: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" },
  sent_back: { text: "Sent Back · Edits Required", cls: "bg-amber-50 text-amber-800 border-amber-300" },
  payment_sent_back: { text: "Payment Sent Back", cls: "bg-amber-50 text-amber-800 border-amber-300" },
};

/**
 * Quotation → QRN → Payment two-stage procurement workflow.
 * All non-partner roles can raise a quotation for a center they are assigned to.
 * On final approval a per-center QRN is stamped (e.g. PALOJORI-QRN-0042); the
 * initiator can then raise a payment request against that QRN. Final payment
 * approval auto-creates an EXPENSE transaction in that center's ledger.
 */
export default function Quotations() {
  const { user } = useAuth();
  const [quotations, setQuotations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [centers, setCenters] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [openQ, setOpenQ] = useState(false);
  const [openP, setOpenP] = useState(false);
  const [payQuotation, setPayQuotation] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  // Resubmit state — used when the raiser is fixing a sent-back quotation OR
  // sent-back payment. `resubmitMode` differentiates the two so the same dialog
  // reuses the correct field set and endpoint.
  const [resubmitMode, setResubmitMode] = useState(null); // "quotation" | "payment"
  const [editNote, setEditNote] = useState("");

  const isPartner = user?.role === "partner";

  const emptyQ = {
    center_id: "", category: "expense", description: "", vendor_name: "", vendor_id: "",
    estimated_amount: "", expected_delivery_date: "", purpose: "",
    attachments: [],
  };
  const [qForm, setQForm] = useState(emptyQ);
  const [pForm, setPForm] = useState({
    actual_amount: "", payment_mode: "bank", payment_date: new Date().toISOString().slice(0, 10),
    notes: "", txn_type_override: "", attachments: [],
    payee_account_holder: "", payee_account_no: "", payee_ifsc: "", payee_bank_name: "",
    payee_upi_id: "", payee_proof_attachments: [],
  });
  const [uploading, setUploading] = useState(false);

  // Single reusable upload helper — pushes into either qForm.attachments or pForm.attachments.
  // `targetField` lets us route uploads into secondary lists like pForm.payee_proof_attachments.
  const uploadAttachment = async (e, setter, targetField = "attachments") => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setter((s) => ({ ...s, [targetField]: [...(s[targetField] || []), data] }));
      toast.success("File attached");
    } catch (err) { toast.error(formatError(err)); }
    finally { setUploading(false); e.target.value = ""; }
  };
  const removeAttachment = (id, setter, targetField = "attachments") =>
    setter((s) => ({ ...s, [targetField]: (s[targetField] || []).filter((a) => a.id !== id) }));

  const load = async () => {
    try {
      const [q, p, c, v] = await Promise.all([
        api.get("/quotations"),
        api.get("/payments"),
        api.get("/entities/center"),
        api.get("/vendors").catch(() => ({ data: [] })),
      ]);
      setQuotations(q.data || []);
      setPayments(p.data || []);
      setCenters(c.data || []);
      setVendors(v.data || []);
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return quotations;
    return quotations.filter((q) => q.status === statusFilter);
  }, [quotations, statusFilter]);

  const submitQuotation = async () => {
    if (!qForm.center_id || !qForm.description || !qForm.vendor_name || !qForm.estimated_amount) {
      toast.error("Fill center, description, vendor and amount");
      return;
    }
    if (resubmitMode === "quotation" && (!editNote.trim() || editNote.trim().length < 3)) {
      toast.error("Edit note (kya change kiya as per remarks) required — min 3 chars");
      return;
    }
    setBusy(true);
    try {
      if (resubmitMode === "quotation" && qForm._resubmit_id) {
        await api.post(`/quotations/${qForm._resubmit_id}/resubmit`, {
          description: qForm.description,
          vendor_id: qForm.vendor_id || null,
          vendor_name: qForm.vendor_name,
          estimated_amount: parseFloat(qForm.estimated_amount),
          expected_delivery_date: qForm.expected_delivery_date || null,
          purpose: qForm.purpose || null,
          attachments: qForm.attachments || [],
          edit_note: editNote.trim(),
        });
        toast.success("Quotation resubmitted — re-entering approval chain");
      } else {
        await api.post("/quotations", {
          ...qForm,
          estimated_amount: parseFloat(qForm.estimated_amount),
          expected_delivery_date: qForm.expected_delivery_date || null,
          attachments: qForm.attachments || [],
        });
        toast.success("Quotation raised — routing for approval");
      }
      setOpenQ(false);
      setQForm(emptyQ);
      setResubmitMode(null);
      setEditNote("");
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const openPayment = (q) => {
    setPayQuotation(q);
    // Auto-prefill payee details from Vendor master if a linked vendor has bank/UPI on record.
    const v = q.vendor_id ? vendors.find((x) => x.id === q.vendor_id) : null;
    setPForm({
      actual_amount: String(q.estimated_amount || ""),
      payment_mode: v?.bank_account_no ? "bank" : "bank",
      payment_date: new Date().toISOString().slice(0, 10),
      notes: "",
      txn_type_override: "",
      attachments: [],
      payee_account_holder: v?.account_holder_name || v?.name || "",
      payee_account_no: v?.bank_account_no || "",
      payee_ifsc: v?.ifsc || "",
      payee_bank_name: v?.bank_name || "",
      payee_upi_id: "",
      payee_proof_attachments: [],
    });
    setOpenP(true);
  };

  const submitPayment = async () => {
    if (!pForm.actual_amount) { toast.error("Enter actual amount"); return; }
    const mode = (pForm.payment_mode || "").toLowerCase();
    // Client-side guard so users get instant feedback (backend also enforces).
    if (mode === "bank" || mode === "cheque") {
      if (!pForm.payee_account_holder?.trim() || !pForm.payee_account_no?.trim() || !pForm.payee_ifsc?.trim() || !pForm.payee_bank_name?.trim()) {
        toast.error("Bank/Cheque payment ke liye Account Holder, Account No, IFSC aur Bank Name — sabhi mandatory hain");
        return;
      }
      if ((pForm.payee_proof_attachments || []).length === 0) {
        toast.error("Cancelled cheque ya bank passbook attach kariye (proof mandatory hai)");
        return;
      }
    } else if (mode === "upi") {
      if (!pForm.payee_upi_id?.trim()) {
        toast.error("UPI ID enter kariye"); return;
      }
      if ((pForm.payee_proof_attachments || []).length === 0) {
        toast.error("UPI QR screenshot attach kariye (proof mandatory hai)");
        return;
      }
    }
    setBusy(true);
    try {
      if (resubmitMode === "payment" && pForm._resubmit_id) {
        if (!editNote.trim() || editNote.trim().length < 3) {
          toast.error("Edit note required — min 3 chars");
          setBusy(false); return;
        }
        await api.post(`/payments/${pForm._resubmit_id}/resubmit`, {
          actual_amount: parseFloat(pForm.actual_amount),
          payment_mode: pForm.payment_mode || "bank",
          payment_date: pForm.payment_date || null,
          notes: pForm.notes || null,
          txn_type_override: pForm.txn_type_override || null,
          attachments: pForm.attachments || [],
          payee_account_holder: pForm.payee_account_holder || null,
          payee_account_no: pForm.payee_account_no || null,
          payee_ifsc: pForm.payee_ifsc || null,
          payee_bank_name: pForm.payee_bank_name || null,
          payee_upi_id: pForm.payee_upi_id || null,
          payee_proof_attachments: pForm.payee_proof_attachments || [],
          edit_note: editNote.trim(),
        });
        toast.success("Payment resubmitted — re-entering approval chain");
      } else {
        await api.post("/payments", {
          quotation_id: payQuotation.id,
          actual_amount: parseFloat(pForm.actual_amount),
          payment_mode: pForm.payment_mode || "bank",
          payment_date: pForm.payment_date || null,
          notes: pForm.notes || null,
          txn_type_override: pForm.txn_type_override || null,
          attachments: pForm.attachments || [],
          payee_account_holder: pForm.payee_account_holder || null,
          payee_account_no: pForm.payee_account_no || null,
          payee_ifsc: pForm.payee_ifsc || null,
          payee_bank_name: pForm.payee_bank_name || null,
          payee_upi_id: pForm.payee_upi_id || null,
          payee_proof_attachments: pForm.payee_proof_attachments || [],
        });
        toast.success("Payment request raised — routing for approval");
      }
      setOpenP(false);
      setPayQuotation(null);
      setResubmitMode(null);
      setEditNote("");
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const deleteQuotation = async (q) => {
    if (!window.confirm(`Delete quotation "${q.description.slice(0, 40)}"?`)) return;
    try {
      await api.delete(`/quotations/${q.id}`);
      toast.success("Deleted");
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  // ---- Resubmit handlers ----
  // Reuses the New Quotation dialog for editing a sent-back quotation and the
  // Raise Payment dialog for a sent-back payment. `resubmitMode` decides which
  // endpoint the Submit button hits.
  const openResubmitQuotation = (q) => {
    setQForm({
      center_id: q.center_id, category: q.category || "expense",
      description: q.description || "", vendor_name: q.vendor_name || "",
      vendor_id: q.vendor_id || "", estimated_amount: String(q.estimated_amount || ""),
      expected_delivery_date: q.expected_delivery_date || "",
      purpose: q.purpose || "", attachments: q.attachments || [],
      _resubmit_id: q.id,
    });
    setResubmitMode("quotation");
    setEditNote("");
    setOpenQ(true);
  };
  const openResubmitPayment = (q, p) => {
    setPayQuotation(q);
    setPForm({
      actual_amount: String(p.actual_amount || q.estimated_amount || ""),
      payment_mode: p.payment_mode || "bank",
      payment_date: p.payment_date || new Date().toISOString().slice(0, 10),
      notes: p.notes || "",
      txn_type_override: p.txn_type_override || "",
      attachments: p.attachments || [],
      payee_account_holder: p.payee_account_holder || "",
      payee_account_no: p.payee_account_no || "",
      payee_ifsc: p.payee_ifsc || "",
      payee_bank_name: p.payee_bank_name || "",
      payee_upi_id: p.payee_upi_id || "",
      payee_proof_attachments: p.payee_proof_attachments || [],
      _resubmit_id: p.id,
    });
    setResubmitMode("payment");
    setEditNote("");
    setOpenP(true);
  };

  const paymentFor = (qid) => payments.find((p) => p.quotation_id === qid);

  return (
    <div className="space-y-6" data-testid="quotations-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline">HRMS · PROCUREMENT</div>
          <h1 className="font-heading font-bold text-3xl tracking-tight mt-1">Payment Requests</h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
            Raise a vendor quotation → get it approved (QRN stamped) → raise a payment request against the QRN
            → final approval auto-creates the expense transaction in the center.
          </p>
        </div>
        {!isPartner && (
          <Button onClick={() => setOpenQ(true)} className="rounded-none brand-btn" data-testid="quotation-add-btn">
            <Plus size={16} className="mr-2" /> New Quotation
          </Button>
        )}
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="overline">Filter by status:</span>
        {["all", "pending", "sent_back", "approved", "payment_pending", "paid", "rejected"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1 border rounded-none transition ${statusFilter === s ? "bg-[var(--brand)] text-white border-[var(--brand)]" : "border-[var(--border)] hover:bg-gray-50"}`}
            data-testid={`quotation-filter-${s}`}
          >
            {s === "all" ? "All" : STATUS_LABEL[s]?.text || s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="swiss-card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">
            No quotations {statusFilter !== "all" && `with status "${STATUS_LABEL[statusFilter]?.text || statusFilter}"`}.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] overline bg-gray-50">
                <th className="text-left p-3">QRN</th>
                <th className="text-left p-3">Center</th>
                <th className="text-left p-3">Vendor · Description</th>
                <th className="text-left p-3">Category</th>
                <th className="text-right p-3">Est. Amount</th>
                <th className="text-right p-3">Paid Amount</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Raised By</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => {
                const p = paymentFor(q.id);
                const st = STATUS_LABEL[q.status] || { text: q.status, cls: "bg-gray-100 text-gray-600 border-gray-200" };
                const canPay = q.status === "approved" && !q.payment_id && !isPartner;
                const canDelete = user?.role === "admin" || (q.created_by === user?.id && q.status === "pending");
                return (
                  <tr key={q.id} className="border-b border-[var(--border)] last:border-0" data-testid={`quotation-row-${q.id}`}>
                    <td className="p-3 num font-mono text-xs">{q.qrn || <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="p-3">{q.center_name || <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="p-3">
                      <div className="font-medium">{q.vendor_name}</div>
                      <div className="text-xs text-[var(--muted)] max-w-md truncate">{q.description}</div>
                      {q.purpose && <div className="text-[10px] text-[var(--muted)] mt-1">Purpose: {q.purpose}</div>}
                      {q.status === "sent_back" && q.sent_back_reason && (
                        <div className="text-[10px] text-amber-900 bg-amber-50 border border-amber-300 px-2 py-1 mt-1" data-testid={`q-sentback-${q.id}`}>
                          ↩ Sent back by {q.sent_back_by_name || "Approver"}: &ldquo;{q.sent_back_reason}&rdquo;
                        </div>
                      )}
                      {p && p.status === "sent_back" && p.sent_back_reason && (
                        <div className="text-[10px] text-amber-900 bg-amber-50 border border-amber-300 px-2 py-1 mt-1" data-testid={`p-sentback-${p.id}`}>
                          ↩ Payment sent back by {p.sent_back_by_name || "Approver"}: &ldquo;{p.sent_back_reason}&rdquo;
                        </div>
                      )}
                      {(q.attachments || []).length > 0 && (
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {q.attachments.map((a) => (
                            <a key={a.id} href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[10px] text-[var(--brand)] hover:underline inline-flex items-center gap-1 border border-[var(--border)] px-1.5 py-0.5" data-testid={`q-row-attach-${a.id}`}>
                              <Paperclip size={10} /> {a.filename}
                            </a>
                          ))}
                        </div>
                      )}
                      {p && (p.attachments || []).length > 0 && (
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {p.attachments.map((a) => (
                            <a key={a.id} href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[10px] text-emerald-700 hover:underline inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-1.5 py-0.5">
                              <Paperclip size={10} /> pay · {a.filename}
                            </a>
                          ))}
                        </div>
                      )}
                      {/* Payee details preview — auditable inline, no need to open a dialog */}
                      {p && (p.payee_account_no || p.payee_upi_id) && (
                        <div className="text-[10px] text-[var(--muted)] mt-1" data-testid={`q-payee-${q.id}`}>
                          💳 <span className="uppercase font-semibold text-[var(--foreground)]">{p.payment_mode}</span>
                          {p.payee_upi_id && <> · UPI <span className="font-mono">{p.payee_upi_id}</span></>}
                          {p.payee_account_no && <>
                            {" "}· {p.payee_bank_name || "Bank"} · A/c <span className="font-mono">****{String(p.payee_account_no).slice(-4)}</span> · IFSC <span className="font-mono">{p.payee_ifsc}</span>
                          </>}
                        </div>
                      )}
                      {p && p.paid_by_name && (
                        <div className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 mt-1 inline-block" data-testid={`q-paidby-${q.id}`}>
                          ✓ Paid by <strong>{p.paid_by_name}</strong>{p.paid_at && <> · {String(p.paid_at).slice(0, 10)}</>}
                        </div>
                      )}
                      {p && (p.payee_proof_attachments || []).length > 0 && (
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {p.payee_proof_attachments.map((a) => (
                            <a key={a.id} href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[10px] text-amber-800 hover:underline inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-1.5 py-0.5">
                              <Paperclip size={10} /> proof · {a.filename}
                            </a>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-3 capitalize">{q.category}</td>
                    <td className="p-3 num font-medium">{inr(q.estimated_amount)}</td>
                    <td className="p-3 num">{p ? inr(p.actual_amount) : <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 border ${st.cls}`}>{st.text}</span>
                      <div className="text-[10px] text-[var(--muted)] mt-1">Lv {q.current_level ?? "—"}/{(q.chain_snapshot || []).length}</div>
                      {(q.pending_with && q.pending_with.length > 0) && (
                        <div className="text-[10px] mt-1 text-amber-700" data-testid={`q-pending-with-${q.id}`}>
                          ⏳ {q.current_step_label && <strong>{q.current_step_label}</strong>}
                          {q.current_step_label && ": "}
                          {q.pending_with.slice(0, 2).map((u) => u.name).join(", ")}
                          {q.pending_with.length > 2 && ` +${q.pending_with.length - 2}`}
                        </div>
                      )}
                      {/* Approval history: shows who approved / rejected and their remarks so
                          the requester and downstream reviewers can trace the conditions
                          under which each level signed off. */}
                      {(q.chain_history || []).filter((h) => h.action !== "auto-skip").length > 0 && (
                        <div className="mt-2 space-y-1 border-l-2 border-emerald-200 pl-2" data-testid={`q-history-${q.id}`}>
                          {q.chain_history.filter((h) => h.action !== "auto-skip").map((h, i) => {
                            const sym = h.action === "reject" ? "✕" : (h.action === "send_back" ? "↩" : (h.action === "resubmit" ? "↻" : "✓"));
                            const cls = h.action === "reject" ? "text-red-700" : (h.action === "send_back" ? "text-amber-800" : (h.action === "resubmit" ? "text-blue-700" : "text-emerald-700"));
                            return (
                              <div key={i} className="text-[10px]">
                                <span className={cls}>
                                  {sym} {h.action === "resubmit" ? "Resubmit" : `L${h.level}`} · {h.by_user_name || "system"}
                                </span>
                                {h.remarks && <span className="text-[var(--muted)]"> — &ldquo;{h.remarks}&rdquo;</span>}
                                <span className="text-[var(--muted)]"> · {(h.at || "").slice(0, 10)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Payment sub-status */}
                      {p && p.pending_with && p.pending_with.length > 0 && p.status !== "paid" && (
                        <div className="text-[10px] mt-1 text-blue-700">
                          💰 pay · {p.pending_with.slice(0, 2).map((u) => u.name).join(", ")}
                        </div>
                      )}
                      {p && (p.chain_history || []).filter((h) => h.action !== "auto-skip").length > 0 && (
                        <div className="mt-1 space-y-1 border-l-2 border-blue-200 pl-2">
                          {p.chain_history.filter((h) => h.action !== "auto-skip").map((h, i) => {
                            const sym = h.action === "reject" ? "✕" : (h.action === "send_back" ? "↩" : (h.action === "resubmit" ? "↻" : "✓"));
                            const cls = h.action === "reject" ? "text-red-700" : (h.action === "send_back" ? "text-amber-800" : (h.action === "resubmit" ? "text-blue-700" : "text-blue-700"));
                            return (
                              <div key={`p-${i}`} className="text-[10px]">
                                <span className={cls}>
                                  {sym} {h.action === "resubmit" ? "Resubmit" : `pay·L${h.level}`} · {h.by_user_name || "system"}
                                </span>
                                {h.remarks && <span className="text-[var(--muted)]"> — &ldquo;{h.remarks}&rdquo;</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-xs">{q.created_by_name}<div className="text-[10px] text-[var(--muted)]">{(q.created_at || "").slice(0, 10)}</div></td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1">
                        {canPay && (
                          <Button size="sm" variant="outline" className="rounded-none text-xs" onClick={() => openPayment(q)} data-testid={`quotation-pay-${q.id}`}>
                            <IndianRupee size={12} className="mr-1" /> Raise Payment
                          </Button>
                        )}
                        {q.status === "sent_back" && (q.created_by === user?.id || user?.role === "admin") && (
                          <Button size="sm" variant="outline" className="rounded-none text-xs text-amber-800 border-amber-300 hover:bg-amber-50" onClick={() => openResubmitQuotation(q)} data-testid={`quotation-resubmit-${q.id}`}>
                            <Undo2 size={12} className="mr-1" /> Edit &amp; Resubmit
                          </Button>
                        )}
                        {p && p.status === "sent_back" && (p.created_by === user?.id || user?.role === "admin") && (
                          <Button size="sm" variant="outline" className="rounded-none text-xs text-amber-800 border-amber-300 hover:bg-amber-50" onClick={() => openResubmitPayment(q, p)} data-testid={`payment-resubmit-${p.id}`}>
                            <Pencil size={12} className="mr-1" /> Edit Payment &amp; Resubmit
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="outline" className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50" onClick={() => deleteQuotation(q)} data-testid={`quotation-delete-${q.id}`}>
                            <Trash2 size={12} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 p-4 flex items-start gap-3 text-sm">
        <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-blue-900">How this works</div>
          <ul className="text-blue-900/80 text-xs mt-1 space-y-1">
            <li>1. Raise a quotation → routes through the <strong>Quotation approval chain</strong> (HR Settings → Approval Workflows).</li>
            <li>2. Final approval stamps a per-center <strong>QRN</strong> (e.g. <code>PALOJORI-QRN-0042</code>).</li>
            <li>3. You can then raise a Payment request against the QRN with the actual amount (editable).</li>
            <li>4. Payment routes through the <strong>Payment approval chain</strong>; final approval auto-creates an approved <strong>Expense</strong> transaction in the center.</li>
          </ul>
        </div>
      </div>

      {/* New quotation dialog */}
      <Dialog open={openQ} onOpenChange={(o) => { if (!o) { setOpenQ(false); setResubmitMode(null); setEditNote(""); } }}>
        <DialogContent className="rounded-none max-w-2xl" data-testid="quotation-form">
          <DialogHeader>
            <DialogTitle>{resubmitMode === "quotation" ? "Edit & Resubmit Quotation" : "New Quotation Request"}</DialogTitle>
            <DialogDescription>
              {resubmitMode === "quotation"
                ? "Approver ne request send-back ki hai. Fields update kariye aur edit note ke saath dobara submit kariye — chain Level 1 se restart hoga."
                : "Vendor quotation with estimated amount — approval workflow will route this for sign-off."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="overline">Center</Label>
              <Select value={qForm.center_id || ""} onValueChange={(v) => setQForm({ ...qForm, center_id: v })}>
                <SelectTrigger className="rounded-none" data-testid="q-center"><SelectValue placeholder="Select center" /></SelectTrigger>
                <SelectContent>{centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="overline">Category</Label>
              <Select value={qForm.category} onValueChange={(v) => setQForm({ ...qForm, category: v })}>
                <SelectTrigger className="rounded-none" data-testid="q-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="investment">Investment</SelectItem>
                  <SelectItem value="asset">Asset</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="overline">Estimated Amount (₹)</Label>
              <Input type="number" step="0.01" value={qForm.estimated_amount} onChange={(e) => setQForm({ ...qForm, estimated_amount: e.target.value })} className="rounded-none" data-testid="q-amount" />
            </div>
            <div className="col-span-2">
              <Label className="overline">Vendor</Label>
              <Select
                value={qForm.vendor_id || "__manual"}
                onValueChange={(v) => {
                  if (v === "__manual") { setQForm({ ...qForm, vendor_id: "", vendor_name: "" }); return; }
                  const ven = vendors.find((x) => x.id === v);
                  setQForm({ ...qForm, vendor_id: v, vendor_name: ven?.name || "" });
                }}
              >
                <SelectTrigger className="rounded-none" data-testid="q-vendor-select"><SelectValue placeholder="Pick a vendor or type manually" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__manual">— Type manually below —</SelectItem>
                  {vendors.filter((v) => v.active !== false).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}{v.gst_number ? ` · GST ${v.gst_number}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-2">
                <Input
                  value={qForm.vendor_name}
                  onChange={(e) => setQForm({ ...qForm, vendor_name: e.target.value, vendor_id: "" })}
                  placeholder="Or type vendor name here"
                  className="rounded-none" data-testid="q-vendor"
                />
                {qForm.vendor_id && (() => {
                  const ven = vendors.find((x) => x.id === qForm.vendor_id);
                  return ven ? (
                    <div className="text-[10px] text-[var(--muted)] mt-1 space-y-0.5">
                      {ven.contact_person && <div>Contact: {ven.contact_person} {ven.mobile && `· ${ven.mobile}`}</div>}
                      {ven.bank_name && <div>Bank: {ven.bank_name} · A/c {ven.bank_account_no || "—"} · {ven.ifsc || "—"}</div>}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
            <div className="col-span-2">
              <Label className="overline">Description of Item / Service</Label>
              <Textarea rows={3} value={qForm.description} onChange={(e) => setQForm({ ...qForm, description: e.target.value })} className="rounded-none" data-testid="q-description" />
            </div>
            <div>
              <Label className="overline">Expected Delivery Date</Label>
              <Input type="date" value={qForm.expected_delivery_date} onChange={(e) => setQForm({ ...qForm, expected_delivery_date: e.target.value })} className="rounded-none" data-testid="q-delivery" />
            </div>
            <div>
              <Label className="overline">Purpose / Justification</Label>
              <Input value={qForm.purpose} onChange={(e) => setQForm({ ...qForm, purpose: e.target.value })} className="rounded-none" placeholder="Why is this needed?" data-testid="q-purpose" />
            </div>
            {/* Attachments — vendor quotation PDF/image */}
            <div className="col-span-2 space-y-2">
              <Label className="overline">Attachments (quotation PDF, vendor invoice, images)</Label>
              <input
                type="file" accept="*/*" onChange={(e) => uploadAttachment(e, setQForm)}
                disabled={uploading}
                className="block w-full text-sm border border-[var(--border)] rounded-none p-2 bg-white disabled:opacity-60"
                data-testid="q-attach-input"
              />
              {(qForm.attachments || []).length > 0 && (
                <div className="space-y-1">
                  {qForm.attachments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between bg-gray-50 border border-[var(--border)] px-2 py-1 text-xs" data-testid={`q-attach-${a.id}`}>
                      <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline truncate flex items-center gap-2">
                        <Paperclip size={12} /> {a.filename}
                      </a>
                      <button type="button" onClick={() => removeAttachment(a.id, setQForm)} className="text-red-600 hover:underline text-[10px]">Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {resubmitMode === "quotation" && (
            <div className="border border-amber-300 bg-amber-50/60 p-3 mt-3">
              <Label className="overline text-amber-900">Edit note (mandatory) — kya change kiya as per remarks *</Label>
              <Textarea rows={2} value={editNote} onChange={(e) => setEditNote(e.target.value)} className="rounded-none mt-1" placeholder="e.g. Amount corrected to ₹1,145 as per invoice; attached updated bill" data-testid="q-edit-note" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => { setOpenQ(false); setResubmitMode(null); setEditNote(""); }}>Cancel</Button>
            <Button onClick={submitQuotation} disabled={busy} className="rounded-none brand-btn" data-testid="q-submit">
              {busy ? "Saving…" : (resubmitMode === "quotation" ? "Resubmit Quotation" : "Raise Quotation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={openP} onOpenChange={(o) => { if (!o) { setOpenP(false); setPayQuotation(null); setResubmitMode(null); setEditNote(""); } }}>
        <DialogContent className="rounded-none" data-testid="payment-form">
          <DialogHeader>
            <DialogTitle>{resubmitMode === "payment" ? "Edit & Resubmit Payment" : "Raise Payment Request"}</DialogTitle>
            <DialogDescription>
              Against QRN <strong className="font-mono">{payQuotation?.qrn}</strong> · {payQuotation?.vendor_name}
            </DialogDescription>
          </DialogHeader>
          {payQuotation && (
            <div className="space-y-3">
              <div className="text-xs bg-gray-50 border border-[var(--border)] p-3 space-y-1">
                <div><span className="overline mr-2">Center</span>{payQuotation.center_name}</div>
                <div><span className="overline mr-2">Vendor</span>{payQuotation.vendor_name}</div>
                <div><span className="overline mr-2">Est. Amount</span>{inr(payQuotation.estimated_amount)}</div>
                <div><span className="overline mr-2">Description</span>{payQuotation.description}</div>
              </div>
              <div>
                <Label className="overline">Actual Amount to Pay (₹)</Label>
                <Input type="number" step="0.01" value={pForm.actual_amount} onChange={(e) => setPForm({ ...pForm, actual_amount: e.target.value })} className="rounded-none" data-testid="p-amount" />
                <div className="text-[10px] text-[var(--muted)] mt-1">Editable — negotiated / discounted amount may differ from estimate.</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="overline">Payment Mode</Label>
                  <Select value={pForm.payment_mode} onValueChange={(v) => setPForm({ ...pForm, payment_mode: v })}>
                    <SelectTrigger className="rounded-none" data-testid="p-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank">Bank Transfer</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline">Payment Date</Label>
                  <Input type="date" value={pForm.payment_date} onChange={(e) => setPForm({ ...pForm, payment_date: e.target.value })} className="rounded-none" data-testid="p-date" />
                </div>
              </div>

              {/* Payee details — required for bank/cheque/upi so approver knows exactly where money will land */}
              {(pForm.payment_mode === "bank" || pForm.payment_mode === "cheque") && (
                <div className="border border-[var(--border)] bg-amber-50/40 p-3 space-y-3" data-testid="p-payee-bank">
                  <div className="overline text-amber-900">Payee Bank Details (mandatory)</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="overline">Account Holder Name *</Label>
                      <Input value={pForm.payee_account_holder} onChange={(e) => setPForm({ ...pForm, payee_account_holder: e.target.value })} className="rounded-none" placeholder="As per bank records" data-testid="p-payee-holder" />
                    </div>
                    <div>
                      <Label className="overline">Bank Name *</Label>
                      <Input value={pForm.payee_bank_name} onChange={(e) => setPForm({ ...pForm, payee_bank_name: e.target.value })} className="rounded-none" placeholder="e.g. HDFC Bank" data-testid="p-payee-bank" />
                    </div>
                    <div>
                      <Label className="overline">Account Number *</Label>
                      <Input value={pForm.payee_account_no} onChange={(e) => setPForm({ ...pForm, payee_account_no: e.target.value })} className="rounded-none font-mono" data-testid="p-payee-acno" />
                    </div>
                    <div>
                      <Label className="overline">IFSC Code *</Label>
                      <Input value={pForm.payee_ifsc} onChange={(e) => setPForm({ ...pForm, payee_ifsc: e.target.value.toUpperCase() })} className="rounded-none font-mono uppercase" placeholder="HDFC0001234" data-testid="p-payee-ifsc" />
                    </div>
                  </div>
                </div>
              )}
              {pForm.payment_mode === "upi" && (
                <div className="border border-[var(--border)] bg-violet-50/40 p-3 space-y-3" data-testid="p-payee-upi">
                  <div className="overline text-violet-900">UPI Details (mandatory)</div>
                  <div>
                    <Label className="overline">UPI ID *</Label>
                    <Input value={pForm.payee_upi_id} onChange={(e) => setPForm({ ...pForm, payee_upi_id: e.target.value })} className="rounded-none" placeholder="name@bankupi" data-testid="p-payee-upi-id" />
                    <div className="text-[10px] text-[var(--muted)] mt-1">Also attach a QR screenshot below for verification.</div>
                  </div>
                </div>
              )}

              {/* Payee proof — cancelled cheque / QR / passbook. Only shown for bank/upi/cheque */}
              {(pForm.payment_mode === "bank" || pForm.payment_mode === "cheque" || pForm.payment_mode === "upi") && (
                <div className="space-y-2">
                  <Label className="overline">
                    {pForm.payment_mode === "upi" ? "UPI QR Screenshot *" : "Cancelled Cheque / Bank Passbook *"}
                  </Label>
                  <input
                    type="file" accept="image/*,application/pdf" onChange={(e) => uploadAttachment(e, setPForm, "payee_proof_attachments")}
                    disabled={uploading}
                    className="block w-full text-sm border border-[var(--border)] rounded-none p-2 bg-white disabled:opacity-60"
                    data-testid="p-payee-proof-input"
                  />
                  {(pForm.payee_proof_attachments || []).length > 0 && (
                    <div className="space-y-1">
                      {pForm.payee_proof_attachments.map((a) => (
                        <div key={a.id} className="flex items-center justify-between bg-amber-50 border border-amber-200 px-2 py-1 text-xs">
                          <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-amber-900 hover:underline truncate flex items-center gap-2">
                            <Paperclip size={12} /> {a.filename}
                          </a>
                          <button type="button" onClick={() => removeAttachment(a.id, setPForm, "payee_proof_attachments")} className="text-red-600 hover:underline text-[10px]">Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <Label className="overline">Notes (UTR / cheque no. / reference)</Label>
                <Input value={pForm.notes} onChange={(e) => setPForm({ ...pForm, notes: e.target.value })} className="rounded-none" data-testid="p-notes" />
              </div>
              {/* Payment attachments — receipt, cheque photo, UTR screenshot */}
              <div className="space-y-2">
                <Label className="overline">Attachments (receipt, cheque photo, bank slip)</Label>
                <input
                  type="file" accept="*/*" onChange={(e) => uploadAttachment(e, setPForm)}
                  disabled={uploading}
                  className="block w-full text-sm border border-[var(--border)] rounded-none p-2 bg-white disabled:opacity-60"
                  data-testid="p-attach-input"
                />
                {(pForm.attachments || []).length > 0 && (
                  <div className="space-y-1">
                    {pForm.attachments.map((a) => (
                      <div key={a.id} className="flex items-center justify-between bg-gray-50 border border-[var(--border)] px-2 py-1 text-xs">
                        <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline truncate flex items-center gap-2">
                          <Paperclip size={12} /> {a.filename}
                        </a>
                        <button type="button" onClick={() => removeAttachment(a.id, setPForm)} className="text-red-600 hover:underline text-[10px]">Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {resubmitMode === "payment" && (
            <div className="border border-amber-300 bg-amber-50/60 p-3 mt-2">
              <Label className="overline text-amber-900">Edit note (mandatory) — kya change kiya as per remarks *</Label>
              <Textarea rows={2} value={editNote} onChange={(e) => setEditNote(e.target.value)} className="rounded-none mt-1" placeholder="e.g. Updated IFSC after cancelled cheque re-verified" data-testid="p-edit-note" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => { setOpenP(false); setPayQuotation(null); setResubmitMode(null); setEditNote(""); }}>Cancel</Button>
            <Button onClick={submitPayment} disabled={busy} className="rounded-none brand-btn" data-testid="p-submit">
              {busy ? "Saving…" : (resubmitMode === "payment" ? "Resubmit Payment" : "Raise Payment Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

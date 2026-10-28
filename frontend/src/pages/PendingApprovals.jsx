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
  Inbox, ArrowLeftRight, Plane, Receipt, Check, X, ExternalLink, RefreshCw, Box, UserCog, AlertCircle, FileSignature, IndianRupee, Undo2, Wallet, Users, User as UserIcon,
  Search, SlidersHorizontal, LayoutGrid, List as ListIcon, Hourglass, Clock, CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, ClipboardCheck, MapPin, BadgeAlert, MoreVertical,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Priority is DERIVED (no DB field) — based purely on how long a request has
// been pending. Approved business rule: 0–2d Low · 3–6d Medium · 7d+ High.
const priorityOf = (item) => {
  const d = Math.floor((Date.now() - new Date(item.created_at || Date.now()).getTime()) / 86400000);
  if (d >= 7) return { key: "high", label: "High Priority", cls: "bg-rose-50 text-rose-700 border-rose-200", days: d };
  if (d >= 3) return { key: "medium", label: "Medium Priority", cls: "bg-amber-50 text-amber-700 border-amber-200", days: d };
  return { key: "low", label: "Low Priority", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", days: d };
};
// Final-step payment-type requests need per-request attribution (Paid By / Partner
// / Bank / salary split) and CANNOT be bulk-approved safely.
const needsAttribution = (item) => item.is_final_step && [
  "payment", "reimbursement", "advance_request", "payroll",
].includes(item.request_type);

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
  payroll:           { icon: Users,          label: "Payroll Batch",      color: "bg-purple-50 text-purple-800" },
  mess_receipt:      { icon: Receipt,        label: "Mess Receipt",       color: "bg-lime-50 text-lime-700" },
  mess_payment:      { icon: IndianRupee,    label: "Mess Payment",       color: "bg-green-50 text-green-700" },
};
const FALLBACK_META = { icon: Inbox, label: "Approval", color: "bg-gray-100 text-gray-700" };

export default function PendingApprovals() {
  const nav = useNavigate();
  const { user } = useAuth();
  const roleIsAccounts = ["admin", "accountant"].includes(user?.role);
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
  const [attrPartners, setAttrPartners] = useState([]);   // partners mapped to the selected center only
  const [txnCenterId, setTxnCenterId] = useState("");
  const [txnPartnerId, setTxnPartnerId] = useState("");
  // Phase 29 — Bank/Cash account for final-step debit of Payment / Reimbursement.
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankAccountId, setBankAccountId] = useState("");
  // One-screen Approve+Pay (payroll) — captured when an Accounts/Admin user is the
  // FINAL approver of a payroll batch, so they approve + record payment in one shot.
  const [payBatch, setPayBatch] = useState(null);
  const [payPartners, setPayPartners] = useState([]);
  const [paySel, setPaySel] = useState({});   // staff_id -> bool (who to pay now)
  const [payForm, setPayForm] = useState({
    method: "neft", payment_date: new Date().toISOString().slice(0, 10),
    utr: "", partner_id: "", bank_account_id: "",
  });

  // ---- Redesign UI state (view / search / filters / bulk / pagination) ----
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("pa_view") || "list");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ priority: "all", center: "all", amtMin: "", amtMax: "", from: "", to: "" });
  const [selected, setSelected] = useState({});   // `${type}-${id}` -> bool
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  // Bulk action modal: { action: "approve"|"reject", eligible:[], skipped:[] }
  const [bulkActing, setBulkActing] = useState(null);
  const [bulkRemarks, setBulkRemarks] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const setView = (m) => { setViewMode(m); localStorage.setItem("pa_view", m); };

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
    // Pre-fetch centers/payers so the final-approval dialog opens
    // with dropdowns already populated (no perceived lag when Accountant clicks Approve).
    api.get("/entities/center").then((r) => setCenters(r.data || [])).catch(() => {});
    api.get("/users/payers").then((r) => setPayers(r.data || [])).catch(() => {});
    // Bank/cash accounts for final-approval debit (empty for non-accountant/admin — API will 403).
    api.get("/bank-accounts", { params: { active_only: true } })
      .then((r) => setBankAccounts(r.data || []))
      .catch(() => setBankAccounts([]));
  }, []);

  const filtered = useMemo(() => {
    let list = filterType === "all" ? items : items.filter((i) => i.request_type === filterType);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) => {
        const hay = [
          i.requester_name, i.requester?.name, i.requester?.employee_code,
          i.summary?.purpose, i.summary?.description, i.summary?.vendor_name,
          i.center_name_of_request, (TYPE_META[i.request_type] || {}).label,
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    if (filters.priority !== "all") list = list.filter((i) => priorityOf(i).key === filters.priority);
    if (filters.center !== "all") list = list.filter((i) => (i.center_name_of_request || "—") === filters.center);
    if (filters.amtMin !== "") list = list.filter((i) => Number(i.summary?.amount || 0) >= Number(filters.amtMin));
    if (filters.amtMax !== "") list = list.filter((i) => Number(i.summary?.amount || 0) <= Number(filters.amtMax));
    if (filters.from) list = list.filter((i) => i.created_at && new Date(i.created_at) >= new Date(filters.from));
    if (filters.to) list = list.filter((i) => i.created_at && new Date(i.created_at) <= new Date(filters.to + "T23:59:59"));
    return list;
  }, [items, filterType, search, filters]);

  const centerOptions = useMemo(
    () => Array.from(new Set(items.map((i) => i.center_name_of_request).filter(Boolean))).sort(),
    [items],
  );
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.priority !== "all") n++;
    if (filters.center !== "all") n++;
    if (filters.amtMin !== "" || filters.amtMax !== "") n++;
    if (filters.from || filters.to) n++;
    return n;
  }, [filters]);

  // Reset to first page whenever the result set changes.
  useEffect(() => { setPage(1); }, [filterType, search, filters]);
  // Clear bulk selection when switching tabs so the selected-count is never
  // misleading across different request-type views.
  useEffect(() => { setSelected({}); }, [filterType]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const keyOf = (i) => `${i.request_type}-${i.request_id}`;
  const selectedItems = useMemo(
    () => filtered.filter((i) => selected[keyOf(i)]),
    [filtered, selected],
  );
  const pageAllSelected = pageItems.length > 0 && pageItems.every((i) => selected[keyOf(i)]);
  const toggleOne = (i) => setSelected((s) => ({ ...s, [keyOf(i)]: !s[keyOf(i)] }));
  const togglePageAll = () => {
    setSelected((s) => {
      const n = { ...s };
      const target = !pageAllSelected;
      pageItems.forEach((i) => { n[keyOf(i)] = target; });
      return n;
    });
  };
  const clearSelection = () => setSelected({});

  // Open the bulk confirm modal — partition selection into bulk-eligible vs
  // skipped (payment-type finals that need per-request attribution).
  const openBulk = (action) => {
    if (selectedItems.length === 0) { toast.error("Pehle kuch requests select karein"); return; }
    const eligible = action === "reject" ? selectedItems : selectedItems.filter((i) => !needsAttribution(i));
    const skipped  = action === "reject" ? [] : selectedItems.filter((i) => needsAttribution(i));
    if (eligible.length === 0) {
      toast.error("Selected requests me payment/payroll final-step hain — inhe individually Approve karein");
      return;
    }
    setBulkRemarks("");
    setBulkActing({ action, eligible, skipped });
  };

  const runBulk = async () => {
    if (!bulkActing || bulkBusy) return;
    if (!bulkRemarks.trim() || bulkRemarks.trim().length < 3) { toast.error("Remarks required (min 3 chars)"); return; }
    setBulkBusy(true);
    const { action, eligible } = bulkActing;
    let ok = 0; let fail = 0;
    for (const item of eligible) {
      try {
        if (item.request_type === "transaction" && item.via === "partner_cross") {
          await api.post(`/transactions/${item.request_id}/${action === "approve" ? "partner-approve" : "partner-reject"}`, { remarks: bulkRemarks });
        } else {
          await api.post(`/approvals/act`, { request_type: item.request_type, request_id: item.request_id, action, remarks: bulkRemarks });
        }
        ok++;
      } catch (e) { fail++; }
    }
    setBulkBusy(false);
    setBulkActing(null);
    clearSelection();
    if (ok) toast.success(`${action === "approve" ? "Approved" : "Rejected"} ${ok} request(s)${fail ? ` · ${fail} failed` : ""}`);
    if (!ok && fail) toast.error(`All ${fail} action(s) failed`);
    load();
  };

  const counts = useMemo(() => {
    const c = {
      all: items.length,
      transaction: 0, leave: 0, reimbursement: 0, asset_purchase: 0,
      employee_transfer: 0, regularisation: 0,
      quotation: 0, payment: 0, advance_request: 0, payroll: 0,
    };
    items.forEach((i) => { c[i.request_type] = (c[i.request_type] || 0) + 1; });
    return c;
  }, [items]);

  const totalAmount = useMemo(
    () => filtered.reduce((s, i) => s + (Number(i.summary?.amount) || 0), 0),
    [filtered],
  );

  // Dedicated Payroll queue metrics — HR Approvers see a distinct card so
  // Payroll batches (which carry the largest amounts) never get lost in the
  // mixed inbox stream.
  const payrollItems = useMemo(
    () => items.filter((i) => i.request_type === "payroll"),
    [items],
  );
  const payrollTotal = useMemo(
    () => payrollItems.reduce((s, i) => s + (Number(i.summary?.amount) || 0), 0),
    [payrollItems],
  );

  const openAct = (item, action) => {
    setActing({ item, action });
    setRemarks("");
    setPaidByUserId("");
    setTxnCenterId(item?.summary?.center_id || "");
    setTxnPartnerId("");
    setAttrPartners([]);
    setBankAccountId("");
    // One-screen Approve+Pay: an Accounts/Admin user finalising a payroll batch
    // records the payment inside the same dialog.
    setPayBatch(null);
    setPayPartners([]);
    setPaySel({});
    setPayForm({ method: "neft", payment_date: new Date().toISOString().slice(0, 10), utr: "", partner_id: "", bank_account_id: "" });
    if (action === "approve" && item.request_type === "payroll" && item.is_final_step && roleIsAccounts) {
      api.get(`/payroll-batches/${item.request_id}`).then((r) => {
        const b = r.data || {};
        setPayBatch(b);
        const sel = {};
        (b.rows || []).forEach((row) => { if ((row.pay_status || "pending") !== "paid") sel[row.staff_id] = true; });
        setPaySel(sel);
      }).catch(() => {});
      const cid = item?.summary?.center_id;
      if (cid) {
        api.get(`/centers/${cid}/mapped-partners`).then((r) => {
          const act = (r.data || []).filter((p) => p.active !== false);
          setPayPartners(act);
          if (act.length === 1) setPayForm((f) => ({ ...f, partner_id: act[0].partner_id }));
        }).catch(() => {});
      }
      if (payers.length === 0) api.get("/users/payers").then((r) => setPayers(r.data || [])).catch(() => {});
      api.get("/bank-accounts", { params: { active_only: true } }).then((r) => setBankAccounts(r.data || [])).catch(() => {});
    } else if ((action === "approve" || action === "view") && item.request_type === "payroll") {
      // Non-accounts approver (senior_manager/hr/manager) — load the batch so the
      // dialog can show a read-only employee-wise salary breakdown.
      api.get(`/payroll-batches/${item.request_id}`).then((r) => setPayBatch(r.data || null)).catch(() => {});
    }
    // Ask "Paid By" on the FINAL step of a payment, reimbursement, or advance approval.
    // For advance_request the block is optional but the dropdowns still need populated data.
    if (action === "approve" && item.is_final_step && (
      item.request_type === "payment"
      || item.request_type === "reimbursement"
      || item.request_type === "advance_request"
      || item.request_type === "mess_payment"
    )) {
      // Lazy fetch — cache once loaded so subsequent dialogs stay snappy.
      if (payers.length === 0) {
        api.get("/users/payers").then((r) => setPayers(r.data || [])).catch(() => {});
      }
      if (centers.length === 0) {
        api.get("/entities/center").then((r) => setCenters(r.data || [])).catch(() => {});
      }
      // Partner dropdown must list ONLY the request-center's active mapped partners
      // (not every partner). Auto-select when the center maps to exactly one.
      loadCenterPartners(item?.summary?.center_id || "");
    }
  };

  // Fetch the active partners mapped to a center → used to restrict the attribution
  // Partner dropdown. Auto-selects when there is exactly one mapped partner.
  const loadCenterPartners = (cid) => {
    if (!cid) { setAttrPartners([]); setTxnPartnerId(""); return; }
    api.get(`/centers/${cid}/mapped-partners`).then((r) => {
      const act = (r.data || []).filter((p) => p.active !== false);
      setAttrPartners(act);
      setTxnPartnerId(act.length === 1 ? act[0].partner_id : "");
    }).catch(() => { setAttrPartners([]); setTxnPartnerId(""); });
  };

  // Payment attribution (Center / Partner / Paid By) is captured at final approval
  // for: payment, reimbursement, and advance_request. For advance_request it's
  // OPTIONAL (release step re-collects if not provided) but showing it in the same
  // dialog lets accounts one-shot the workflow.
  const needsPaidBy = !!(
    acting && acting.action === "approve" && acting.item.is_final_step &&
    (acting.item.request_type === "payment"
     || acting.item.request_type === "reimbursement"
     || acting.item.request_type === "advance_request"
     || acting.item.request_type === "mess_payment")
  );
  // Paid By is optional for advance (captured at Release) and mess payment
  // (already captured when the payment was raised) — accountant mainly confirms
  // Center / Partner / Bank there.
  const paidByOptional = ["advance_request", "mess_payment"].includes(acting?.item?.request_type);
  // Center must be chosen for payment / reimbursement / mess_payment.
  const centerMandatory = needsPaidBy && ["payment", "reimbursement", "mess_payment"].includes(acting?.item?.request_type);

  // One-screen Approve+Pay flag — true when an Accounts/Admin user is finalising
  // a payroll batch (payment form shown + "Approve & Record Payment").
  const isPayrollPay = !!(
    acting && acting.action === "approve" &&
    acting.item.request_type === "payroll" &&
    acting.item.is_final_step && roleIsAccounts
  );
  const paySelCount = Object.values(paySel).filter(Boolean).length;
  const paySelAmount = (payBatch?.rows || [])
    .filter((r) => paySel[r.staff_id])
    .reduce((s, r) => s + Number(r.net || 0), 0);
  const payableRows = (payBatch?.rows || []).filter((r) => (r.pay_status || "pending") !== "paid");

  const confirmAct = async () => {
    if (!acting) return;
    if (confirmBusy) return;  // guard: rapid double-click won't fire twice
    if (!remarks.trim() || remarks.trim().length < 3) {
      toast.error("Remarks required (min 3 chars)");
      return;
    }

    // ---- One-screen Approve + Record Payment (payroll) ----
    if (isPayrollPay) {
      if (!payForm.partner_id) { toast.error("Please select the Partner for this payroll payment"); return; }
      if (!paidByUserId) { toast.error("Please select 'Paid By' (who is releasing the money)"); return; }
      if (!payForm.bank_account_id) { toast.error("Please select the Bank/Debit account"); return; }
      if (!payForm.payment_date) { toast.error("Payment date is required"); return; }
      const selectedIds = payableRows.filter((r) => paySel[r.staff_id]).map((r) => r.staff_id);
      if (selectedIds.length === 0) { toast.error("Select at least one employee to pay"); return; }
      const payer = payers.find((p) => p.id === paidByUserId);
      const payingAll = selectedIds.length === payableRows.length;
      setConfirmBusy(true);
      try {
        // 1) finalise the approval (moves batch to pending_payment)
        await api.post(`/approvals/act`, {
          request_type: "payroll", request_id: acting.item.request_id,
          action: "approve", remarks,
        });
        // 2) record the payment for the selected employees
        await api.post(`/payroll-batches/${acting.item.request_id}/pay`, {
          method: payForm.method,
          payment_date: payForm.payment_date,
          utr: payForm.utr || null,
          remarks,
          bank_account_id: payForm.bank_account_id,
          partner_id: payForm.partner_id,
          paid_by_user_id: paidByUserId,
          paid_by_name: payer?.name || null,
          staff_ids: payingAll ? null : selectedIds,
        });
        toast.success(payingAll ? "Approved & payment recorded" : `Approved & ${selectedIds.length} employee(s) paid — batch Partially Paid`);
        setActing(null);
        load();
      } catch (e) { toast.error(formatError(e)); }
      finally { setConfirmBusy(false); }
      return;
    }

    // For advance_request the attribution is OPTIONAL — approver can skip it and
    // let the Release dialog capture it later. For payment/reimbursement it stays mandatory.
    if (needsPaidBy && !paidByUserId && !paidByOptional) {
      toast.error("Please select who is making the payment (Paid By is mandatory)");
      return;
    }
    if (needsPaidBy && !txnCenterId && centerMandatory) {
      toast.error("Please select the Center for this payment");
      return;
    }
    // Bank/Cash Reconciliation: payment / reimbursement / mess payment final
    // approvals must debit a specific account (once at least one is configured).
    const needsBankAccount = (
      needsPaidBy &&
      (acting.item.request_type === "payment" || acting.item.request_type === "reimbursement" || acting.item.request_type === "mess_payment") &&
      bankAccounts.length > 0
    );
    if (needsBankAccount && !bankAccountId) {
      toast.error("Please pick the Bank/Cash account from which this payment is being made");
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
          bank_account_id: needsBankAccount ? (bankAccountId || null) : null,
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
    else if (item.request_type === "payroll") nav("/hrms?tab=payroll");
    else nav("/hrms");
  };

  // ---- Request card (shared by list + grid views) ----
  const RequestCard = (item) => {
    const meta = TYPE_META[item.request_type] || FALLBACK_META;
    const Icon = meta.icon;
    const pr = priorityOf(item);
    const r = item.requester || {};
    const rname = r.name || item.requester_name;
    const na = (v) => (v == null || v === "" ? "N/A" : v);
    const checked = !!selected[keyOf(item)];

    // ---- Shared blocks (arranged differently for list vs grid) ----
    const badges = (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">{meta.label}</span>
        {item.via === "partner_cross" && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-[var(--brand)] text-white">PARTNER CROSS-APPROVAL</span>
        )}
        {item.is_final_step && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">FINAL STEP</span>
        )}
      </div>
    );

    const requesterBlock = (
      <div className="space-y-2">
        {badges}
        <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-900">
          <UserIcon size={14} className="text-[var(--brand)]" /> {na(rname)}
        </div>
        <div className="space-y-0.5 text-[11px] text-[var(--muted)]">
          <div>Employee ID: <b className="text-slate-700">{na(r.employee_code)}</b></div>
          <div>Department: <b className="text-slate-700">{na(r.department)}</b></div>
          <div>Designation: <b className="text-slate-700">{na(r.designation)}</b></div>
        </div>
        {item.center_name_of_request && (
          <span className="inline-flex items-center gap-1 text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-md px-1.5 py-0.5 text-[11px] font-medium"><MapPin size={11} /> {item.center_name_of_request}</span>
        )}
      </div>
    );

    const paymentBlock = (
      <div className="space-y-1.5">
        {item.summary?.purpose && (
          <div className="text-[13px] font-semibold text-slate-800" data-testid={`row-purpose-${item.request_id}`}>{item.summary.purpose}</div>
        )}
        {item.summary?.vendor_name && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded-md">
            {(item.request_type === "advance_request" ? "Payee: " : "Vendor: ")}{item.summary.vendor_name}
          </span>
        )}
        {item.summary?.amount != null && (
          <div className="num font-black text-[20px] text-emerald-700" data-testid={`row-amount-${item.request_id}`}>{inr(item.summary.amount)}</div>
        )}
        {item.summary?.description && item.summary.description !== item.summary.purpose && (
          <div className="text-[12px] text-indigo-900 bg-indigo-50/60 border-l-4 border-indigo-400 rounded-r-md pl-2.5 py-1.5 whitespace-pre-wrap break-words leading-relaxed">
            {item.summary.description}
          </div>
        )}
        <div className="flex items-center gap-4 text-[11px] text-[var(--muted)] flex-wrap pt-0.5">
          {item.summary?.date && <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {item.summary.date}</span>}
          {item.created_at && <span className="inline-flex items-center gap-1"><Clock size={12} /> Raised {new Date(item.created_at).toLocaleDateString("en-IN")}</span>}
        </div>
      </div>
    );

    const priorityKebab = (
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${pr.cls}`} data-testid={`priority-${item.request_id}`}>{pr.label}</span>
        <button type="button" onClick={() => openDetail(item)} title="View details" className="text-slate-400 hover:text-slate-700 p-0.5 rounded hover:bg-slate-100" data-testid={`kebab-${item.request_id}`}>
          <MoreVertical size={16} />
        </button>
      </div>
    );

    const actionButtons = (
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <Button variant="outline" size="sm" onClick={() => openDetail(item)} className="rounded-lg h-8 gap-1" data-testid={`btn-detail-${item.request_id}`}>
          <ExternalLink size={12} /> View
        </Button>
        <Button size="sm" onClick={() => openAct(item, "approve")} className="brand-btn rounded-lg h-8 gap-1" data-testid={`btn-approve-${item.request_id}`}>
          <Check size={12} /> Approve
        </Button>
        {(item.request_type === "quotation" || item.request_type === "payment") && (
          <Button variant="outline" size="sm" onClick={() => openAct(item, "send_back")} className="rounded-lg h-8 gap-1 text-amber-800 border-amber-300 hover:bg-amber-50" data-testid={`btn-sendback-${item.request_id}`}>
            <Undo2 size={12} /> Send Back
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => openAct(item, "reject")} className="rounded-lg h-8 gap-1 hover:text-[var(--danger)] hover:border-[var(--danger)]" data-testid={`btn-reject-${item.request_id}`}>
          <X size={12} /> Reject
        </Button>
      </div>
    );

    return (
      <div
        key={keyOf(item)}
        className={`bg-white border rounded-xl shadow-sm transition-all duration-200 hover:shadow-md hover:border-blue-300 ${checked ? "border-[var(--brand)] ring-1 ring-[var(--brand)]/30" : "border-slate-200"}`}
        data-testid={`approval-card-${item.request_id}`}
      >
        {viewMode === "grid" ? (
          /* Grid: stacked compact */
          <div className="p-4 flex items-start gap-3">
            <Checkbox checked={checked} onCheckedChange={() => toggleOne(item)} className="mt-1 rounded-md data-[state=checked]:bg-[var(--brand)] data-[state=checked]:border-[var(--brand)]" data-testid={`select-${item.request_id}`} />
            <div className={`${meta.color} p-2.5 rounded-lg shrink-0`}><Icon size={18} /></div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-2">{requesterBlock}{priorityKebab}</div>
              <div className="border-t border-slate-100 pt-2.5">{paymentBlock}</div>
              <div className="border-t border-slate-100 pt-2.5">{actionButtons}</div>
            </div>
          </div>
        ) : (
          /* List: 3-section horizontal (Requester | Payment | Approval) */
          <div className="p-4 sm:p-5 flex items-stretch gap-3">
            <div className="flex items-start gap-3 shrink-0">
              <Checkbox checked={checked} onCheckedChange={() => toggleOne(item)} className="mt-1 rounded-md data-[state=checked]:bg-[var(--brand)] data-[state=checked]:border-[var(--brand)]" data-testid={`select-${item.request_id}`} />
              <div className={`${meta.color} p-2.5 rounded-lg`}><Icon size={18} /></div>
            </div>
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-0 min-w-0">
              {/* Section 1 — Requester details */}
              <div className="lg:col-span-4 lg:pr-5 lg:border-r lg:border-slate-100 min-w-0" data-testid={`sec-requester-${item.request_id}`}>
                {requesterBlock}
              </div>
              {/* Section 2 — Payment details */}
              <div className="lg:col-span-5 lg:px-5 lg:border-r lg:border-slate-100 min-w-0" data-testid={`sec-payment-${item.request_id}`}>
                {paymentBlock}
              </div>
              {/* Section 3 — Approval details */}
              <div className="lg:col-span-3 lg:pl-5 flex flex-col justify-between items-stretch gap-3" data-testid={`sec-approval-${item.request_id}`}>
                <div className="flex justify-end">{priorityKebab}</div>
                {actionButtons}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5 p-4 md:p-6 w-full" data-testid="pending-approvals-page">
      {/* Premium header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[var(--brand)] via-indigo-700 to-blue-700 text-white p-6 md:p-8 shadow-lg">
        <div className="absolute -right-10 -top-10 w-56 h-56 bg-white/10 rounded-full blur-2xl" />
        <div className="absolute right-20 bottom-0 opacity-10"><ClipboardCheck size={160} /></div>
        <div className="relative">
          <div className="flex items-center gap-1.5 text-[11px] text-white/70 font-medium mb-3" data-testid="pa-breadcrumb">
            <span>Approvals &amp; Workflow</span>
            <ChevronRight size={12} />
            <span className="text-white font-semibold">Pending Approvals</span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div className="bg-white/15 backdrop-blur p-3 rounded-xl"><ClipboardCheck size={30} /></div>
              <div>
                <h1 className="font-heading font-black tracking-tight text-2xl md:text-3xl">Pending Approvals</h1>
                <p className="text-white/80 text-sm mt-1 max-w-xl">All requests awaiting your action across transactions, leaves, reimbursements, assets and payrolls.</p>
              </div>
            </div>
            <Button variant="outline" onClick={load} className="rounded-lg gap-1.5 bg-white/10 border-white/30 text-white hover:bg-white/20" data-testid="btn-refresh-approvals">
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200" style={{ scrollbarWidth: "none" }}>
        {[
          { key: "all", label: "All" }, { key: "transaction", label: "Transactions" },
          { key: "leave", label: "Leaves" }, { key: "reimbursement", label: "Reimbursements" },
          { key: "asset_purchase", label: "Assets" }, { key: "employee_transfer", label: "Transfers" },
          { key: "regularisation", label: "Regularisations" }, { key: "quotation", label: "Quotations" },
          { key: "payment", label: "Payments" }, { key: "advance_request", label: "Advances" },
          { key: "payroll", label: "Payrolls" },
        ].map((t) => {
          const active = filterType === t.key;
          return (
            <button
              key={t.key} onClick={() => setFilterType(t.key)} data-testid={`tab-${t.key}`}
              className={`shrink-0 inline-flex items-center rounded-lg px-3 py-1.5 text-xs transition-colors ${active ? "bg-[var(--brand)] text-white font-semibold shadow-sm" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium"}`}
            >
              {t.label}
              {(counts[t.key] || 0) > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full num ${active ? "bg-white/25 text-white" : "bg-slate-200 text-slate-700"}`}>{counts[t.key]}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { id: "awaiting", label: "Total Awaiting", value: filtered.length, sub: "Action required", Icon: Hourglass, bg: "bg-blue-50", bd: "border-blue-100", tc: "text-blue-700", ic: "bg-blue-500" },
          { id: "amount", label: "Total Amount", value: inr(totalAmount), sub: `Across ${filtered.length} request${filtered.length === 1 ? "" : "s"}`, Icon: IndianRupee, bg: "bg-emerald-50", bd: "border-emerald-100", tc: "text-emerald-700", ic: "bg-emerald-500" },
          { id: "oldest", label: "Oldest (days)", value: oldestDays(filtered), sub: oldestDays(filtered) > 0 ? `${oldestDays(filtered)} day(s) ago` : "None pending", Icon: CalendarDays, bg: "bg-amber-50", bd: "border-amber-100", tc: "text-amber-700", ic: "bg-amber-500" },
          { id: "updated", label: "Updated", value: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }), sub: "Today", Icon: Clock, bg: "bg-purple-50", bd: "border-purple-100", tc: "text-purple-700", ic: "bg-purple-500" },
        ].map((k) => (
          <div key={k.id} className={`${k.bg} ${k.bd} border rounded-xl p-4 flex items-start justify-between`} data-testid={`kpi-${k.id}`}>
            <div>
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${k.tc}`}>{k.label}</div>
              <div className="num font-black text-2xl text-slate-900 mt-1">{k.value}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{k.sub}</div>
            </div>
            <div className={`${k.ic} text-white p-2 rounded-lg shadow-sm`}><k.Icon size={18} /></div>
          </div>
        ))}
      </div>

      {/* Payroll highlight (unchanged logic, refreshed style) */}
      {payrollItems.length > 0 && (
        <div className="rounded-xl p-5 bg-gradient-to-r from-purple-900 via-indigo-900 to-purple-950 text-white shadow-md" data-testid="payroll-approvals-card">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="bg-white/15 p-2.5 rounded-lg"><Users size={22} /></div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-200">Payroll Approvals</div>
                <div className="font-heading font-black text-2xl mt-0.5">{payrollItems.length} <span className="text-sm font-medium text-purple-200">batch{payrollItems.length > 1 ? "es" : ""} awaiting</span></div>
                <div className="text-xs num font-bold mt-0.5 text-emerald-300">Net Payable: {inr(payrollTotal)}</div>
              </div>
            </div>
            <Button size="sm" onClick={() => setFilterType("payroll")} className="bg-white text-purple-900 hover:bg-purple-50 rounded-lg gap-1" data-testid="view-payroll-queue-btn">
              <Users size={12} /> Review Payroll Queue
            </Button>
          </div>
          {payrollItems.slice(0, 3).map((p) => (
            <div key={p.request_id} className="mt-3 flex items-center justify-between gap-3 flex-wrap text-xs border-t border-white/15 pt-2" data-testid={`payroll-queue-preview-${p.request_id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">{p.summary?.purpose}</span>
                {p.requester_name && <span className="text-purple-200">· Finalised by <b className="text-white">{p.requester_name}</b></span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="num font-black text-emerald-300">{inr(p.summary?.amount)}</span>
                <Button size="sm" onClick={() => openAct(p, "approve")} className="bg-white text-purple-900 hover:bg-purple-50 rounded-lg h-7 gap-1" data-testid={`payroll-quick-approve-${p.request_id}`}>
                  <Check size={12} /> Approve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar: search + filter + view toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requester, purpose, vendor…" className="pl-9 rounded-lg text-sm" data-testid="search-approvals-input" />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="rounded-lg gap-1.5" data-testid="filter-popover-trigger">
              <SlidersHorizontal size={14} /> Filter
              {activeFilterCount > 0 && <span className="ml-1 bg-[var(--brand)] text-white text-[10px] font-bold px-1.5 rounded-full num">{activeFilterCount}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 rounded-xl p-4 space-y-3">
            <div className="font-bold text-sm">Filters</div>
            <div>
              <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Priority (by age)</div>
              <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} className="w-full text-sm border border-slate-200 rounded-lg p-2" data-testid="filter-priority">
                <option value="all">All</option><option value="low">Low (0–2d)</option><option value="medium">Medium (3–6d)</option><option value="high">High (7d+)</option>
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Center</div>
              <select value={filters.center} onChange={(e) => setFilters((f) => ({ ...f, center: e.target.value }))} className="w-full text-sm border border-slate-200 rounded-lg p-2" data-testid="filter-center">
                <option value="all">All centers</option>
                {centerOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Amount range (₹)</div>
              <div className="flex items-center gap-2">
                <Input type="number" value={filters.amtMin} onChange={(e) => setFilters((f) => ({ ...f, amtMin: e.target.value }))} placeholder="Min" className="rounded-lg text-sm" data-testid="filter-amt-min" />
                <Input type="number" value={filters.amtMax} onChange={(e) => setFilters((f) => ({ ...f, amtMax: e.target.value }))} placeholder="Max" className="rounded-lg text-sm" data-testid="filter-amt-max" />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Raised date</div>
              <div className="flex items-center gap-2">
                <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="rounded-lg text-sm" data-testid="filter-from" />
                <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="rounded-lg text-sm" data-testid="filter-to" />
              </div>
            </div>
            <Button variant="outline" className="w-full rounded-lg" onClick={() => setFilters({ priority: "all", center: "all", amtMin: "", amtMax: "", from: "", to: "" })} data-testid="filter-clear">Clear filters</Button>
          </PopoverContent>
        </Popover>
        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
          <button onClick={() => setView("list")} className={`p-2 ${viewMode === "list" ? "bg-[var(--brand)] text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="view-mode-list" title="List view"><ListIcon size={16} /></button>
          <button onClick={() => setView("grid")} className={`p-2 ${viewMode === "grid" ? "bg-[var(--brand)] text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="view-mode-grid" title="Grid view"><LayoutGrid size={16} /></button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedItems.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-[var(--brand)]/5 border border-[var(--brand)]/30 rounded-xl px-4 py-2.5" data-testid="bulk-action-bar">
          <div className="text-sm font-semibold text-[var(--brand)]">{selectedItems.length} selected</div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => openBulk("approve")} className="brand-btn rounded-lg gap-1" data-testid="bulk-approve-btn"><Check size={14} /> Approve Selected</Button>
            <Button size="sm" onClick={() => openBulk("reject")} className="bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90 rounded-lg gap-1" data-testid="bulk-reject-btn"><X size={14} /> Reject Selected</Button>
            <Button size="sm" variant="outline" onClick={clearSelection} className="rounded-lg" data-testid="bulk-clear-btn">Clear</Button>
          </div>
        </div>
      )}

      {/* List / Grid */}
      {loading ? (
        <div className={viewMode === "grid" ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : "space-y-3"}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
              <div className="flex gap-3"><div className="w-10 h-10 bg-slate-200 rounded-lg" /><div className="flex-1 space-y-2"><div className="h-3 bg-slate-200 rounded w-1/3" /><div className="h-3 bg-slate-100 rounded w-2/3" /><div className="h-3 bg-slate-100 rounded w-1/2" /></div></div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center" data-testid="empty-approvals">
          <div className="inline-flex p-4 rounded-full bg-emerald-50 mb-3"><Inbox size={40} className="text-emerald-600" /></div>
          <div className="font-heading font-bold text-lg">Inbox Zero! 🎉</div>
          <div className="text-sm text-slate-500 mt-1">{search || activeFilterCount ? "No requests match your search/filters." : "Nothing awaits your action right now."}</div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Checkbox checked={pageAllSelected} onCheckedChange={togglePageAll} className="rounded-md data-[state=checked]:bg-[var(--brand)] data-[state=checked]:border-[var(--brand)]" data-testid="select-all-checkbox" />
              <span className="text-xs text-slate-500">Select page</span>
            </div>
            <div className="text-xs text-slate-500">Pending Approval Requests ({filtered.length})</div>
          </div>
          <div className={viewMode === "grid" ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : "space-y-3"}>
            {pageItems.map((item) => RequestCard(item))}
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
            <div className="text-xs text-slate-500">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg h-8 w-8 p-0" data-testid="page-prev"><ChevronLeft size={16} /></Button>
              <span className="text-xs font-semibold px-2 num">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-lg h-8 w-8 p-0" data-testid="page-next"><ChevronRight size={16} /></Button>
            </div>
          </div>
        </>
      )}

      {/* Bulk confirm dialog */}
      <Dialog open={!!bulkActing} onOpenChange={(v) => !v && setBulkActing(null)}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-heading">{bulkActing?.action === "approve" ? "Approve" : "Reject"} {bulkActing?.eligible?.length} request(s)</DialogTitle>
          </DialogHeader>
          {bulkActing && (
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm">
                <div><b>{bulkActing.eligible.length}</b> request(s) will be {bulkActing.action === "approve" ? "approved" : "rejected"}.</div>
                <div className="num text-xs mt-1 text-slate-600">Total amount: <b className="text-emerald-700">{inr(bulkActing.eligible.reduce((s, i) => s + Number(i.summary?.amount || 0), 0))}</b></div>
              </div>
              {bulkActing.skipped?.length > 0 && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900" data-testid="bulk-skipped-warning">
                  <BadgeAlert size={16} className="shrink-0 mt-0.5" />
                  <div><b>{bulkActing.skipped.length}</b> payment/payroll final-step request(s) skipped — inhe individually Approve karein (Paid By / Partner / Bank chahiye).</div>
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Remarks <span className="text-[var(--danger)]">*</span> <span className="normal-case text-slate-400">(min 3 chars — applied to all)</span></div>
                <Textarea rows={3} value={bulkRemarks} onChange={(e) => setBulkRemarks(e.target.value)} placeholder="e.g. Verified & approved in bulk" className="rounded-lg" data-testid="bulk-remarks" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkActing(null)} className="rounded-lg">Cancel</Button>
            <Button onClick={runBulk} disabled={bulkBusy} className={`rounded-lg gap-1 ${bulkActing?.action === "approve" ? "brand-btn" : "bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90"} ${bulkBusy ? "opacity-60 cursor-not-allowed" : ""}`} data-testid="confirm-bulk">
              {bulkBusy ? "⏳ Processing…" : <>{bulkActing?.action === "approve" ? <Check size={14} /> : <X size={14} />} Confirm {bulkActing?.action === "approve" ? "Approve" : "Reject"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Act dialog (approve / reject with remarks) */}
      <Dialog open={!!acting} onOpenChange={(v) => !v && setActing(null)}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {isPayrollPay
                ? "Approve & Pay Payroll Batch"
                : `${acting?.action === "approve" ? "Approve" : (acting?.action === "reject" ? "Reject" : "Send Back")} ${(TYPE_META[acting?.item?.request_type] || FALLBACK_META).label}`}
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

                {/* Line items — so the approver can verify WHAT is being purchased
                    before approve / reject / send back (e.g. mess goods receipts). */}
                {Array.isArray(acting.item.summary?.items) && acting.item.summary.items.length > 0 && (
                  <div className="mt-2 border border-slate-200 rounded-md overflow-hidden bg-white" data-testid="approval-items">
                    <table className="w-full text-[12px]">
                      <thead className="bg-slate-100 text-slate-500 text-[10px] uppercase">
                        <tr>
                          <th className="text-left px-2 py-1">Item</th>
                          <th className="text-right px-2 py-1">Qty</th>
                          <th className="text-left px-2 py-1">Unit</th>
                          <th className="text-right px-2 py-1">Rate</th>
                          <th className="text-right px-2 py-1">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {acting.item.summary.items.map((l, i) => {
                          const q = Number(l.accepted_qty ?? l.qty) || 0;
                          const rate = Number(l.unit_price) || 0;
                          // Always derive the line amount from the qty & rate shown (plus any
                          // discount/tax), so the row is self-consistent and sums to the total —
                          // never trust a possibly-stale stored line_total.
                          const amount = q * rate - (Number(l.discount) || 0) + (Number(l.tax) || 0);
                          return (
                            <tr key={i} data-testid={`approval-item-${i}`}>
                              <td className="px-2 py-1 font-medium text-slate-800">{l.item_name || "—"}</td>
                              <td className="px-2 py-1 text-right num">{q}</td>
                              <td className="px-2 py-1 text-slate-500">{l.unit || l.base_unit || ""}</td>
                              <td className="px-2 py-1 text-right num">{inr(rate)}</td>
                              <td className="px-2 py-1 text-right num font-semibold">{inr(amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100 font-bold text-slate-800">
                          <td className="px-2 py-1" colSpan={4}>Total</td>
                          <td className="px-2 py-1 text-right num" data-testid="approval-items-total">{inr(acting.item.summary.items.reduce((s, l) => s + ((Number(l.accepted_qty ?? l.qty) || 0) * (Number(l.unit_price) || 0) - (Number(l.discount) || 0) + (Number(l.tax) || 0)), 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Payee details — shown for both PAYMENT and ADVANCE REQUEST so
                  approver sees exact bank/UPI target BEFORE signing off (and can
                  cross-verify with the attached cancelled cheque / QR / passbook). */}
              {(acting.item.request_type === "payment" || acting.item.request_type === "advance_request" || acting.item.request_type === "reimbursement" || acting.item.request_type === "mess_payment") && (
                (acting.item.summary?.payee_account_no || acting.item.summary?.payee_upi_id || acting.item.summary?.vendor_name || acting.item.summary?.qrn) && (
                <div className="border border-amber-200 bg-amber-50/40 p-3 text-xs space-y-2" data-testid="approval-payee-block">
                  <div className="overline font-bold text-amber-900">
                    {acting.item.request_type === "advance_request" ? "Payee Details (from Advance Request)"
                      : acting.item.request_type === "reimbursement" ? "Payee Details (Employee Bank)"
                      : acting.item.request_type === "mess_payment" ? "Payee Details (Supplier)"
                      : "Payee Details"}
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
                  <div className="overline font-bold text-blue-900 mb-2">Bill / Attachments ({acting.item.summary.attachments.length}) — cross-check before approving</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {acting.item.summary.attachments.map((a) => {
                      const url = `${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`;
                      const name = (a.filename || "").toLowerCase();
                      const ct = (a.content_type || "").toLowerCase();
                      const isImg = ct.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|heic)$/.test(name);
                      const isPdf = ct.includes("pdf") || name.endsWith(".pdf");
                      return (
                        <div key={a.id} className="border border-blue-200 bg-white rounded-md overflow-hidden" data-testid={`attach-preview-${a.id}`}>
                          <a href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 px-2 py-1 bg-blue-50 border-b border-blue-100 text-[10px] text-blue-900 font-semibold hover:underline">
                            <span className="truncate">📎 {a.filename}</span>
                            <span className="shrink-0 text-blue-700">Open ↗</span>
                          </a>
                          {isImg ? (
                            <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={a.filename} className="w-full max-h-52 object-contain bg-slate-50" loading="lazy" /></a>
                          ) : isPdf ? (
                            <iframe title={a.filename} src={`${url}#toolbar=0&navpanes=0`} className="w-full h-60 bg-slate-50 border-0" />
                          ) : (
                            <div className="px-2 py-5 text-center text-slate-400">Preview not available — click Open ↗</div>
                          )}
                        </div>
                      );
                    })}
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
                    Payment attribution {centerMandatory ? "(mandatory)" : "(optional — can be filled at Release)"}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Center {centerMandatory ? "*" : ""}</div>
                      <select
                        value={txnCenterId}
                        onChange={(e) => { setTxnCenterId(e.target.value); loadCenterPartners(e.target.value); }}
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
                        disabled={!txnCenterId}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2 disabled:opacity-60"
                        data-testid="txn-partner-select"
                      >
                        <option value="">— Auto-derive from center —</option>
                        {attrPartners.map((p) => (
                          <option key={p.partner_id} value={p.partner_id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>
                        ))}
                      </select>
                      {txnCenterId && attrPartners.length === 0 && (
                        <div className="text-[9px] text-amber-700 mt-0.5">Is center ke liye koi mapped partner nahi — auto-derive hoga.</div>
                      )}
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
                  {(acting.item.request_type === "payment" || acting.item.request_type === "reimbursement" || acting.item.request_type === "mess_payment") && bankAccounts.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Bank / Cash Account (kis account se paisa jayega) *</div>
                      <select
                        value={bankAccountId}
                        onChange={(e) => setBankAccountId(e.target.value)}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                        data-testid="bank-account-select"
                      >
                        <option value="">— Select account —</option>
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} — Balance ₹{Number(a.current_balance || 0).toLocaleString("en-IN")}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="text-[10px] text-emerald-900/80">
                    {acting.item.request_type === "advance_request"
                      ? "Advance approval hai — abhi Center/Partner/Paid-By skip kar sakte hain, Release step par bhi enter kar sakte hain. Enter karne pe automatically release txn me stamp ho jayega."
                      : acting.item.request_type === "mess_payment"
                        ? "Center, Partner aur Bank account — ye mess expense par stamp honge aur selected account ka ledger debit hoga (balance kam hoga)."
                        : "Center, Partner aur Paid By — teenon auto-created transaction pe stamp ho jayenge, jisse Dashboard mein sahi center/partner filter ke saath update dikhega."}
                  </div>
                </div>
              )}

              {/* Employee-wise salary breakdown — shown to EVERY payroll approver
                  (read-only) so they see exactly who is paid how much before approving. */}
              {acting.item.request_type === "payroll" && (payBatch?.rows || []).length > 0 && (
                <div className="border border-slate-300 bg-white" data-testid="payroll-salary-breakdown">
                  <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-200 bg-slate-50">
                    <div className="overline font-bold text-slate-700 flex items-center gap-1">
                      <Users size={12} /> Salary Breakdown · {payBatch.rows.length} employee{payBatch.rows.length > 1 ? "s" : ""}
                    </div>
                    <div className="num font-bold text-slate-900 text-sm" data-testid="breakdown-net-total">
                      Net {inr(payBatch.rows.reduce((s, r) => s + Number(r.net || 0), 0))}
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600 uppercase text-[9px]">
                        <tr>
                          <th className="text-left px-2 py-1 font-bold">Employee</th>
                          <th className="text-left px-2 py-1 font-bold">A/C No · IFSC</th>
                          <th className="text-right px-2 py-1 font-bold">Gross</th>
                          <th className="text-right px-2 py-1 font-bold">Deductions</th>
                          <th className="text-right px-2 py-1 font-bold">Net</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payBatch.rows.map((r) => (
                          <tr key={r.staff_id} className="hover:bg-slate-50" data-testid={`breakdown-row-${r.staff_id}`}>
                            <td className="px-2 py-1">
                              <b className="text-slate-800">{r.staff_name || r.staff_id?.slice(0, 8)}</b>
                              {r.employee_code && <span className="text-slate-400 ml-1">{r.employee_code}</span>}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap" data-testid={`breakdown-acct-${r.staff_id}`}>
                              {(r.bank_account_no || r.bank_account_no_masked)
                                ? <span className="font-mono text-slate-700">{r.bank_account_no || r.bank_account_no_masked}{r.ifsc ? <span className="text-slate-400"> · {r.ifsc}</span> : null}</span>
                                : <span className="text-amber-600">No bank details</span>}
                            </td>
                            <td className="px-2 py-1 text-right num text-slate-700">{inr(r.gross)}</td>
                            <td className="px-2 py-1 text-right num text-rose-600">{inr(r.deductions)}</td>
                            <td className="px-2 py-1 text-right num font-semibold text-slate-900">{inr(r.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* One-screen Approve + Record Payment — payroll final step for Accounts/Admin */}
              {isPayrollPay && (
                <div className="border border-emerald-300 bg-emerald-50/60 p-3 space-y-3" data-testid="payroll-pay-block">
                  <div className="overline font-bold text-emerald-900">
                    Record Payment (same screen — no separate step)
                  </div>

                  {/* Employee selection — partial payment */}
                  <div className="bg-white border border-emerald-200">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-emerald-200 text-[11px]">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-[10px] uppercase font-bold text-emerald-800 hover:underline"
                          onClick={() => { const n = {}; payableRows.forEach((r) => { n[r.staff_id] = true; }); setPaySel(n); }}
                          data-testid="pay-select-all"
                        >Select all</button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          className="text-[10px] uppercase font-bold text-slate-600 hover:underline"
                          onClick={() => setPaySel({})}
                          data-testid="pay-clear-all"
                        >Clear</button>
                      </div>
                      <div className="num font-bold text-emerald-900" data-testid="pay-selected-summary">
                        {paySelCount}/{payableRows.length} · {inr(paySelAmount)}
                      </div>
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-emerald-100">
                      {(payBatch?.rows || []).map((r) => {
                        const isPaid = (r.pay_status || "pending") === "paid";
                        return (
                          <label
                            key={r.staff_id}
                            className={`flex items-center gap-2 px-2 py-1.5 text-[12px] ${isPaid ? "bg-slate-50 opacity-70" : "hover:bg-emerald-50 cursor-pointer"}`}
                            data-testid={`pay-row-${r.staff_id}`}
                          >
                            <input
                              type="checkbox"
                              disabled={isPaid}
                              checked={isPaid ? true : !!paySel[r.staff_id]}
                              onChange={(e) => setPaySel((s) => ({ ...s, [r.staff_id]: e.target.checked }))}
                              data-testid={`pay-check-${r.staff_id}`}
                            />
                            <span className="flex-1 truncate">
                              <b>{r.staff_name || r.staff_id?.slice(0, 8)}</b>
                              <span className="text-slate-500 ml-1">{r.employee_code || ""}</span>
                            </span>
                            <span className="num font-semibold text-slate-800">{inr(r.net)}</span>
                            {isPaid && <span className="text-[9px] uppercase font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-1">Paid</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Partner *</div>
                      <select
                        value={payForm.partner_id}
                        onChange={(e) => setPayForm((f) => ({ ...f, partner_id: e.target.value }))}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                        data-testid="payroll-partner-select"
                      >
                        <option value="">— Select partner —</option>
                        {payPartners.map((p) => (
                          <option key={p.partner_id} value={p.partner_id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Paid By *</div>
                      <select
                        value={paidByUserId}
                        onChange={(e) => setPaidByUserId(e.target.value)}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                        data-testid="payroll-paidby-select"
                      >
                        <option value="">— Select payer —</option>
                        {payers.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Bank / Debit Account *</div>
                      <select
                        value={payForm.bank_account_id}
                        onChange={(e) => setPayForm((f) => ({ ...f, bank_account_id: e.target.value }))}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                        data-testid="payroll-bank-select"
                      >
                        <option value="">— Select account —</option>
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} — ₹{Number(a.current_balance || 0).toLocaleString("en-IN")}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Payment Mode *</div>
                      <select
                        value={payForm.method}
                        onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                        data-testid="payroll-method-select"
                      >
                        <option value="neft">NEFT</option>
                        <option value="rtgs">RTGS</option>
                        <option value="imps">IMPS</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="upi">UPI</option>
                        <option value="cheque">Cheque</option>
                        <option value="cash">Cash</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">Payment Date *</div>
                      <input
                        type="date"
                        value={payForm.payment_date}
                        onChange={(e) => setPayForm((f) => ({ ...f, payment_date: e.target.value }))}
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2"
                        data-testid="payroll-date"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-emerald-900 mb-1">UTR / Ref</div>
                      <input
                        value={payForm.utr}
                        onChange={(e) => setPayForm((f) => ({ ...f, utr: e.target.value }))}
                        placeholder="e.g. UTR12345678"
                        className="w-full text-sm border border-emerald-300 bg-white rounded-none p-2 font-mono"
                        data-testid="payroll-utr"
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-emerald-900/80">
                    {paySelCount < payableRows.length
                      ? "Sirf selected employees ko ab pay kiya jaayega — baaki PENDING rahenge aur batch 'Partially Paid' ho jaayega (baad me Retry se pay kar sakte hain)."
                      : "Approve karte hi payment transaction create hoga aur saare employees PAID ho jaayenge."}
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
                  {isPayrollPay
                    ? "Approve & Record Payment"
                    : `Confirm ${acting?.action === "approve" ? "Approve" : (acting?.action === "reject" ? "Reject" : "Send Back")}`}
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
  return Math.max(0, Math.floor((Date.now() - oldest) / (1000 * 60 * 60 * 24)));
}

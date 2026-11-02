import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useFY } from "@/context/FYContext";
import { useLang } from "@/context/LangContext";
import { inr } from "@/lib/i18n";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Download, Upload, Paperclip, List, CheckSquare,
  Search, Filter, X, ChevronDown, ChevronLeft, ChevronRight, Eye, Check, Ban,
  FileText, Clock, Building2, Rows, LayoutGrid, TrendingUp, TrendingDown,
  Wallet, CircleCheck, CircleX, Hourglass, ListChecks, ArrowRightLeft, RefreshCw,
  ShieldAlert, AlertTriangle, Percent,
} from "lucide-react";
import PrintButton from "@/components/PrintButton";
import FYSwitcher from "@/components/FYSwitcher";
import BulkDeleteDialog from "@/components/BulkDeleteDialog";
import SubmitButton from "@/components/SubmitButton";

const TXN_TYPES = ["investment", "income", "expense"];
const ENTITY_TYPES = ["company", "partner", "center", "project"];

const TYPE_STYLE = {
  income: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expense: "bg-rose-50 text-rose-700 border-rose-200",
  investment: "bg-blue-50 text-blue-700 border-blue-200",
  deduction: "bg-amber-50 text-amber-700 border-amber-200",
};
const TYPE_ICON = { income: TrendingUp, expense: TrendingDown, investment: ArrowRightLeft, deduction: Percent };

// TDS deductions are stored as type=expense but shown as a distinct "Deduction".
const txnDispType = (it) => (it && it.source === "tds_deduction" ? "deduction" : (it ? it.type : undefined));
const STATUS_STYLE = {
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

function StatusBadge({ status, title }) {
  const s = status || "pending";
  const cls = STATUS_STYLE[s] || "bg-slate-50 text-slate-600 border-slate-200";
  const dot = s === "approved" ? "bg-emerald-500" : s === "rejected" ? "bg-rose-500" : s === "pending" ? "bg-amber-500" : "bg-slate-400";
  return (
    <span title={title || ""} className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="capitalize">{s}</span>
    </span>
  );
}

const PAY_STYLE = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partially_paid: "bg-amber-50 text-amber-700 border-amber-200",
  unpaid: "bg-rose-50 text-rose-700 border-rose-200",
};
function PaymentBadge({ status }) {
  if (!status) return null;
  const cls = PAY_STYLE[status] || "bg-slate-50 text-slate-600 border-slate-200";
  const label = status === "partially_paid" ? "Partially Paid" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${cls}`} data-testid="payment-badge">
      {label}
    </span>
  );
}

function TypeBadge({ type, t }) {
  const Icon = TYPE_ICON[type] || Wallet;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border ${TYPE_STYLE[type] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
      <Icon size={11} /> {t(type)}
    </span>
  );
}

export default function Transactions() {
  const { t } = useLang();
  const { user } = useAuth();
  const canEdit = ["admin", "manager", "center_manager", "partner", "accountant"].includes(user?.role);
  const canDelete = user?.role === "admin";
  const isAdmin = user?.role === "admin";
  const isPartner = user?.role === "partner";
  const myPartnerId = user?.assigned_partner_id || null;
  const [entities, setEntities] = useState({ company: [], partner: [], center: [], project: [] });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);   // initial / filter-change fetch (content skeleton)
  const [error, setError] = useState(null);        // last fetch error (surfaced, never silently swallowed)
  // Server-side filters (everything EXCEPT status, which we handle client-side
  // so the KPI counts stay accurate regardless of the active status card).
  const [filters, setFilters] = useState({ type: "", company_id: "", partner_id: "", center_id: "", project_id: "", work_order_id: "", payment_status: "", start: "", end: "" });
  const [statusFilter, setStatusFilter] = useState(""); // "" | pending | approved | rejected
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ field: "date", dir: "desc" });
  const [view, setView] = useState("table"); // table | compact | grouped
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const loadAudit = async () => {
    setAuditLoading(true);
    try { const { data } = await api.get("/admin/mess-partner-audit"); setAuditData(data); }
    catch (e) { toast.error(formatError(e)); }
    finally { setAuditLoading(false); }
  };
  useEffect(() => { if (auditOpen && !auditData) loadAudit(); }, [auditOpen]); // eslint-disable-line
  const runFix = async () => {
    if (!window.confirm("Set all listed unpaid mess expenses to Unassigned partner? This is logged and non-destructive, but will clear the partner on these transactions.")) return;
    setFixing(true);
    try {
      const { data } = await api.post("/admin/mess-partner-audit/fix", {});
      toast.success(data.message || `${data.fixed} fixed`);
      setAuditData(null); await loadAudit(); load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setFixing(false); }
  };

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [itemSuggestions, setItemSuggestions] = useState([]);
  const [drawer, setDrawer] = useState(null); // selected txn for details drawer
  const [drawerTab, setDrawerTab] = useState("overview");

  useEffect(() => {
    api.get("/items/suggestions").then((r) => setItemSuggestions(r.data || [])).catch(() => {});
  }, [open]);
  const emptyForm = { type: "expense", amount: "", date: new Date().toISOString().slice(0, 10), description: "", company_id: "", partner_id: "", center_id: "", project_id: "", work_order_id: "", items: [], attachments: [] };
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef(null);
  const attachRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  // Work Orders for the selected center (reused from Batch Management; mandatory for income & expense booking)
  const [workOrders, setWorkOrders] = useState([]);
  const [woLoading, setWoLoading] = useState(false);
  const [woPickerOpen, setWoPickerOpen] = useState(false);
  useEffect(() => {
    const woNeeded = form.type === "expense" || form.type === "income";
    if (!open || !woNeeded || !form.center_id) { setWorkOrders([]); return; }
    let cancelled = false;
    setWoLoading(true);
    // ensure_demo=true → if the center has no WO yet, backend auto-creates a
    // placeholder "DEMO Work Order" so the mandatory picker is never empty.
    api.get("/work-orders", { params: { center_id: form.center_id, include_inactive: false, ensure_demo: true } })
      .then((r) => { if (!cancelled) setWorkOrders(r.data || []); })
      .catch(() => { if (!cancelled) setWorkOrders([]); })
      .finally(() => { if (!cancelled) setWoLoading(false); });
    return () => { cancelled = true; };
  }, [open, form.type, form.center_id]);

  // Work Orders for the Advanced Filters drawer — all accessible, optionally scoped to the center filter.
  const [filterWorkOrders, setFilterWorkOrders] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const p = { include_inactive: true };
    if (filters.center_id) p.center_id = filters.center_id;
    api.get("/work-orders", { params: p })
      .then((r) => { if (!cancelled) setFilterWorkOrders(r.data || []); })
      .catch(() => { if (!cancelled) setFilterWorkOrders([]); });
    return () => { cancelled = true; };
  }, [filters.center_id]);

  const loadEntities = () =>
    Promise.all(ENTITY_TYPES.map((tt) => api.get(`/entities/${tt}`))).then((r) => {
      const e = {}; ENTITY_TYPES.forEach((tt, i) => (e[tt] = r[i].data)); setEntities(e);
    });

  const [pendingMyApproval, setPendingMyApproval] = useState(false);
  const { fy } = useFY();
  const params = useMemo(() => {
    const p = {}; Object.entries(filters).forEach(([k, v]) => v && (p[k] = v));
    if (pendingMyApproval) p.status = "pending";
    if (fy && fy !== "all") p.fy = fy;
    return p;
  }, [filters, pendingMyApproval, fy]);

  // `background` keeps the current rows mounted (used after mutations / silent
  // refresh) so the table never flashes empty; the initial & filter-change
  // fetches show the content skeleton. API errors are surfaced (error state +
  // toast) and NEVER converted into a false empty list.
  const load = (background = false) => {
    if (!background) setLoading(true);
    setError(null);
    return api.get("/transactions", { params }).then((r) => {
      const list = Array.isArray(r.data) ? r.data : [];
      if (pendingMyApproval && isPartner && myPartnerId) {
        setItems(list.filter((it) =>
          it.status === "pending" && it.created_by !== user.id &&
          it.partner_id && it.partner_id !== myPartnerId
        ));
      } else {
        setItems(list);
      }
    }).catch((e) => {
      const msg = formatError(e);
      setError(msg);
      if (background) toast.error(msg);  // keep existing rows visible, surface the failure
    }).finally(() => {
      if (!background) setLoading(false);
    });
  };

  const nameOf = (etype, id) => entities[etype].find((e) => e.id === id)?.name || "—";

  // ---- KPIs from the loaded (server-filtered, status-agnostic) set ----
  const kpis = useMemo(() => {
    const total = items.length;
    const expense = items.filter((i) => i.type === "expense" && i.source !== "tds_deduction").reduce((s, i) => s + Number(i.amount || 0), 0);
    const deduction = items.filter((i) => i.source === "tds_deduction").reduce((s, i) => s + Number(i.amount || 0), 0);
    const pending = items.filter((i) => (i.status || "pending") === "pending").length;
    const approved = items.filter((i) => i.status === "approved").length;
    const rejected = items.filter((i) => i.status === "rejected").length;
    return { total, expense, deduction, pending, approved, rejected };
  }, [items]);

  // ---- Client filter (status + search) + sort ----
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let arr = items.filter((it) => {
      if (statusFilter && (it.status || "pending") !== statusFilter) return false;
      if (!needle) return true;
      const hay = [
        it.description, it.qrn, it.paid_by_name, String(it.amount),
        nameOf("company", it.company_id), nameOf("partner", it.partner_id),
        nameOf("center", it.center_id), nameOf("project", it.project_id),
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
    const { field, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    arr = [...arr].sort((a, b) => {
      let av, bv;
      if (field === "amount") { av = Number(a.amount || 0); bv = Number(b.amount || 0); }
      else { av = a.date || ""; bv = b.date || ""; }
      if (av === bv) return (b.created_at || "").localeCompare(a.created_at || "");
      return av < bv ? -mul : mul;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, statusFilter, search, sort, entities]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageItems = useMemo(() => {
    if (view === "grouped") return filtered;
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize, view]);

  useEffect(() => { setPage(1); }, [statusFilter, search, filters, pageSize, view]);

  const toggleSort = (field) => setSort((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "desc" }));
  const sortIcon = (field) => (sort.field !== field ? "↕" : sort.dir === "asc" ? "↑" : "↓");

  const approveTxn = async (id) => {
    try { await api.post(`/transactions/${id}/approve`); load(true); toast.success("Approved"); setDrawer(null); }
    catch (e) { toast.error(formatError(e)); }
  };
  const rejectTxn = async (id) => {
    const reason = window.prompt("Reason (optional):") || "";
    try { await api.post(`/transactions/${id}/reject`, { reason }); load(true); toast.success("Rejected"); setDrawer(null); }
    catch (e) { toast.error(formatError(e)); }
  };
  const partnerApproveTxn = async (id) => {
    try { await api.post(`/transactions/${id}/partner-approve`); load(true); toast.success("Approved (partner cross-approval)"); setDrawer(null); }
    catch (e) { toast.error(formatError(e)); }
  };
  const canPartnerCrossApprove = (it) => {
    if (!isPartner || !myPartnerId) return false;
    if (!it || it.status !== "pending") return false;
    if (it.created_by === user.id) return false;
    if (!it.partner_id || it.partner_id === myPartnerId) return false;
    return true;
  };

  const eligibleIds = items.filter((it) => it.status !== "approved").map((it) => it.id);
  const pageIds = pageItems.map((it) => it.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (pageIds.every((id) => s.has(id)) ? new Set() : new Set(pageIds)));
  const bulkApprove = async () => {
    const ids = Array.from(selected).filter((id) => eligibleIds.includes(id));
    if (ids.length === 0) { toast.error("Nothing to approve"); return; }
    try { const { data } = await api.post("/transactions/bulk-approve", { ids }); setSelected(new Set()); await load(true); toast.success(`Approved ${data.approved} transaction${data.approved === 1 ? "" : "s"}`); }
    catch (e) { toast.error(formatError(e)); }
  };

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const bulkDelete = async () => {
    setBulkDeleteBusy(true);
    try {
      const ids = Array.from(selected);
      const { data } = await api.post("/transactions/bulk-delete", { ids });
      setSelected(new Set()); setBulkDeleteOpen(false); await load(true);
      toast.success(`Deleted ${data.deleted} transaction${data.deleted === 1 ? "" : "s"}`);
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkDeleteBusy(false); }
  };

  // Admin bulk-assign: fill chosen context fields on all selected rows (only where empty).
  const EMPTY_BULK = { company_id: "", partner_id: "", center_id: "", project_id: "", work_order_id: "" };
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignBusy, setBulkAssignBusy] = useState(false);
  const [bulkAssign, setBulkAssign] = useState(EMPTY_BULK);
  const doBulkAssign = async () => {
    const ids = Array.from(selected);
    const fields = Object.fromEntries(Object.entries(bulkAssign).filter(([, v]) => v));
    if (ids.length === 0) { toast.error("Koi transaction select nahi hai"); return; }
    if (Object.keys(fields).length === 0) { toast.error("Kam se kam ek field chunein"); return; }
    setBulkAssignBusy(true);
    try {
      const { data } = await api.post("/transactions/bulk-assign", { ids, ...fields });
      setBulkAssignOpen(false); setBulkAssign(EMPTY_BULK); setSelected(new Set()); await load(true);
      toast.success(`${data.updated} transaction${data.updated === 1 ? "" : "s"} updated — sirf khaali fields bhari gayi`);
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkAssignBusy(false); }
  };

  useEffect(() => { loadEntities(); }, []);
  useEffect(() => { load(); }, [params]);

  const openNewType = (type) => { setEditing(null); setForm({ ...emptyForm, type }); setOpen(true); };
  const openEdit = (it) => {
    setEditing(it);
    setForm({
      type: it.type, amount: it.amount, date: it.date, description: it.description || "",
      company_id: it.company_id || "", partner_id: it.partner_id || "",
      center_id: it.center_id || "", project_id: it.project_id || "",
      work_order_id: it.work_order_id || "",
      items: it.items || [], attachments: it.attachments || [],
    });
    setDrawer(null);
    setOpen(true);
  };

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { name: "", quantity: 1, rate: 0, amount: 0 }] }));
  const updateItem = (idx, key, val) => setForm((f) => {
    const items = f.items.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, [key]: val };
      if (key === "quantity" || key === "rate") {
        const q = parseFloat(next.quantity || 0); const r = parseFloat(next.rate || 0);
        next.amount = +(q * r).toFixed(2);
      }
      return next;
    });
    return { ...f, items };
  });
  const removeItem = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const uploadAttachment = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((s) => ({ ...s, attachments: [...s.attachments, data] }));
      toast.success("Attached");
    } catch (err) { toast.error(formatError(err)); }
    finally { setUploading(false); e.target.value = ""; }
  };
  const removeAttachment = (id) => setForm((s) => ({ ...s, attachments: s.attachments.filter((a) => a.id !== id) }));
  const itemsTotal = form.items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

  const save = async () => {
    try {
      const computedAmount = form.items.length ? itemsTotal : parseFloat(form.amount);
      if (!(computedAmount > 0)) { toast.error("Amount must be > 0"); return; }
      if ((form.type === "expense" || form.type === "income") && !editing) {
        if (!form.center_id) { toast.error(`${t(form.type)} ke liye Center select karein`); return; }
        if (!form.work_order_id) { toast.error("Work Order select karna zaroori hai"); return; }
      }
      const payload = { ...form, amount: computedAmount };
      ENTITY_TYPES.forEach((et) => { if (!payload[`${et}_id`]) payload[`${et}_id`] = null; });
      if (editing) await api.put(`/transactions/${editing.id}`, payload);
      else await api.post("/transactions", payload);
      setOpen(false); load(); toast.success("Saved");
    } catch (e) { toast.error(formatError(e)); }
  };

  const [deleting, setDeleting] = useState(new Set());
  const remove = async (it) => {
    if (deleting.has(it.id)) return;
    if (!window.confirm(t("confirm_delete"))) return;
    setDeleting((s) => new Set(s).add(it.id));
    setItems((cur) => cur.filter((x) => x.id !== it.id));
    setDrawer(null);
    try { await api.delete(`/transactions/${it.id}`); toast.success("Deleted"); }
    catch (e) { toast.error(formatError(e)); load(true); }
    finally { setDeleting((s) => { const n = new Set(s); n.delete(it.id); return n; }); }
  };

  const exportCsv = () => {
    const header = ["type", "amount", "date", "financial_year", "description", "company", "partner", "center", "project"];
    const src = selected.size > 0 ? filtered.filter((i) => selected.has(i.id)) : filtered;
    const rows = src.map((it) => [
      it.type, it.amount, it.date, it.financial_year || "", (it.description || "").replace(/"/g, '""'),
      nameOf("company", it.company_id), nameOf("partner", it.partner_id),
      nameOf("center", it.center_id), nameOf("project", it.project_id),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "")}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `transactions_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const importCsv = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      const { data } = await api.post("/transactions/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported ${data.inserted}` + (data.errors?.length ? ` (${data.errors.length} errors)` : ""));
      loadEntities(); load(true);
    } catch (err) { toast.error(formatError(err)); }
    finally { e.target.value = ""; }
  };

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));
  const activeChips = [
    filters.type && { k: "type", label: `${t("type")}: ${t(filters.type)}`, clear: () => setF("type", "") },
    statusFilter && { k: "status", label: `${t("status")}: ${t(statusFilter)}`, clear: () => setStatusFilter("") },
    filters.company_id && { k: "company", label: `${t("company")}: ${nameOf("company", filters.company_id)}`, clear: () => setF("company_id", "") },
    filters.partner_id && { k: "partner", label: `${t("partner")}: ${nameOf("partner", filters.partner_id)}`, clear: () => setF("partner_id", "") },
    filters.center_id && { k: "center", label: `${t("center")}: ${nameOf("center", filters.center_id)}`, clear: () => setF("center_id", "") },
    filters.project_id && { k: "project", label: `${t("project")}: ${nameOf("project", filters.project_id)}`, clear: () => setF("project_id", "") },
    filters.work_order_id && { k: "work_order", label: `Work Order: ${(filterWorkOrders.find((w) => w.id === filters.work_order_id)?.wo_number) || filters.work_order_id}`, clear: () => setF("work_order_id", "") },
    filters.payment_status && { k: "payment_status", label: `Payment: ${filters.payment_status === "partially_paid" ? "Partially Paid" : filters.payment_status.charAt(0).toUpperCase() + filters.payment_status.slice(1)}`, clear: () => setF("payment_status", "") },
    filters.start && { k: "start", label: `From: ${filters.start}`, clear: () => setF("start", "") },
    filters.end && { k: "end", label: `To: ${filters.end}`, clear: () => setF("end", "") },
    search && { k: "search", label: `“${search}”`, clear: () => setSearch("") },
  ].filter(Boolean);
  const clearAll = () => { setFilters({ type: "", company_id: "", partner_id: "", center_id: "", project_id: "", work_order_id: "", payment_status: "", start: "", end: "" }); setStatusFilter(""); setSearch(""); };

  const KPI = ({ id, icon: Icon, label, value, tone, active, onClick, sub }) => (
    <button
      onClick={onClick}
      data-testid={`kpi-${id}`}
      className={`text-left bg-white border rounded-xl p-4 transition-all hover:shadow-md hover:-translate-y-0.5 ${active ? "border-[var(--brand)] ring-1 ring-[var(--brand)]/30 shadow-sm" : "border-slate-200"}`}
    >
      <div className="flex items-center gap-3">
        <span className={`w-10 h-10 rounded-lg flex items-center justify-center ${tone}`}><Icon size={18} /></span>
        <div className="min-w-0">
          <div className="overline text-[10px] text-slate-500 truncate">{label}</div>
          <div className="text-xl font-heading font-black tracking-tight truncate">{value}</div>
        </div>
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
    </button>
  );

  const rowPad = view === "compact" ? "py-2 px-3" : "py-3 px-4";

  const renderRow = (it) => {
    const attN = (it.attachments?.length || 0);
    const itemN = (it.items?.length || 0);
    const dt = txnDispType(it);
    return (
      <tr
        key={it.id}
        onClick={() => { setDrawer(it); setDrawerTab("overview"); }}
        className="border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer transition-colors"
        data-testid={`txn-row-${it.id}`}
      >
        {isAdmin && (
          <td className={rowPad} onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleOne(it.id)} className="cursor-pointer" data-testid={`select-txn-${it.id}`} />
          </td>
        )}
        <td className={`${rowPad} whitespace-nowrap text-slate-600 num`}>{it.date}</td>
        <td className={rowPad}>
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={dt} t={t} />
            {attN > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500" title={`${attN} attachments`}><Paperclip size={11} /> {attN}</span>}
            {itemN > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600" title={`${itemN} items`}><List size={11} /> {itemN}</span>}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-800 truncate max-w-[240px]">{it.description || "—"}</div>
          {(it.qrn || it.paid_by_name) && (
            <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px]">
              {it.qrn && <span className="border border-blue-200 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono">QRN {it.qrn}</span>}
              {it.paid_by_name && <span className="border border-emerald-200 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">✓ {it.paid_by_name}</span>}
            </div>
          )}
        </td>
        <td className={`${rowPad} text-slate-700`}>{nameOf("company", it.company_id)}</td>
        <td className={rowPad} data-testid={`txn-wo-${it.id}`}>
          {it.work_order_no
            ? <span className="font-mono text-[11px] px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded whitespace-nowrap">{it.work_order_no}</span>
            : <span className="text-slate-300">—</span>}
        </td>
        <td className={`${rowPad} text-right whitespace-nowrap`}>
          <span className={`text-base font-heading font-black tracking-tight ${dt === "income" ? "text-emerald-600" : dt === "deduction" ? "text-amber-600" : dt === "expense" ? "text-rose-600" : "text-slate-800"}`}>{inr(it.amount)}</span>
          {it.payment_status && (
            <div className="mt-0.5 text-[10px] text-slate-500 num" data-testid={`txn-paid-${it.id}`}>
              Paid {inr(it.paid_amount || 0)} · Bal <span className={Number(it.balance) > 0 ? "text-rose-600 font-semibold" : "text-emerald-600"}>{inr(it.balance != null ? it.balance : it.amount)}</span>
            </div>
          )}
        </td>
        {view !== "compact" && (
          <td className={`${rowPad} text-[11px] text-slate-500 leading-5`}>
            <div><span className="text-slate-400">Partner:</span> {nameOf("partner", it.partner_id)}</div>
            <div><span className="text-slate-400">Center:</span> {nameOf("center", it.center_id)}</div>
            <div><span className="text-slate-400">Project:</span> {nameOf("project", it.project_id)}</div>
          </td>
        )}
        <td className={rowPad}>
          <StatusBadge status={it.status} title={it.rejected_reason} />
          {it.payment_status && <div className="mt-1"><PaymentBadge status={it.payment_status} /></div>}
          {(it.status || "pending") === "pending" && it.pending_at && (
            <div className="mt-1 text-[10px] text-amber-700" data-testid={`pending-at-${it.id}`}>Pending at <span className="font-medium">{it.pending_at}</span></div>
          )}
        </td>
        {canEdit && (
          <td className={`${rowPad} text-right`} onClick={(e) => e.stopPropagation()}>
            <div className="inline-flex gap-0.5 items-center">
              {isAdmin && it.status !== "approved" && (
                <Button size="icon" variant="ghost" onClick={() => approveTxn(it.id)} className="h-8 w-8 rounded-lg text-emerald-600 hover:bg-emerald-50" title={t("approve")} data-testid={`approve-${it.id}`}><Check size={15} /></Button>
              )}
              {isAdmin && it.status !== "rejected" && (
                <Button size="icon" variant="ghost" onClick={() => rejectTxn(it.id)} className="h-8 w-8 rounded-lg text-rose-600 hover:bg-rose-50" title={t("reject")} data-testid={`reject-${it.id}`}><Ban size={15} /></Button>
              )}
              {canPartnerCrossApprove(it) && (
                <Button size="icon" variant="ghost" onClick={() => partnerApproveTxn(it.id)} className="h-8 w-8 rounded-lg text-emerald-600 border border-emerald-200" title="Partner approve" data-testid={`partner-approve-${it.id}`}><CheckSquare size={15} /></Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => setDrawer(it)} className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100" title="View"><Eye size={15} /></Button>
              <Button size="icon" variant="ghost" onClick={() => openEdit(it)} className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100" title={t("edit")}><Pencil size={14} /></Button>
              {canDelete && <Button size="icon" variant="ghost" disabled={deleting.has(it.id)} onClick={() => remove(it)} className="h-8 w-8 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40" title={t("delete")}><Trash2 size={14} /></Button>}
            </div>
          </td>
        )}
      </tr>
    );
  };

  const colCount = 6 + (isAdmin ? 1 : 0) + (view !== "compact" ? 1 : 0) + (canEdit ? 1 : 0);
  const kpiLoading = loading && items.length === 0;
  const hasActiveFilters = activeChips.length > 0 || pendingMyApproval || (fy && fy !== "all");
  const Skel = ({ w = "w-10" }) => <span className={`inline-block h-5 ${w} bg-slate-200 rounded animate-pulse align-middle`} />;
  const groups = useMemo(() => {
    if (view !== "grouped") return null;
    const order = ["pending", "approved", "rejected"];
    const map = {};
    filtered.forEach((it) => { const s = it.status || "pending"; (map[s] = map[s] || []).push(it); });
    return order.filter((s) => map[s]?.length).map((s) => ({ status: s, rows: map[s] }));
  }, [filtered, view]);

  return (
    <div className="space-y-4" data-testid="transactions-page">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <span>{t("grp_finance") || "Finance & Accounting"}</span>
            <ChevronRight size={12} />
            <span className="text-slate-600 font-medium">{t("transactions")}</span>
          </div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t("transactions")}</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">Manage all financial transactions, expenses and payments across your organization.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FYSwitcher variant="inline" />
          <PrintButton />
          {isAdmin && <Button variant="outline" onClick={() => setAuditOpen(true)} className="rounded-lg gap-2 text-amber-700 border-amber-300 hover:bg-amber-50" data-testid="btn-partner-audit"><ShieldAlert size={14} /> Partner Audit</Button>}
          <Button variant="outline" onClick={exportCsv} className="rounded-lg gap-2" data-testid="btn-export"><Download size={14} /> {t("export_csv")}</Button>
          {canEdit && (
            <>
              <input ref={fileRef} type="file" accept=".csv" hidden onChange={importCsv} data-testid="csv-file" />
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="rounded-lg gap-2" data-testid="btn-import"><Upload size={14} /> {t("import_csv")}</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="brand-btn rounded-lg gap-2" data-testid="btn-new-txn"><Plus size={16} /> {t("new_transaction")} <ChevronDown size={14} /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openNewType("expense")} data-testid="new-type-expense"><TrendingDown size={14} className="mr-2 text-rose-600" /> {t("expense")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openNewType("income")} data-testid="new-type-income"><TrendingUp size={14} className="mr-2 text-emerald-600" /> {t("income")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openNewType("investment")} data-testid="new-type-investment"><ArrowRightLeft size={14} className="mr-2 text-blue-600" /> {t("investment")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI id="total" icon={ListChecks} label="Total Transactions" value={kpiLoading ? <Skel /> : kpis.total} tone="bg-blue-50 text-blue-600" active={!statusFilter && !filters.type} onClick={() => { setStatusFilter(""); setF("type", ""); }} />
        <KPI id="expense" icon={Wallet} label="Total Expense" value={kpiLoading ? <Skel w="w-20" /> : inr(kpis.expense)} tone="bg-rose-50 text-rose-600" active={filters.type === "expense"} onClick={() => setF("type", filters.type === "expense" ? "" : "expense")} />
        <KPI id="deduction" icon={Percent} label={t("total_deductions")} value={kpiLoading ? <Skel w="w-20" /> : inr(kpis.deduction)} tone="bg-amber-50 text-amber-600" active={filters.type === "deduction"} onClick={() => setF("type", filters.type === "deduction" ? "" : "deduction")} />
        <KPI id="pending" icon={Hourglass} label="Pending Approval" value={kpiLoading ? <Skel /> : kpis.pending} tone="bg-amber-50 text-amber-600" active={statusFilter === "pending"} onClick={() => setStatusFilter(statusFilter === "pending" ? "" : "pending")} />
        <KPI id="approved" icon={CircleCheck} label="Approved" value={kpiLoading ? <Skel /> : kpis.approved} tone="bg-emerald-50 text-emerald-600" active={statusFilter === "approved"} onClick={() => setStatusFilter(statusFilter === "approved" ? "" : "approved")} />
        <KPI id="rejected" icon={CircleX} label="Rejected" value={kpiLoading ? <Skel /> : kpis.rejected} tone="bg-rose-50 text-rose-600" active={statusFilter === "rejected"} onClick={() => setStatusFilter(statusFilter === "rejected" ? "" : "rejected")} />
      </div>

      {/* Background-refresh error banner — shown only when we still have rows on
          screen (initial-load failures render in the table with a Retry). */}
      {error && items.length > 0 && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-sm" data-testid="txn-refresh-error">
          <CircleX size={15} />
          <span className="flex-1">Couldn’t refresh transactions: {error}</span>
          <Button size="sm" variant="outline" onClick={() => load()} className="rounded-lg h-7 gap-1.5 border-rose-300 text-rose-700" data-testid="txn-refresh-retry"><RefreshCw size={13} /> Retry</Button>
        </div>
      )}

      {isPartner && (
        <div className="flex items-center gap-2 border-l-2 border-[var(--brand)] bg-blue-50 px-3 py-2 rounded-r-lg">
          <input type="checkbox" id="pending-my-approval" checked={pendingMyApproval} onChange={(e) => setPendingMyApproval(e.target.checked)} data-testid="filter-pending-my-approval" />
          <label htmlFor="pending-my-approval" className="text-sm cursor-pointer">
            <span className="font-medium">Show only transactions awaiting MY partner-approval</span>
          </label>
        </div>
      )}

      {/* Smart filter toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by transaction, partner, reference…" className="rounded-lg pl-8 h-9" data-testid="txn-search" />
          </div>
          <Select value={statusFilter || "__all"} onValueChange={(v) => setStatusFilter(v === "__all" ? "" : v)}>
            <SelectTrigger className="rounded-lg h-9 w-[130px]" data-testid="filter-status"><SelectValue placeholder={t("status")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("status")}: {t("all")}</SelectItem>
              <SelectItem value="pending">{t("pending")}</SelectItem>
              <SelectItem value="approved">{t("approved")}</SelectItem>
              <SelectItem value="rejected">{t("rejected")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.type || "__all"} onValueChange={(v) => setF("type", v === "__all" ? "" : v)}>
            <SelectTrigger className="rounded-lg h-9 w-[120px]" data-testid="filter-type"><SelectValue placeholder={t("type")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("type")}: {t("all")}</SelectItem>
              {TXN_TYPES.map((tt) => <SelectItem key={tt} value={tt}>{t(tt)}</SelectItem>)}
              <SelectItem value="deduction">{t("deduction")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setFiltersOpen(true)} className="rounded-lg h-9 gap-2" data-testid="btn-advanced-filters"><Filter size={14} /> Advanced Filters</Button>

          {/* View options */}
          <div className="ml-auto inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {[["table", Rows, "Table"], ["compact", List, "Compact"], ["grouped", LayoutGrid, "Grouped"]].map(([v, Icon, lbl]) => (
              <button key={v} onClick={() => setView(v)} data-testid={`view-${v}`} className={`inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium transition-colors ${view === v ? "bg-[var(--brand)] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                <Icon size={13} /> {lbl}
              </button>
            ))}
          </div>
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
            <span className="text-[11px] text-slate-400 uppercase tracking-wide">Active Filters:</span>
            {activeChips.map((c) => (
              <span key={c.k} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs" data-testid={`chip-${c.k}`}>
                {c.label}
                <button onClick={c.clear} className="hover:text-blue-900"><X size={12} /></button>
              </span>
            ))}
            <button onClick={clearAll} className="text-xs text-rose-600 hover:underline ml-1" data-testid="clear-all-filters">Clear All</button>
          </div>
        )}
      </div>

      {/* Bulk toolbar */}
      {isAdmin && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-slate-900 text-white rounded-xl px-4 py-2.5" data-testid="bulk-toolbar">
          <span className="text-sm font-medium">{selected.size} transaction{selected.size === 1 ? "" : "s"} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={bulkApprove} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 gap-1.5" data-testid="btn-bulk-approve"><Check size={14} /> Approve</Button>
            <Button size="sm" onClick={() => setBulkAssignOpen(true)} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 gap-1.5" data-testid="btn-bulk-assign"><ListChecks size={14} /> Assign</Button>
            <Button size="sm" variant="outline" onClick={exportCsv} className="rounded-lg gap-1.5 bg-transparent text-white border-white/30 hover:bg-white/10"><Download size={14} /> Export</Button>
            <Button size="sm" variant="outline" onClick={() => setBulkDeleteOpen(true)} className="rounded-lg gap-1.5 bg-transparent text-rose-300 border-rose-400/40 hover:bg-rose-500/10" data-testid="btn-bulk-delete-txn"><Trash2 size={14} /> Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="rounded-lg text-white/70 hover:bg-white/10"><X size={14} /></Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="txn-table">
        <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                {isAdmin && <th className="text-left py-3 px-4 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={pageIds.length === 0} className="cursor-pointer" data-testid="select-all-txn" /></th>}
                <th className="text-left py-3 px-4"><button onClick={() => toggleSort("date")} className="inline-flex items-center gap-1" data-testid="sort-date">{t("date")} <span className={sort.field === "date" ? "text-[var(--brand)]" : "opacity-40"}>{sortIcon("date")}</span></button></th>
                <th className="text-left py-3 px-4">Transaction</th>
                <th className="text-left py-3 px-4">Organization</th>
                <th className="text-left py-3 px-4">Work Order</th>
                <th className="text-right py-3 px-4"><button onClick={() => toggleSort("amount")} className="inline-flex items-center gap-1" data-testid="sort-amount">{t("amount")} <span className={sort.field === "amount" ? "text-[var(--brand)]" : "opacity-40"}>{sortIcon("amount")}</span></button></th>
                {view !== "compact" && <th className="text-left py-3 px-4">Allocation</th>}
                <th className="text-left py-3 px-4">{t("status")}</th>
                {canEdit && <th className="text-right py-3 px-4">{t("actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} data-testid="txn-skeleton-row">
                    {Array.from({ length: colCount }).map((__, j) => (
                      <td key={j} className={rowPad}><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : error && items.length === 0 ? (
                <tr><td colSpan={colCount} className="py-14">
                  <div className="flex flex-col items-center gap-3 text-center" data-testid="txn-error-state">
                    <span className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center"><CircleX className="text-rose-500" size={24} /></span>
                    <div className="text-sm font-medium text-slate-700">Couldn’t load transactions</div>
                    <div className="text-xs text-slate-400 max-w-md">{error}</div>
                    <Button variant="outline" size="sm" onClick={() => load()} className="rounded-lg gap-2" data-testid="txn-retry"><RefreshCw size={14} /> Retry</Button>
                  </div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={colCount} className="text-center py-12 text-slate-400" data-testid="txn-empty-state">
                  {hasActiveFilters ? "No transactions found for the selected filters." : t("no_data")}
                </td></tr>
              ) : view === "grouped" ? (
                groups.map((g) => (
                  <React.Fragment key={g.status}>
                    <tr className="bg-slate-100/70"><td colSpan={colCount} className="py-2 px-4 text-xs font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-2"><StatusBadge status={g.status} /> <span className="text-slate-400">({g.rows.length})</span></td></tr>
                    {g.rows.map(renderRow)}
                  </React.Fragment>
                ))
              ) : (
                pageItems.map(renderRow)
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {view !== "grouped" && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-sm">
            <div className="flex items-center gap-2 text-slate-500">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="rounded-lg h-8 w-[72px]" data-testid="rows-per-page"><SelectValue /></SelectTrigger>
                <SelectContent>{[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="text-slate-500">
              Showing {totalCount === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount} transactions
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" className="rounded-lg h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="page-prev"><ChevronLeft size={15} /></Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1).map((n, idx, arr) => (
                <React.Fragment key={n}>
                  {idx > 0 && n - arr[idx - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
                  <button onClick={() => setPage(n)} className={`h-8 min-w-8 px-2 rounded-lg text-sm ${n === page ? "bg-[var(--brand)] text-white" : "border border-slate-200 hover:bg-slate-50"}`} data-testid={`page-${n}`}>{n}</button>
                </React.Fragment>
              ))}
              <Button size="icon" variant="outline" className="rounded-lg h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid="page-next"><ChevronRight size={15} /></Button>
            </div>
          </div>
        )}
      </div>

      {/* Details Drawer */}
      <Sheet open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto p-0" data-testid="txn-drawer">
          {drawer && (
            <div className="flex flex-col h-full">
              <SheetHeader className="p-5 border-b border-slate-100">
                <SheetTitle className="font-heading">Transaction Details</SheetTitle>
              </SheetHeader>
              <div className="p-5 space-y-4 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">{React.createElement(TYPE_ICON[txnDispType(drawer)] || Wallet, { size: 16 })}</span>
                      <span className="font-mono text-xs text-slate-500">TRX-{String(drawer.id).slice(0, 8).toUpperCase()}</span>
                    </div>
                    <div className="mt-2 text-lg font-heading font-black tracking-tight">{drawer.description || t(txnDispType(drawer))}</div>
                    <div className={`mt-1 text-2xl font-heading font-black ${txnDispType(drawer) === "income" ? "text-emerald-600" : txnDispType(drawer) === "deduction" ? "text-amber-600" : txnDispType(drawer) === "expense" ? "text-rose-600" : "text-slate-800"}`}>{inr(drawer.amount)}</div>
                  </div>
                  <StatusBadge status={drawer.status} title={drawer.rejected_reason} />
                </div>

                <Tabs value={drawerTab} onValueChange={setDrawerTab}>
                  <TabsList className="w-full">
                    <TabsTrigger value="overview" className="flex-1" data-testid="drawer-tab-overview">Overview</TabsTrigger>
                    <TabsTrigger value="attachments" className="flex-1" data-testid="drawer-tab-attachments">Attachments ({drawer.attachments?.length || 0})</TabsTrigger>
                    <TabsTrigger value="history" className="flex-1" data-testid="drawer-tab-history">History</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <DField label={t("date")} value={drawer.date} />
                      <DField label={t("type")} value={t(txnDispType(drawer))} />
                      <DField label={t("company")} value={nameOf("company", drawer.company_id)} />
                      <DField label={t("partner")} value={nameOf("partner", drawer.partner_id)} />
                      <DField label={t("center")} value={nameOf("center", drawer.center_id)} />
                      <DField label={t("project")} value={nameOf("project", drawer.project_id)} />
                      {(drawer.work_order_no || drawer.work_order_id) && <DField label="Work Order" value={drawer.work_order_no || drawer.work_order_id} />}
                      {drawer.payment_status && <DField label="Payment Status" value={drawer.payment_status === "partially_paid" ? "Partially Paid" : drawer.payment_status.charAt(0).toUpperCase() + drawer.payment_status.slice(1)} />}
                      {drawer.payment_status && <DField label="Paid / Balance" value={`${inr(drawer.paid_amount || 0)} / ${inr(drawer.balance != null ? drawer.balance : drawer.amount)}`} />}
                    </div>
                    <div>
                      <div className="overline text-[10px] text-slate-400 mb-1">{t("description")}</div>
                      <div className="text-sm text-slate-700">{drawer.description || "—"}</div>
                    </div>
                    {(drawer.items?.length || 0) > 0 && (
                      <div>
                        <div className="overline text-[10px] text-slate-400 mb-1">Items</div>
                        <div className="border border-slate-100 rounded-lg divide-y divide-slate-100">
                          {drawer.items.map((it, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                              <span>{it.name} <span className="text-slate-400">×{it.quantity}</span></span>
                              <span className="num font-medium">{inr(it.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="attachments" className="mt-4">
                    {(drawer.attachments?.length || 0) === 0 ? (
                      <div className="text-sm text-slate-400 py-6 text-center">No attachments.</div>
                    ) : (
                      <ul className="space-y-2">
                        {drawer.attachments.map((a) => (
                          <li key={a.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
                            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline truncate flex items-center gap-2"><FileText size={14} /> {a.filename}</a>
                            <span className="text-[10px] text-slate-400 ml-2">{(a.size / 1024).toFixed(0)} KB</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TabsContent>

                  <TabsContent value="history" className="mt-4">
                    <ol className="relative border-l border-slate-200 pl-4 space-y-4">
                      <li>
                        <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-blue-500" />
                        <div className="text-sm font-medium">Created</div>
                        <div className="text-xs text-slate-400">{(drawer.created_at || "").slice(0, 16).replace("T", " ")}</div>
                      </li>
                      {drawer.paid_by_name && (
                        <li>
                          <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-emerald-500" />
                          <div className="text-sm font-medium">Paid by {drawer.paid_by_name}</div>
                          {drawer.qrn && <div className="text-xs text-slate-400 font-mono">QRN {drawer.qrn}</div>}
                        </li>
                      )}
                      <li>
                        <span className={`absolute -left-1.5 w-3 h-3 rounded-full ${drawer.status === "approved" ? "bg-emerald-500" : drawer.status === "rejected" ? "bg-rose-500" : "bg-amber-500"}`} />
                        <div className="text-sm font-medium capitalize" data-testid="drawer-pending-at">
                          {(drawer.status || "pending") === "pending" && drawer.pending_at
                            ? <>Pending at <span className="text-amber-700">{drawer.pending_at}</span></>
                            : (drawer.status || "pending")}
                        </div>
                        {drawer.rejected_reason && <div className="text-xs text-rose-500">{drawer.rejected_reason}</div>}
                      </li>
                    </ol>
                  </TabsContent>
                </Tabs>
              </div>

              {/* Permitted actions */}
              {canEdit && (
                <div className="p-4 border-t border-slate-100 grid grid-cols-2 gap-2">
                  {isAdmin && drawer.status !== "approved" && <Button onClick={() => approveTxn(drawer.id)} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 gap-1.5" data-testid="drawer-approve"><Check size={15} /> {t("approve")}</Button>}
                  {isAdmin && drawer.status !== "rejected" && <Button onClick={() => rejectTxn(drawer.id)} variant="outline" className="rounded-lg border-rose-300 text-rose-600 hover:bg-rose-50 gap-1.5" data-testid="drawer-reject"><Ban size={15} /> {t("reject")}</Button>}
                  {canPartnerCrossApprove(drawer) && <Button onClick={() => partnerApproveTxn(drawer.id)} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 gap-1.5 col-span-2"><CheckSquare size={15} /> Partner Approve</Button>}
                  <Button onClick={() => openEdit(drawer)} variant="outline" className="rounded-lg gap-1.5" data-testid="drawer-edit"><Pencil size={14} /> {t("edit")}</Button>
                  {canDelete && <Button onClick={() => remove(drawer)} variant="outline" className="rounded-lg border-rose-300 text-rose-600 hover:bg-rose-50 gap-1.5" data-testid="drawer-delete"><Trash2 size={14} /> {t("delete")}</Button>}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Advanced Filters drawer */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent className="w-full sm:max-w-sm overflow-y-auto" data-testid="filters-drawer">
          <SheetHeader><SheetTitle className="font-heading">Advanced Filters</SheetTitle></SheetHeader>
          <div className="mt-5 space-y-4">
            {ENTITY_TYPES.map((etype) => (
              <div key={etype}>
                <Label className="overline">{t(etype)}</Label>
                <Select value={filters[`${etype}_id`] || "__all"} onValueChange={(v) => setF(`${etype}_id`, v === "__all" ? "" : v)}>
                  <SelectTrigger className="rounded-lg" data-testid={`adv-filter-${etype}`}><SelectValue placeholder={t("all")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">{t("all")}</SelectItem>
                    {entities[etype].map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div>
              <Label className="overline">Work Order</Label>
              <Select value={filters.work_order_id || "__all"} onValueChange={(v) => setF("work_order_id", v === "__all" ? "" : v)}>
                <SelectTrigger className="rounded-lg" data-testid="adv-filter-work-order"><SelectValue placeholder={t("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{t("all")}</SelectItem>
                  {filterWorkOrders.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.wo_number}{w.scheme ? ` · ${w.scheme}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filters.center_id && filterWorkOrders.length === 0 && (
                <div className="text-[10px] text-slate-400 mt-1">No Work Orders for the selected center.</div>
              )}
            </div>
            <div>
              <Label className="overline">Payment Status</Label>
              <Select value={filters.payment_status || "__all"} onValueChange={(v) => setF("payment_status", v === "__all" ? "" : v)}>
                <SelectTrigger className="rounded-lg" data-testid="adv-filter-payment-status"><SelectValue placeholder={t("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{t("all")}</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="partially_paid">Partially Paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="overline">From</Label><Input type="date" value={filters.start} onChange={(e) => setF("start", e.target.value)} className="rounded-lg" /></div>
              <div><Label className="overline">To</Label><Input type="date" value={filters.end} onChange={(e) => setF("end", e.target.value)} className="rounded-lg" /></div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={clearAll} className="rounded-lg flex-1">Clear All</Button>
              <Button onClick={() => setFiltersOpen(false)} className="brand-btn rounded-lg flex-1">Apply</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Admin · Mess Partner Audit & Fix */}
      <Dialog open={auditOpen} onOpenChange={(o) => { setAuditOpen(o); if (!o) setAuditData(null); }}>
        <DialogContent className="rounded-2xl max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="partner-audit-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2"><ShieldAlert size={18} className="text-amber-600" /> Mess Expense — Partner Audit & Fix</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Unpaid Mess purchase expenses that still carry an auto-assigned partner. Fixing sets them to <b>Unassigned</b> so the accountant assigns the correct partner at payment time. Nothing is deleted — old partners are logged for audit.
            </DialogDescription>
          </DialogHeader>
          {auditLoading ? (
            <div className="text-sm text-slate-500 p-8 text-center">Scanning transactions…</div>
          ) : !auditData ? (
            <div className="text-sm text-slate-400 p-8 text-center">—</div>
          ) : auditData.count === 0 ? (
            <div className="text-center py-10" data-testid="audit-empty">
              <CircleCheck size={36} className="text-emerald-500 mx-auto mb-2" />
              <div className="text-slate-700 font-semibold">No wrongly-assigned partners found</div>
              <div className="text-xs text-slate-500 mt-1">All unpaid mess expenses are already Unassigned or correctly mapped.</div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="text-sm text-amber-800"><b>{auditData.count}</b> unpaid expense(s) · total <b>{inr(auditData.total_amount)}</b> with an auto-assigned partner.</div>
                <Button onClick={runFix} disabled={fixing} className="rounded-lg gap-1.5 bg-amber-600 hover:bg-amber-700 text-white" data-testid="audit-fix-btn">
                  <AlertTriangle size={14} /> {fixing ? "Fixing…" : "Set all to Unassigned"}
                </Button>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]" data-testid="audit-table">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-semibold text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Description</th>
                      <th className="text-left px-3 py-2">Center</th>
                      <th className="text-left px-3 py-2">Current Partner</th>
                      <th className="text-right px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditData.flagged.map((x, i) => (
                      <tr key={i} data-testid={`audit-row-${i}`} className="hover:bg-amber-50/40">
                        <td className="px-3 py-2 num text-slate-500 whitespace-nowrap">{x.date}</td>
                        <td className="px-3 py-2 text-slate-700 max-w-[220px] truncate">{x.description}</td>
                        <td className="px-3 py-2 text-slate-600">{x.center_name || "—"}</td>
                        <td className="px-3 py-2 text-rose-600 font-medium">{x.partner_name || "—"}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{inr(x.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAuditOpen(false); setAuditData(null); }} className="rounded-lg">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-lg max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-tight">{editing ? t("edit") : t("new_transaction")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("type")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="rounded-lg" data-testid="txn-type"><SelectValue /></SelectTrigger>
                <SelectContent>{TXN_TYPES.map((tt) => <SelectItem key={tt} value={tt}>{t(tt)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("amount")} {form.items.length > 0 && <span className="text-xs text-slate-400">(auto from items)</span>}</Label>
              <Input type="number" step="0.01" value={form.items.length ? itemsTotal : form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} disabled={form.items.length > 0} className="rounded-lg" data-testid="txn-amount" />
            </div>
            <div className="col-span-2">
              <Label>{t("date")}</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-lg" data-testid="txn-date" />
            </div>
            {ENTITY_TYPES.map((etype) => (
              <div key={etype}>
                <Label>{t(etype)}</Label>
                <Select value={form[`${etype}_id`] || "__none"} onValueChange={(v) => setForm({ ...form, [`${etype}_id`]: v === "__none" ? "" : v, ...(etype === "center" ? { work_order_id: "" } : {}) })}>
                  <SelectTrigger className="rounded-lg" data-testid={`txn-${etype}`}><SelectValue placeholder={t("all")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {entities[etype].map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {(form.type === "expense" || form.type === "income") && (
              <div className="col-span-2">
                <Label>Select Work Order <span className="text-rose-500">*</span></Label>
                {!form.center_id ? (
                  <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5" data-testid="wo-need-center">Pehle Center select karein — uske Work Orders yahan aayenge.</div>
                ) : woLoading ? (
                  <div className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-2.5">Loading work orders…</div>
                ) : workOrders.length === 0 ? (
                  <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5" data-testid="wo-none">Is center ke liye koi Work Order nahi mila.</div>
                ) : (
                  <Popover open={woPickerOpen} onOpenChange={setWoPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" role="combobox" className="w-full justify-between rounded-lg font-normal" data-testid="txn-work-order">
                        {form.work_order_id
                          ? (() => { const w = workOrders.find((x) => x.id === form.work_order_id); return w ? `${w.wo_number}${w.scheme || w.project_name ? " · " + (w.scheme || w.project_name) : ""}` : "Select work order…"; })()
                          : <span className="text-slate-400">Select work order…</span>}
                        <ChevronDown size={15} className="opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
                      <Command>
                        <CommandInput placeholder="Search WO number / name…" data-testid="wo-search" />
                        <CommandList>
                          <CommandEmpty>No work order found.</CommandEmpty>
                          <CommandGroup>
                            {workOrders.map((w) => (
                              <CommandItem
                                key={w.id}
                                value={`${w.wo_number} ${w.scheme || ""} ${w.project_name || ""} ${w.loi_number || ""}`}
                                onSelect={() => { setForm((f) => ({ ...f, work_order_id: w.id })); setWoPickerOpen(false); }}
                                data-testid={`wo-option-${w.id}`}
                              >
                                <Check size={15} className={`mr-2 ${form.work_order_id === w.id ? "opacity-100" : "opacity-0"}`} />
                                <div className="min-w-0">
                                  <div className="font-medium text-slate-800 truncate">{w.wo_number}</div>
                                  <div className="text-[11px] text-slate-500 truncate">{w.scheme || w.project_name || "—"}{w.effective_status && w.effective_status !== "active" ? ` · ${w.effective_status}` : ""}</div>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
            <div className="col-span-2">
              <Label>{t("description")}</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-lg" rows={2} />
            </div>

            {/* Items */}
            <div className="col-span-2 border-t border-slate-100 pt-4 mt-2">
              <div className="flex items-center justify-between mb-2">
                <Label className="overline">{t("items") || "Items"}</Label>
                <Button type="button" size="sm" variant="outline" className="rounded-lg gap-2" onClick={addItem} data-testid="btn-add-item"><Plus size={14} /> {t("add") || "Add"}</Button>
              </div>
              {form.items.length === 0 ? (
                <div className="overline text-center py-3 border border-dashed border-slate-200 rounded-lg">No items — optional. Add line items for granular tracking.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="overline border-b border-slate-100"><th className="text-left py-2">Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th></th></tr></thead>
                  <tbody>
                    {form.items.map((it, idx) => {
                      const itemKey = it._k || (it._k = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
                      return (
                        <tr key={itemKey} className="border-b border-slate-100">
                          <td className="py-1.5 pr-2"><Input value={it.name} onChange={(e) => updateItem(idx, "name", e.target.value)} placeholder="Item name" list="txn-item-names" className="rounded-lg h-8" data-testid={`item-name-${idx}`} /></td>
                          <td className="py-1.5 pr-2 w-20"><Input type="number" step="0.01" value={it.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} className="rounded-lg h-8 num" /></td>
                          <td className="py-1.5 pr-2 w-28"><Input type="number" step="0.01" value={it.rate} onChange={(e) => updateItem(idx, "rate", e.target.value)} className="rounded-lg h-8 num" /></td>
                          <td className="py-1.5 pr-2 w-28"><Input type="number" step="0.01" value={it.amount} onChange={(e) => updateItem(idx, "amount", parseFloat(e.target.value) || 0)} className="rounded-lg h-8 num font-medium" /></td>
                          <td className="w-10"><Button type="button" size="icon" variant="ghost" onClick={() => removeItem(idx)} className="h-8 w-8 rounded-lg hover:text-rose-600"><Trash2 size={14} /></Button></td>
                        </tr>
                      );
                    })}
                    <tr><td colSpan={3} className="text-right overline pt-2">Items Total</td><td className="num font-bold pt-2">{inr(itemsTotal)}</td><td></td></tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* Attachments */}
            <div className="col-span-2 border-t border-slate-100 pt-4 mt-2">
              <div className="flex items-center justify-between mb-2">
                <Label className="overline">Attachments</Label>
                <div>
                  <input ref={attachRef} type="file" hidden onChange={uploadAttachment} data-testid="attach-input" />
                  <Button type="button" size="sm" variant="outline" className="rounded-lg gap-2" disabled={uploading} onClick={() => attachRef.current?.click()} data-testid="btn-attach"><Upload size={14} /> {uploading ? "Uploading…" : "Attach file"}</Button>
                </div>
              </div>
              {form.attachments.length === 0 ? (
                <div className="overline text-center py-3 border border-dashed border-slate-200 rounded-lg">No attachments — upload bills, receipts, invoices (max 10MB).</div>
              ) : (
                <ul className="space-y-1">
                  {form.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
                      <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline truncate">{a.filename}</a>
                      <div className="flex items-center gap-3 ml-3">
                        <span className="overline">{(a.size / 1024).toFixed(0)} KB</span>
                        <Button type="button" size="icon" variant="ghost" onClick={() => removeAttachment(a.id)} className="h-7 w-7 rounded-lg hover:text-rose-600"><Trash2 size={14} /></Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-lg">{t("cancel")}</Button>
            <SubmitButton onClick={save} className="brand-btn rounded-lg" data-testid="txn-save" loadingLabel="Saving…">{t("save")}</SubmitButton>
          </DialogFooter>
          <datalist id="txn-item-names">{itemSuggestions.map((s) => <option key={s.name} value={s.name} />)}</datalist>
        </DialogContent>
      </Dialog>

      <BulkDeleteDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        count={selected.size}
        itemLabel="transactions"
        busy={bulkDeleteBusy}
        onConfirm={bulkDelete}
        warning="Approved transactions will also be deleted — re-running 'mark received' on a milestone will recreate them."
      />

      {/* Admin bulk-assign dialog */}
      <Dialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
        <DialogContent className="rounded-lg max-w-lg" data-testid="bulk-assign-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-tight">Assign to {selected.size} transaction{selected.size === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Jo fields aap yahan chunenge woh sirf un rows par lagengi jahan woh field abhi <b>khaali</b> hai. Jiska value pehle se hai usse chheda nahi jayega.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-1">
            {ENTITY_TYPES.map((etype) => (
              <div key={etype} className={etype === "project" ? "col-span-2" : ""}>
                <Label className="text-xs">{t(etype)}</Label>
                <Select value={bulkAssign[`${etype}_id`] || "__none"} onValueChange={(v) => setBulkAssign((s) => ({ ...s, [`${etype}_id`]: v === "__none" ? "" : v }))}>
                  <SelectTrigger className="rounded-lg" data-testid={`bulk-assign-${etype}`}><SelectValue placeholder="— leave unchanged —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— leave unchanged —</SelectItem>
                    {(entities[etype] || []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="col-span-2">
              <Label className="text-xs">Work Order</Label>
              <Select value={bulkAssign.work_order_id || "__none"} onValueChange={(v) => setBulkAssign((s) => ({ ...s, work_order_id: v === "__none" ? "" : v }))}>
                <SelectTrigger className="rounded-lg" data-testid="bulk-assign-work-order"><SelectValue placeholder="— leave unchanged —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— leave unchanged —</SelectItem>
                  {filterWorkOrders.map((w) => <SelectItem key={w.id} value={w.id}>{w.wo_number}{w.center_name ? ` · ${w.center_name}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-[10px] text-slate-400 mt-1">Center filter chalu ho to sirf us center ke Work Orders dikhte hain.</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAssignOpen(false)} className="rounded-lg">{t("cancel")}</Button>
            <SubmitButton onClick={doBulkAssign} className="brand-btn rounded-lg" data-testid="bulk-assign-apply" loadingLabel="Assigning…">Assign</SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DField({ label, value }) {
  return (
    <div>
      <div className="overline text-[10px] text-slate-400 mb-0.5">{label}</div>
      <div className="text-sm text-slate-700">{value == null || value === "" ? "—" : value}</div>
    </div>
  );
}

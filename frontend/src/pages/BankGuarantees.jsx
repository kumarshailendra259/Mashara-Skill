import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFY } from "@/context/FYContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, Eye, ShieldCheck, AlertTriangle, RotateCcw, FileText, Landmark,
  Layers3, Wallet, TrendingUp, Clock, CheckCircle2, XCircle, MoreVertical, Pencil,
  RefreshCw, ClipboardCheck, History, Paperclip, X, ChevronRight, Download,
} from "lucide-react";

const WRITE_ROLES = ["admin", "hr", "manager", "senior_manager", "accountant"];
const OVERRIDE_ROLES = ["admin", "accountant", "manager", "senior_manager"];

const inr = (n) => Number(n || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmtDate = (s) => {
  if (!s) return "—";
  const p = String(s).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : s;
};

// effective status → badge style + label + dot
const ST = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  submitted: { label: "Submitted", cls: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  under_verification: { label: "Verification", cls: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" },
  active: { label: "Active", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  expiring_soon: { label: "Expiring Soon", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  expired: { label: "Expired", cls: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  released: { label: "Released", cls: "bg-teal-50 text-teal-700 border-teal-200", dot: "bg-teal-500" },
  cancelled: { label: "Cancelled", cls: "bg-slate-200 text-slate-700 border-slate-300", dot: "bg-slate-600" },
};
const StatusBadge = ({ s }) => {
  const m = ST[s] || ST.draft;
  return <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${m.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{m.label}</span>;
};
const DaysBadge = ({ d }) => {
  if (d == null) return <span className="text-slate-400">—</span>;
  if (d < 0) return <span className="text-red-600 font-semibold text-xs">Expired</span>;
  const cls = d > 30 ? "text-emerald-600" : d >= 8 ? "text-amber-600" : "text-orange-600";
  return <span className={`font-semibold text-xs ${cls}`}>{d} Days</span>;
};

const QUICK = [
  { k: "all", label: "All" },
  { k: "active", label: "Active" },
  { k: "expiring_soon", label: "Expiring Soon" },
  { k: "expired", label: "Expired" },
  { k: "submitted", label: "Submitted" },
  { k: "under_verification", label: "Pending Verification" },
];
const DOC_TYPES = ["BG Copy", "Amendment", "Renewal Document", "Department Submission Proof", "Other"];
const EMPTY_FORM = {
  work_order_id: "", bg_number: "", amount: "", amount_override: false, issued_by: "",
  date_of_issuance: "", valid_till: "", bg_claim_expiry_date: "", in_favour_of: "",
  applicant: "", location: "", remarks: "", attachments: [], renews_bg_id: "",
};

export default function BankGuarantees() {
  const { user } = useAuth();
  const { fy: globalFy } = useFY();
  const canWrite = WRITE_ROLES.includes(user?.role);
  const canOverride = OVERRIDE_ROLES.includes(user?.role);
  const canDelete = ["admin", "hr"].includes(user?.role);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [projects, setProjects] = useState([]);
  const [centers, setCenters] = useState([]);
  const [woList, setWoList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ search: "", project_id: "all", center_id: "all", fy: "all", bank: "" });
  const [quick, setQuick] = useState("all");

  const loadRefs = useCallback(async () => {
    try {
      const [p, c, w] = await Promise.allSettled([
        api.get("/mis/projects"), api.get("/centers"), api.get("/work-orders"),
      ]);
      setProjects(p.status === "fulfilled" ? (p.value.data || []) : []);
      setCenters(c.status === "fulfilled" ? (c.value.data || []) : []);
      setWoList(w.status === "fulfilled" ? (w.value.data || []) : []);
    } catch { /* noop */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.project_id !== "all") params.set("project_id", filters.project_id);
      if (filters.center_id !== "all") params.set("center_id", filters.center_id);
      if (filters.fy !== "all") params.set("fy", filters.fy);
      if (filters.bank) params.set("bank", filters.bank);
      if (quick !== "all") params.set("status", quick);
      const [r, s] = await Promise.all([
        api.get(`/bank-guarantees?${params.toString()}`),
        api.get("/bank-guarantees/summary", { params: filters.fy !== "all" ? { fy: filters.fy } : {} }),
      ]);
      setRows(r.data || []); setSummary(s.data || null);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [filters, quick]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { load(); }, [load]);

  // Follow the global FY selector (from the header).
  useEffect(() => {
    setFilters((f) => ({ ...f, fy: globalFy && globalFy !== "all" ? globalFy : "all" }));
  }, [globalFy]);

  const fyOptions = useMemo(() => Array.from(new Set(woList.map((w) => w.fy).filter(Boolean))).sort(), [woList]);

  // ---- form dialog ----
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [woCtx, setWoCtx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [woQuery, setWoQuery] = useState("");
  const [woPickerOpen, setWoPickerOpen] = useState(false);

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setWoCtx(null); setWoQuery(""); setFormOpen(true); };
  const openEdit = (bg) => {
    setEditing(bg);
    setForm({
      work_order_id: bg.work_order_id || "", bg_number: bg.bg_number || "", amount: bg.amount ?? "",
      amount_override: !!bg.amount_override, issued_by: bg.issued_by || "",
      date_of_issuance: (bg.date_of_issuance || "").slice(0, 10), valid_till: (bg.valid_till || "").slice(0, 10),
      bg_claim_expiry_date: (bg.bg_claim_expiry_date || "").slice(0, 10), in_favour_of: bg.in_favour_of || "",
      applicant: bg.applicant || "", location: bg.location || "", remarks: bg.remarks || "",
      attachments: bg.attachments || [], renews_bg_id: "",
    });
    loadWoCtx(bg.work_order_id, false);
    setFormOpen(true);
  };
  const openRenew = (bg) => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, work_order_id: bg.work_order_id || "", renews_bg_id: bg.id, in_favour_of: bg.in_favour_of || "", applicant: bg.applicant || "", location: bg.location || "" });
    loadWoCtx(bg.work_order_id, true);
    setFormOpen(true);
    toast.info(`Renewing ${bg.bg_number} — enter the NEW BG details. History is preserved.`);
  };

  const loadWoCtx = async (woId, autofillAmount) => {
    if (!woId) { setWoCtx(null); return; }
    try {
      const { data } = await api.get(`/bank-guarantees/wo-context/${woId}`);
      setWoCtx(data);
      if (autofillAmount) {
        setForm((f) => ({ ...f, amount: data.pbg?.required || "", applicant: f.applicant || data.work_order?.company_name || "" }));
      }
    } catch (e) { toast.error(formatError(e)); setWoCtx(null); }
  };
  const onPickWO = (w) => {
    setF("work_order_id", w.id);
    setWoPickerOpen(false); setWoQuery("");
    loadWoCtx(w.id, true);
  };

  const filteredWO = useMemo(() => {
    const q = woQuery.trim().toLowerCase();
    return woList.filter((w) => !q || [w.wo_number, w.loi_number, w.project_name, w.center_name].some((v) => (v || "").toLowerCase().includes(q))).slice(0, 40);
  }, [woList, woQuery]);

  const pbgRequired = woCtx?.pbg?.required || 0;
  const amtNum = Number(form.amount) || 0;
  const shortfall = pbgRequired > 0 && amtNum > 0 && amtNum < pbgRequired;

  const uploadAttachment = async (file, docType) => {
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, attachments: [...(f.attachments || []), { ...data, doc_type: docType }] }));
      toast.success("Attachment uploaded");
    } catch (e) { toast.error(formatError(e)); }
  };

  const doSave = async (submitAfter) => {
    if (!form.work_order_id) return toast.error("Select a Work Order first");
    for (const [k, l] of [["bg_number", "BG Number"], ["issued_by", "Issued By"], ["amount", "Amount"], ["date_of_issuance", "Date of Issuance"], ["valid_till", "Valid Till"], ["bg_claim_expiry_date", "BG Claim Expiry Date"]]) {
      if (!String(form[k] || "").trim()) return toast.error(`${l} is required`);
    }
    if (form.bg_claim_expiry_date < form.valid_till) return toast.error("Claim Expiry Date cannot be earlier than Valid Till");
    if (shortfall && !canOverride) return toast.error(`PBG shortfall — BG (${inr(amtNum)}) is below required PBG (${inr(pbgRequired)}). Only authorized roles can override.`);
    const payload = { ...form, amount: amtNum, amount_override: shortfall ? true : form.amount_override };
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/bank-guarantees/${editing.id}`, payload);
        toast.success("Bank Guarantee updated");
      } else {
        const { data } = await api.post("/bank-guarantees", payload);
        if (submitAfter) {
          await api.post(`/bank-guarantees/${data.id}/status`, { status: "submitted", remarks: "Submitted on creation" });
          toast.success("Bank Guarantee created & submitted");
        } else { toast.success("Bank Guarantee saved as draft"); }
      }
      setFormOpen(false); load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  // ---- view drawer ----
  const [viewing, setViewing] = useState(null);
  const [viewCtx, setViewCtx] = useState(null);
  const openView = async (bg) => {
    setViewing(bg); setViewCtx(null);
    if (bg.work_order_id) {
      try { const { data } = await api.get(`/bank-guarantees/wo-context/${bg.work_order_id}`); setViewCtx(data); } catch { /* noop */ }
    }
  };

  // ---- status dialog ----
  const [stDialog, setStDialog] = useState(null); // { bg, to, remarks, department, submission_ref_no, verification_remarks }
  const TRANSITIONS = { draft: ["submitted", "cancelled"], submitted: ["under_verification", "draft", "cancelled"], under_verification: ["active", "submitted", "cancelled"], active: ["released", "cancelled"], released: [], cancelled: [] };
  const nextStates = (bg) => TRANSITIONS[(bg.status || "draft")] || [];
  const submitStatus = async () => {
    const d = stDialog;
    try {
      await api.post(`/bank-guarantees/${d.bg.id}/status`, {
        status: d.to, remarks: d.remarks || "",
        department: d.department, submission_ref_no: d.submission_ref_no,
        verification_remarks: d.verification_remarks,
      });
      toast.success(`Status changed to ${ST[d.to]?.label || d.to}`);
      setStDialog(null); load();
      if (viewing?.id === d.bg.id) openView({ ...viewing, status: d.to });
    } catch (e) { toast.error(formatError(e)); }
  };

  const doDelete = async (bg) => {
    if (!window.confirm(`Delete BG ${bg.bg_number}? This cannot be undone.`)) return;
    try { await api.delete(`/bank-guarantees/${bg.id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };

  const clearFilters = () => { setFilters({ search: "", project_id: "all", center_id: "all", fy: "all", bank: "" }); setQuick("all"); };

  const kpi = summary?.counts || {};
  const fin = summary?.financial || {};

  return (
    <div className="space-y-5" data-testid="bg-page">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-heading flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-blue-900 text-white"><ShieldCheck size={20} /></span>
            Bank Guarantee Management
          </h1>
          <div className="text-sm text-slate-500 mt-1">Work Order → PBG Requirement → Bank Guarantee. All linked to Batch Management.</div>
        </div>
        {canWrite && <Button onClick={openAdd} className="bg-blue-900 hover:bg-blue-800 text-white rounded-lg gap-2" data-testid="btn-add-bg"><Plus size={16} /> Add Bank Guarantee</Button>}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { k: "total", label: "Total BG", icon: Landmark, ic: "bg-blue-600/10 text-blue-700" },
          { k: "active", label: "Active", icon: CheckCircle2, ic: "bg-emerald-600/10 text-emerald-700" },
          { k: "submitted", label: "Submitted", icon: FileText, ic: "bg-blue-600/10 text-blue-700" },
          { k: "under_verification", label: "Verification", icon: ClipboardCheck, ic: "bg-violet-600/10 text-violet-700" },
          { k: "expiring_soon", label: "Expiring Soon", icon: Clock, ic: "bg-amber-600/10 text-amber-700" },
          { k: "expired", label: "Expired", icon: XCircle, ic: "bg-red-600/10 text-red-700" },
          { k: "released", label: "Released", icon: RotateCcw, ic: "bg-teal-600/10 text-teal-700" },
        ].map((c) => (
          <button key={c.k} onClick={() => setQuick(ST[c.k] ? c.k : "all")} className="text-left bg-white rounded-xl border border-slate-200/80 p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all" data-testid={`bg-kpi-${c.k}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{c.label}</span>
              <span className={`p-1.5 rounded-lg ${c.ic}`}><c.icon size={14} /></span>
            </div>
            <div className="text-2xl font-bold text-slate-900 font-heading mt-1">{kpi[c.k] ?? 0}</div>
          </button>
        ))}
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Total PBG Required", v: fin.total_pbg_required, icon: ShieldCheck, ic: "bg-blue-600/10 text-blue-700" },
          { label: "Total BG Issued", v: fin.total_bg_amount, icon: Wallet, ic: "bg-emerald-600/10 text-emerald-700" },
          { label: "Active BG Value", v: fin.active_bg_value, icon: TrendingUp, ic: "bg-teal-600/10 text-teal-700" },
          { label: "Expired BG Value", v: fin.expired_bg_value, icon: XCircle, ic: "bg-red-600/10 text-red-700" },
          { label: "Outstanding / Pending", v: fin.outstanding, icon: AlertTriangle, ic: "bg-amber-600/10 text-amber-700" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-slate-200/80 p-3 shadow-sm flex items-center gap-3">
            <span className={`p-2 rounded-lg ${c.ic}`}><c.icon size={16} /></span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 truncate">{c.label}</div>
              <div className="text-base font-bold text-slate-900 font-heading">{inr(c.v)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {QUICK.map((q) => (
            <button key={q.k} onClick={() => setQuick(q.k)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${quick === q.k ? "bg-blue-900 text-white border-blue-900" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"}`} data-testid={`bg-quick-${q.k}`}>{q.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Search BG No. / WO No. / Project / Centre" className="pl-9 h-9 rounded-lg bg-slate-50 border-slate-200 text-sm" data-testid="bg-search" />
          </div>
          <Select value={filters.project_id} onValueChange={(v) => setFilters((f) => ({ ...f, project_id: v }))}>
            <SelectTrigger className="h-9 w-36 rounded-lg bg-slate-50 border-slate-200 text-xs" data-testid="bg-filter-project"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Projects</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.center_id} onValueChange={(v) => setFilters((f) => ({ ...f, center_id: v }))}>
            <SelectTrigger className="h-9 w-36 rounded-lg bg-slate-50 border-slate-200 text-xs" data-testid="bg-filter-center"><SelectValue placeholder="Centre" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Centres</SelectItem>{centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.fy} onValueChange={(v) => setFilters((f) => ({ ...f, fy: v }))}>
            <SelectTrigger className="h-9 w-28 rounded-lg bg-slate-50 border-slate-200 text-xs" data-testid="bg-filter-fy"><SelectValue placeholder="FY" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All FY</SelectItem>{fyOptions.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={filters.bank} onChange={(e) => setFilters((f) => ({ ...f, bank: e.target.value }))} placeholder="Bank / Issued By" className="h-9 w-40 rounded-lg bg-slate-50 border-slate-200 text-xs" data-testid="bg-filter-bank" />
          <Button variant="outline" onClick={clearFilters} className="h-9 rounded-lg text-xs gap-1.5 border-slate-200" data-testid="bg-clear-filters"><RotateCcw size={13} /> Clear</Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1080px]">
            <thead className="bg-slate-50/90 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              <tr className="[&>th]:py-2.5 [&>th]:px-3 [&>th]:text-left">
                <th>BG Number</th><th>Work Order</th><th>Project</th><th>Centre</th><th>FY</th>
                <th className="!text-right">BG Amount</th><th>Issue Date</th><th>Valid Till</th><th>Claim Expiry</th>
                <th>Status</th><th>Days Left</th><th className="!text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={12} className="p-6 text-center text-slate-400">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={12} className="p-8 text-center text-slate-400">No bank guarantees found.</td></tr>}
              {rows.map((bg) => (
                <tr key={bg.id} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors text-slate-800" data-testid={`bg-row-${bg.id}`}>
                  <td className="py-2.5 px-3 font-mono font-semibold text-blue-700">{bg.bg_number}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-500">{bg.work_order_no || "—"}</td>
                  <td className="py-2.5 px-3">{bg.project_name || "—"}</td>
                  <td className="py-2.5 px-3">{bg.center_name || "—"}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-500">{bg.fy || "—"}</td>
                  <td className="py-2.5 px-3 text-right font-semibold">{inr(bg.amount)}</td>
                  <td className="py-2.5 px-3">{fmtDate(bg.date_of_issuance)}</td>
                  <td className="py-2.5 px-3">{fmtDate(bg.valid_till)}</td>
                  <td className="py-2.5 px-3">{fmtDate(bg.bg_claim_expiry_date)}</td>
                  <td className="py-2.5 px-3"><StatusBadge s={bg.effective_status} /></td>
                  <td className="py-2.5 px-3"><DaysBadge d={bg.days_remaining} /></td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button onClick={() => openView(bg)} className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded flex items-center gap-1" data-testid={`bg-view-${bg.id}`}><Eye size={12} /> View</button>
                      {canWrite && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 text-slate-500 hover:bg-slate-100 rounded" data-testid={`bg-more-${bg.id}`}><MoreVertical size={14} /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => openEdit(bg)} data-testid={`bg-edit-${bg.id}`}><Pencil size={13} className="mr-2" /> Edit</DropdownMenuItem>
                            {nextStates(bg).length > 0 && <DropdownMenuItem onClick={() => setStDialog({ bg, to: nextStates(bg)[0], remarks: "" })} data-testid={`bg-status-${bg.id}`}><ClipboardCheck size={13} className="mr-2" /> Change Status</DropdownMenuItem>}
                            <DropdownMenuItem onClick={() => openRenew(bg)} data-testid={`bg-renew-${bg.id}`}><RefreshCw size={13} className="mr-2" /> Renew / Extend</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openView(bg)}><History size={13} className="mr-2" /> Audit / Work Order</DropdownMenuItem>
                            {canDelete && <DropdownMenuItem onClick={() => doDelete(bg)} className="text-red-600 focus:text-red-600"><XCircle size={13} className="mr-2" /> Delete</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============ ADD / EDIT / RENEW FORM ============ */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl" data-testid="bg-form-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">{editing ? "Edit Bank Guarantee" : form.renews_bg_id ? "Renew Bank Guarantee" : "Add Bank Guarantee"}</DialogTitle>
            <DialogDescription className="text-xs">Select a Work Order first — FY, Project, Centre, LOI, WO Value and PBG auto-populate.</DialogDescription>
          </DialogHeader>

          {/* Section: Work Order Link */}
          <Section title="Work Order Link">
            {editing ? (
              <div className="text-sm text-slate-700">Linked WO: <b className="font-mono text-blue-700">{editing.work_order_no}</b> <span className="text-slate-400">(cannot be changed on edit)</span></div>
            ) : (
              <div className="relative">
                <Label className="text-[10px] uppercase tracking-wider text-slate-500">Select Work Order *</Label>
                <button type="button" onClick={() => setWoPickerOpen((o) => !o)} className="w-full mt-1 h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-left text-sm flex items-center justify-between" data-testid="bg-wo-picker">
                  <span className={form.work_order_id ? "text-slate-900" : "text-slate-400"}>
                    {form.work_order_id ? (woCtx?.work_order ? `${woCtx.work_order.project_name} · ${woCtx.work_order.center_name} · ${woCtx.work_order.fy} · ${woCtx.work_order.wo_number}` : "Loading…") : "Search / Select Work Order"}
                  </span>
                  <ChevronRight size={14} className="text-slate-400 rotate-90" />
                </button>
                {woPickerOpen && (
                  <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                    <div className="p-2 sticky top-0 bg-white border-b"><Input autoFocus value={woQuery} onChange={(e) => setWoQuery(e.target.value)} placeholder="Search WO No / LOI / Project / Centre" className="h-8 text-xs rounded-lg" data-testid="bg-wo-search" /></div>
                    {filteredWO.length === 0 && <div className="p-3 text-xs text-slate-400">No work orders found.</div>}
                    {filteredWO.map((w) => (
                      <button key={w.id} type="button" onClick={() => onPickWO(w)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs border-b border-slate-50" data-testid={`bg-wo-opt-${w.id}`}>
                        <span className="font-semibold">{w.project_name}</span> · {w.center_name} · <span className="font-mono">{w.fy}</span> · <span className="font-mono text-blue-700">{w.wo_number}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Section: Auto-linked information */}
          {woCtx && (
            <Section title="Auto-Linked Information (from Work Order)">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2.5 text-sm">
                <ReadField label="FY" value={woCtx.work_order.fy} />
                <ReadField label="Project" value={woCtx.work_order.project_name} />
                <ReadField label="Centre" value={woCtx.work_order.center_name} />
                <ReadField label="Work Order No." value={woCtx.work_order.wo_number} />
                <ReadField label="LOI No." value={woCtx.work_order.loi_number} />
                <ReadField label="Work Order Value" value={inr(woCtx.work_order.work_order_value)} />
                <ReadField label="PBG Required" value={inr(woCtx.pbg.required)} highlight />
                <ReadField label="BG Already Received" value={inr(woCtx.pbg.bg_received)} />
                <ReadField label="PBG Balance" value={inr(woCtx.pbg.balance)} />
              </div>
              <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-3">
                <span>Coverage: <b className={woCtx.pbg.coverage_pct >= 100 ? "text-emerald-600" : "text-amber-600"}>{woCtx.pbg.coverage_pct}%</b></span>
                <span className="text-slate-300">|</span>
                <span>Batches: <b>{woCtx.batch.total_batches}</b> (Active {woCtx.batch.active_batches}) · Target {woCtx.batch.total_target} · Allocated {woCtx.batch.allocated} · Candidates {woCtx.batch.candidates}</span>
              </div>
            </Section>
          )}

          {/* Section: BG details */}
          <Section title="Bank Guarantee Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Bank Guarantee Number *"><Input value={form.bg_number} onChange={(e) => setF("bg_number", e.target.value)} className="rounded-lg" data-testid="bg-f-number" /></Field>
              <Field label="Amount *" hint={pbgRequired ? "Auto-linked from Work Order PBG Amount" : ""}>
                <Input type="number" value={form.amount} onChange={(e) => setF("amount", e.target.value)} className="rounded-lg" data-testid="bg-f-amount" />
              </Field>
              <Field label="Issued By (Bank) *"><Input value={form.issued_by} onChange={(e) => setF("issued_by", e.target.value)} className="rounded-lg" data-testid="bg-f-issuedby" /></Field>
              <Field label="In Favour Of"><Input value={form.in_favour_of} onChange={(e) => setF("in_favour_of", e.target.value)} className="rounded-lg" data-testid="bg-f-favour" /></Field>
              <Field label="Date of Issuance *"><Input type="date" value={form.date_of_issuance} onChange={(e) => setF("date_of_issuance", e.target.value)} className="rounded-lg" data-testid="bg-f-issue" /></Field>
              <Field label="Valid Till *"><Input type="date" value={form.valid_till} onChange={(e) => setF("valid_till", e.target.value)} className="rounded-lg" data-testid="bg-f-validtill" /></Field>
              <Field label="BG Claim Expiry Date *"><Input type="date" value={form.bg_claim_expiry_date} onChange={(e) => setF("bg_claim_expiry_date", e.target.value)} className="rounded-lg" data-testid="bg-f-claim" /></Field>
              <Field label="Applicant"><Input value={form.applicant} onChange={(e) => setF("applicant", e.target.value)} className="rounded-lg" data-testid="bg-f-applicant" /></Field>
            </div>
            {shortfall && (
              <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs" data-testid="bg-shortfall-warn">
                <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                <div>
                  <b className="text-red-700">PBG Shortfall.</b> Required PBG: <b>{inr(pbgRequired)}</b>, Entered BG: <b>{inr(amtNum)}</b>, Shortfall: <b>{inr(pbgRequired - amtNum)}</b>.
                  {canOverride ? <span className="text-red-600"> As an authorized user, saving will record an override.</span> : <span className="text-red-700"> You are not authorized to override — enter at least the required PBG.</span>}
                </div>
              </div>
            )}
          </Section>

          {/* Section: Additional */}
          <Section title="Additional Information">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Location"><Input value={form.location} onChange={(e) => setF("location", e.target.value)} className="rounded-lg" data-testid="bg-f-location" /></Field>
              <Field label="Remarks"><Input value={form.remarks} onChange={(e) => setF("remarks", e.target.value)} className="rounded-lg" data-testid="bg-f-remarks" /></Field>
            </div>
            <div className="mt-3">
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">Attachments</Label>
              <div className="flex items-center gap-2 mt-1">
                <input id="bg-file" type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f, "BG Copy"); e.target.value = ""; }} data-testid="bg-f-file" />
                <label htmlFor="bg-file" className="cursor-pointer text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center gap-1.5"><Paperclip size={13} /> Upload Document</label>
              </div>
              {(form.attachments || []).length > 0 && (
                <div className="mt-2 space-y-1">
                  {form.attachments.map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-1.5">
                      <span className="truncate">{a.filename} <span className="text-slate-400">({a.doc_type})</span></span>
                      <button onClick={() => setForm((f) => ({ ...f, attachments: f.attachments.filter((_, j) => j !== i) }))} className="text-slate-400 hover:text-red-600"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)} className="rounded-lg">Cancel</Button>
            {!editing && <Button variant="outline" onClick={() => doSave(false)} disabled={saving} className="rounded-lg" data-testid="bg-save-draft">Save Draft</Button>}
            <Button onClick={() => doSave(!editing)} disabled={saving} className="bg-blue-900 hover:bg-blue-800 rounded-lg" data-testid="bg-submit">{saving ? "Saving…" : editing ? "Save Changes" : "Submit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ STATUS DIALOG ============ */}
      <Dialog open={!!stDialog} onOpenChange={(o) => !o && setStDialog(null)}>
        <DialogContent className="max-w-md rounded-xl" data-testid="bg-status-dialog">
          <DialogHeader><DialogTitle className="font-heading">Change Status</DialogTitle>
            <DialogDescription className="text-xs">{stDialog && <>Current: <StatusBadge s={stDialog.bg.effective_status} /></>}</DialogDescription>
          </DialogHeader>
          {stDialog && (
            <div className="space-y-3">
              <Field label="New Status">
                <Select value={stDialog.to} onValueChange={(v) => setStDialog((d) => ({ ...d, to: v }))}>
                  <SelectTrigger className="rounded-lg" data-testid="bg-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{nextStates(stDialog.bg).map((s) => <SelectItem key={s} value={s}>{ST[s]?.label || s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {stDialog.to === "submitted" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Department"><Input value={stDialog.department || ""} onChange={(e) => setStDialog((d) => ({ ...d, department: e.target.value }))} className="rounded-lg" /></Field>
                  <Field label="Submission Ref No."><Input value={stDialog.submission_ref_no || ""} onChange={(e) => setStDialog((d) => ({ ...d, submission_ref_no: e.target.value }))} className="rounded-lg" /></Field>
                </div>
              )}
              {stDialog.to === "under_verification" && (
                <Field label="Verification Remarks"><Input value={stDialog.verification_remarks || ""} onChange={(e) => setStDialog((d) => ({ ...d, verification_remarks: e.target.value }))} className="rounded-lg" /></Field>
              )}
              <Field label="Remarks"><Textarea value={stDialog.remarks} onChange={(e) => setStDialog((d) => ({ ...d, remarks: e.target.value }))} className="rounded-lg" rows={2} data-testid="bg-status-remarks" /></Field>
              {["active", "released", "cancelled"].includes(stDialog.to) && !canOverride && (
                <div className="text-xs text-red-600">Only authorized roles can set this status.</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStDialog(null)} className="rounded-lg">Cancel</Button>
            <Button onClick={submitStatus} className="bg-blue-900 hover:bg-blue-800 rounded-lg" data-testid="bg-status-save">Update Status</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ VIEW DRAWER ============ */}
      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col" data-testid="bg-view-drawer">
          <SheetHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <SheetTitle className="font-heading flex items-center gap-2">{viewing?.bg_number} <StatusBadge s={viewing?.effective_status} /></SheetTitle>
            <SheetDescription className="text-xs">{viewing ? `${viewing.project_name || ""} · ${viewing.center_name || ""} · ${viewing.fy || ""}` : ""}</SheetDescription>
          </SheetHeader>
          {viewing && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <ReadField label="BG Amount" value={inr(viewing.amount)} highlight />
                <ReadField label="PBG Required" value={inr(viewing.pbg_required)} />
                <ReadField label="Issued By" value={viewing.issued_by} />
                <ReadField label="In Favour Of" value={viewing.in_favour_of} />
                <ReadField label="Date of Issuance" value={fmtDate(viewing.date_of_issuance)} />
                <ReadField label="Valid Till" value={fmtDate(viewing.valid_till)} />
                <ReadField label="Claim Expiry" value={fmtDate(viewing.bg_claim_expiry_date)} />
                <ReadField label="Days Remaining" value={viewing.days_remaining == null ? "—" : viewing.days_remaining < 0 ? "Expired" : `${viewing.days_remaining} days`} />
                <ReadField label="Applicant" value={viewing.applicant} />
                <ReadField label="Location" value={viewing.location} />
              </div>

              {/* WO + Batch linkage */}
              {viewCtx && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Work Order Summary</h4>
                    <a href="/batch-management" className="text-[11px] text-blue-700 hover:underline flex items-center gap-1">View Work Order <ChevronRight size={12} /></a>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                    <ReadField label="WO No." value={viewCtx.work_order.wo_number} sm />
                    <ReadField label="LOI No." value={viewCtx.work_order.loi_number} sm />
                    <ReadField label="WO Value" value={inr(viewCtx.work_order.work_order_value)} sm />
                    <ReadField label="PBG Required" value={inr(viewCtx.pbg.required)} sm />
                    <ReadField label="BG Received" value={inr(viewCtx.pbg.bg_received)} sm />
                    <ReadField label="Coverage" value={`${viewCtx.pbg.coverage_pct}%`} sm />
                    <ReadField label="Total Target" value={viewCtx.batch.total_target} sm />
                    <ReadField label="Allocated" value={viewCtx.batch.allocated} sm />
                    <ReadField label="Remaining" value={viewCtx.batch.remaining} sm />
                    <ReadField label="Batches" value={viewCtx.batch.total_batches} sm />
                    <ReadField label="Active Batches" value={viewCtx.batch.active_batches} sm />
                    <ReadField label="Candidates" value={viewCtx.batch.candidates} sm />
                  </div>
                </div>
              )}

              {/* Attachments */}
              {(viewing.attachments || []).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Attachments</h4>
                  <div className="space-y-1.5">
                    {viewing.attachments.map((a, i) => (
                      <a key={i} href={`${api.defaults.baseURL}/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-2 hover:bg-slate-50" data-testid={`bg-att-${i}`}>
                        <span className="truncate flex items-center gap-1.5"><Paperclip size={12} /> {a.filename} <span className="text-slate-400">({a.doc_type})</span></span>
                        <Download size={13} className="text-blue-600" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Audit trail */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5"><History size={13} /> Audit Trail</h4>
                <div className="space-y-2">
                  {(viewing.status_history || []).map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs" data-testid={`bg-audit-${i}`}>
                      <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                      <div>
                        <div className="text-slate-700"><b>{h.from ? `${ST[h.from]?.label || h.from} → ` : ""}{ST[h.to]?.label || h.to}</b> {h.remarks ? `— ${h.remarks}` : ""}</div>
                        <div className="text-slate-400">{new Date(h.at).toLocaleString("en-IN")} · {h.user_name}</div>
                      </div>
                    </div>
                  ))}
                  {(viewing.status_history || []).length === 0 && <div className="text-xs text-slate-400">No history.</div>}
                </div>
              </div>
            </div>
          )}
          {viewing && canWrite && (
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-lg text-xs gap-1.5" onClick={() => { openEdit(viewing); setViewing(null); }} data-testid="bg-drawer-edit"><Pencil size={13} /> Edit</Button>
              {nextStates(viewing).length > 0 && <Button variant="outline" className="rounded-lg text-xs gap-1.5" onClick={() => setStDialog({ bg: viewing, to: nextStates(viewing)[0], remarks: "" })} data-testid="bg-drawer-status"><ClipboardCheck size={13} /> Change Status</Button>}
              <Button variant="outline" className="rounded-lg text-xs gap-1.5" onClick={() => { openRenew(viewing); setViewing(null); }} data-testid="bg-drawer-renew"><RefreshCw size={13} /> Renew</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* --- tiny presentational helpers --- */
function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{title}</h3>
      {children}
    </div>
  );
}
function Field({ label, hint, children }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-slate-500">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <div className="text-[10px] text-emerald-600 mt-0.5">{hint}</div>}
    </div>
  );
}
function ReadField({ label, value, highlight, sm }) {
  return (
    <div className={sm ? "" : "border-b border-slate-100 pb-2"}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</div>
      <div className={`mt-0.5 font-semibold ${highlight ? "text-blue-700" : "text-slate-900"}`}>{value ?? "—"}</div>
    </div>
  );
}

/* -----------------------------------------------------------------
   Dashboard alert — imported by the Dashboard page. Shows a big red
   bold banner while any active BG's claim expiry is within 30 days
   or already expired.
   ----------------------------------------------------------------- */
export function BGExpiryAlert() {
  const [data, setData] = useState({ expiring: [], expired: [] });
  useEffect(() => {
    api.get("/bank-guarantees/expiring-soon?days=30")
      .then((r) => setData(r.data || { expiring: [], expired: [] }))
      .catch(() => {});
  }, []);
  const total = (data.expiring?.length || 0) + (data.expired?.length || 0);
  if (!total) return null;
  return (
    <div className="border-2 border-red-600 bg-red-50 p-4 shadow-lg" data-testid="bg-expiry-alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={28} />
        <div className="flex-1">
          <div className="text-red-700 font-heading font-black text-lg uppercase tracking-wide">Bank Guarantee Expiry Alert</div>
          <div className="text-red-800 font-bold text-sm mt-1">
            {data.expired.length > 0 && <div>⚠️ {data.expired.length} BG{data.expired.length > 1 ? "s have" : " has"} already <b>EXPIRED</b>.</div>}
            {data.expiring.length > 0 && <div>⏳ {data.expiring.length} BG{data.expiring.length > 1 ? "s expire" : " expires"} within the next 30 days.</div>}
          </div>
          <ul className="mt-2 text-xs text-red-900 space-y-1">
            {[...data.expired, ...data.expiring].slice(0, 6).map((bg) => (
              <li key={bg.id} className="border-l-4 border-red-500 pl-2">
                <span className="font-mono font-bold">{bg.bg_number}</span>{" — "}
                <span>{bg.issued_by}</span>{" · "}
                <span className="font-bold">expires {fmtDate(bg.bg_claim_expiry_date)}</span>
                {bg.in_favour_of ? <span> · in favour of {bg.in_favour_of}</span> : null}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <a href="/bank-guarantees" className="brand-btn rounded-none px-3 py-1 text-xs inline-block" data-testid="bg-alert-cta">Open Bank Guarantee Tracking →</a>
          </div>
        </div>
      </div>
    </div>
  );
}

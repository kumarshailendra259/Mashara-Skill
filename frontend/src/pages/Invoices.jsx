import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  FileText, Filter, RefreshCw, Plus, Download, ArrowRight, Settings, Search,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFY } from "@/context/FYContext";
import FYSwitcher from "@/components/FYSwitcher";

const STAGE_TONES = {
  generated:  "bg-slate-100 text-slate-700 border-slate-300",
  submitted:  "bg-blue-50 text-blue-700 border-blue-300",
  approved:   "bg-indigo-50 text-indigo-700 border-indigo-300",
  processing: "bg-amber-50 text-amber-700 border-amber-300",
  disbursed:  "bg-emerald-50 text-emerald-700 border-emerald-300",
};

const AGING_TONES = {
  normal:    { label: "Normal",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  attention: { label: "Attention", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  overdue:   { label: "Overdue",   cls: "bg-red-50 text-red-700 border-red-200" },
};

const EMPTY_FORM = {
  invoice_no: "", invoice_type: "", milestone_type: "",
  tsp_company_id: "", tsp_company_name: "", district: "",
  center_id: "", project_id: "", batch_id: "",
  total_candidates: 0, amount_payable: 0, adjustment: 0,
  gross_payment: "", deduction: 0, net_payable: "", remarks: "",
};

function fmtDT(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function Invoices() {
  const { user } = useAuth();
  const { fy } = useFY();
  const nav = useNavigate();
  const canWrite = ["admin", "accountant", "hr", "senior_manager", "manager"].includes(user?.role);
  const isAdmin = user?.role === "admin";

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [dashboard, setDashboard] = useState(null);

  const [filters, setFilters] = useState({
    q: "", status: "", company_id: "", center_id: "", project_id: "",
    batch_id: "", invoice_type: "", milestone_type: "",
    from_date: "", to_date: "", aging: "",
  });

  // Masters for filters + create form
  const [companies, setCompanies] = useState([]);
  const [centers, setCenters] = useState([]);
  const [projects, setProjects] = useState([]);
  const [batches, setBatches] = useState([]);

  const [dlgOpen, setDlgOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const [agingDlgOpen, setAgingDlgOpen] = useState(false);
  const [agingCfg, setAgingCfg] = useState({ normal_max_days: 7, attention_max_days: 15 });

  const loadMasters = async () => {
    try {
      const [c, ce, pj] = await Promise.all([
        api.get("/entities/company").catch(() => ({ data: [] })),
        api.get("/entities/center").catch(() => ({ data: [] })),
        api.get("/entities/project").catch(() => ({ data: [] })),
      ]);
      setCompanies(c.data || []);
      setCenters(ce.data || []);
      setProjects(pj.data || []);
      const b = await api.get("/batches").catch(() => ({ data: [] }));
      setBatches(b.data || []);
    } catch (e) {
      // best-effort
    }
  };

  const loadDashboard = async () => {
    const params = new URLSearchParams();
    if (filters.company_id) params.set("company_id", filters.company_id);
    if (filters.center_id) params.set("center_id", filters.center_id);
    if (filters.project_id) params.set("project_id", filters.project_id);
    if (filters.from_date) params.set("from_date", filters.from_date);
    if (filters.to_date) params.set("to_date", filters.to_date);
    if (filters.q) params.set("q", filters.q);
    try {
      const { data } = await api.get(`/invoices/dashboard?${params.toString()}`);
      setDashboard(data);
    } catch (e) {
      // ignore
    }
  };

  const loadRows = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      params.set("page", page);
      params.set("page_size", pageSize);
      const { data } = await api.get(`/invoices?${params.toString()}`);
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (e) {
      toast.error(formatError(e));
      setRows([]);
    }
    setLoading(false);
  };

  const loadAging = async () => {
    try {
      const { data } = await api.get("/finance-settings/aging");
      setAgingCfg({
        normal_max_days: data.normal_max_days,
        attention_max_days: data.attention_max_days,
      });
    } catch { /* noop */ }
  };

  useEffect(() => { loadMasters(); loadAging(); }, []);
  useEffect(() => { loadRows(); loadDashboard(); }, [page, filters, fy]);

  const resetFilters = () => {
    setFilters({
      q: "", status: "", company_id: "", center_id: "", project_id: "",
      batch_id: "", invoice_type: "", milestone_type: "",
      from_date: "", to_date: "", aging: "",
    });
    setPage(1);
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setDlgOpen(true);
  };

  const saveInvoice = async () => {
    if (!form.invoice_no?.trim()) {
      toast.error("Invoice number is required");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form };
      // Auto-fill company name if id chosen
      if (payload.tsp_company_id) {
        const c = companies.find((x) => x.id === payload.tsp_company_id);
        if (c) payload.tsp_company_name = c.name;
      }
      // Coerce numbers
      ["total_candidates", "amount_payable", "adjustment", "deduction"].forEach((k) => {
        payload[k] = Number(payload[k] || 0);
      });
      if (payload.gross_payment === "") delete payload.gross_payment;
      if (payload.net_payable === "") delete payload.net_payable;
      await api.post("/invoices", payload);
      toast.success("Invoice created");
      setDlgOpen(false);
      loadRows();
      loadDashboard();
    } catch (e) {
      toast.error(formatError(e));
    }
    setBusy(false);
  };

  const saveAging = async () => {
    try {
      await api.patch("/finance-settings/aging", {
        normal_max_days: Number(agingCfg.normal_max_days),
        attention_max_days: Number(agingCfg.attention_max_days),
      });
      toast.success("Aging thresholds updated");
      setAgingDlgOpen(false);
      loadRows();
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      if (fy && fy !== "all") params.set("fy", fy);
      const url = `${process.env.REACT_APP_BACKEND_URL}/api/invoices/export.csv?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `invoices_${Date.now()}.csv`;
      a.click();
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const kpiCards = useMemo(() => {
    if (!dashboard) return [];
    const perStageMap = Object.fromEntries((dashboard.per_stage || []).map((s) => [s.id, s]));
    return [
      { key: "total", label: "Total Invoices", value: dashboard.total_invoices, sub: inr(dashboard.total_invoice_value), stageId: null, tone: "bg-slate-50 border-slate-200" },
      { key: "generated",  label: "Generated",             value: perStageMap.generated?.count || 0,  sub: inr(perStageMap.generated?.value || 0),  stageId: "generated",  tone: STAGE_TONES.generated },
      { key: "submitted",  label: "Bill Submitted",        value: perStageMap.submitted?.count || 0,  sub: inr(perStageMap.submitted?.value || 0),  stageId: "submitted",  tone: STAGE_TONES.submitted },
      { key: "approved",   label: "Final Approved",        value: perStageMap.approved?.count || 0,   sub: inr(perStageMap.approved?.value || 0),   stageId: "approved",   tone: STAGE_TONES.approved },
      { key: "processing", label: "Payment In Process",    value: perStageMap.processing?.count || 0, sub: inr(perStageMap.processing?.value || 0), stageId: "processing", tone: STAGE_TONES.processing },
      { key: "disbursed",  label: "Disbursed",             value: perStageMap.disbursed?.count || 0,  sub: inr(perStageMap.disbursed?.value || 0),  stageId: "disbursed",  tone: STAGE_TONES.disbursed },
      { key: "outstanding", label: "Outstanding Amount",   value: null, sub: inr(dashboard.outstanding_amount || 0), stageId: null, tone: "bg-red-50 border-red-200 text-red-800" },
    ];
  }, [dashboard]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5" data-testid="invoices-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="overline">Finance & Accounting</div>
          <h1 className="font-heading font-black text-3xl tracking-tight">Invoice & Payment Tracking</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Track every invoice from portal generation to disbursement across 5 business stages.</p>
        </div>
        <div className="flex items-center gap-2">
          <FYSwitcher variant="inline" />
          <Button variant="outline" size="sm" onClick={() => { loadRows(); loadDashboard(); }} data-testid="btn-refresh">
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="btn-export">
            <Download size={14} className="mr-1" /> Export CSV
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setAgingDlgOpen(true)} data-testid="btn-aging-settings">
              <Settings size={14} className="mr-1" /> Aging Settings
            </Button>
          )}
          {canWrite && (
            <Button size="sm" onClick={openCreate} data-testid="btn-new-invoice">
              <Plus size={14} className="mr-1" /> New Invoice
            </Button>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {kpiCards.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setFilters((f) => ({ ...f, status: k.stageId || "" }))}
            data-testid={`kpi-${k.key}`}
            className={`text-left border p-3 hover:shadow-sm transition-all ${k.tone} ${filters.status === k.stageId ? "ring-2 ring-offset-1 ring-slate-400" : ""}`}
          >
            <div className="overline text-[10px]">{k.label}</div>
            {k.value !== null && (
              <div className="font-heading font-black text-2xl tracking-tight mt-1">{k.value}</div>
            )}
            <div className={`text-[11px] mt-0.5 ${k.value === null ? "font-heading font-black text-xl tracking-tight" : "text-[var(--muted)]"}`}>{k.sub}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="border border-[var(--border)] bg-white p-3">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-[var(--muted)]" />
          <span className="overline text-[11px] font-semibold">Filters</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="col-span-2 md:col-span-2">
            <Label className="text-[11px]">Search</Label>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-2.5 text-[var(--muted)]" />
              <Input
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="Invoice no, company, district, batch…"
                className="pl-8"
                data-testid="filter-search"
              />
            </div>
          </div>
          <div>
            <Label className="text-[11px]">Current Stage</Label>
            <Select value={filters.status || "__all"} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "__all" ? "" : v }))}>
              <SelectTrigger data-testid="filter-status"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Stages</SelectItem>
                <SelectItem value="generated">Generated on Portal</SelectItem>
                <SelectItem value="submitted">Bill Submitted</SelectItem>
                <SelectItem value="approved">Final Approved</SelectItem>
                <SelectItem value="processing">Payment In Process</SelectItem>
                <SelectItem value="disbursed">Disbursed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Aging</Label>
            <Select value={filters.aging || "__all"} onValueChange={(v) => setFilters((f) => ({ ...f, aging: v === "__all" ? "" : v }))}>
              <SelectTrigger data-testid="filter-aging"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="attention">Attention</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Company</Label>
            <Select value={filters.company_id || "__all"} onValueChange={(v) => setFilters((f) => ({ ...f, company_id: v === "__all" ? "" : v }))}>
              <SelectTrigger data-testid="filter-company"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {companies.filter((c) => c.name).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Center</Label>
            <Select value={filters.center_id || "__all"} onValueChange={(v) => setFilters((f) => ({ ...f, center_id: v === "__all" ? "" : v }))}>
              <SelectTrigger data-testid="filter-center"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {centers.filter((c) => c.name).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Project</Label>
            <Select value={filters.project_id || "__all"} onValueChange={(v) => setFilters((f) => ({ ...f, project_id: v === "__all" ? "" : v }))}>
              <SelectTrigger data-testid="filter-project"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {projects.filter((p) => p.name).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Invoice Type</Label>
            <Input value={filters.invoice_type} onChange={(e) => setFilters((f) => ({ ...f, invoice_type: e.target.value }))} placeholder="e.g. Milestone" data-testid="filter-inv-type" />
          </div>
          <div>
            <Label className="text-[11px]">Milestone Type</Label>
            <Input value={filters.milestone_type} onChange={(e) => setFilters((f) => ({ ...f, milestone_type: e.target.value }))} placeholder="M1/M2" data-testid="filter-milestone" />
          </div>
          <div>
            <Label className="text-[11px]">From Date</Label>
            <Input type="date" value={filters.from_date} onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))} data-testid="filter-from" />
          </div>
          <div>
            <Label className="text-[11px]">To Date</Label>
            <Input type="date" value={filters.to_date} onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))} data-testid="filter-to" />
          </div>
          <div className="col-span-2 flex items-end gap-2">
            <Button variant="outline" size="sm" onClick={resetFilters} data-testid="btn-reset">Reset</Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-[var(--border)] bg-white overflow-x-auto">
        <table className="w-full text-sm" data-testid="invoices-table">
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
              <th className="px-3 py-2">Invoice No.</th>
              <th className="px-3 py-2">Generated</th>
              <th className="px-3 py-2">TSP / Company</th>
              <th className="px-3 py-2">District</th>
              <th className="px-3 py-2">Centre</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2 text-right">Candidates</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Net</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Stage Since</th>
              <th className="px-3 py-2">Days Pending</th>
              <th className="px-3 py-2 text-right">Disbursed</th>
              <th className="px-3 py-2 text-right">Outstanding</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="16" className="px-3 py-8 text-center text-[var(--muted)]">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan="16" className="px-3 py-10 text-center text-[var(--muted)]">
                <FileText size={28} className="mx-auto mb-2 opacity-40" />
                No invoices found. {canWrite && <button type="button" className="underline text-[var(--brand)]" onClick={openCreate}>Create the first invoice</button>}
              </td></tr>
            ) : rows.map((r) => {
              const aging = r.aging_bucket ? AGING_TONES[r.aging_bucket] : null;
              return (
                <tr key={r.id} className="border-t border-[var(--border)] hover:bg-slate-50" data-testid={`invoice-row-${r.id}`}>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => nav(`/invoices/${r.id}`)} className="font-semibold text-[var(--brand)] hover:underline" data-testid={`invoice-link-${r.invoice_no}`}>
                      {r.invoice_no}
                    </button>
                    <div className="text-[10px] text-[var(--muted)]">{r.invoice_type || "—"} · {r.milestone_type || "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-[12px] whitespace-nowrap">{fmtDT(r.generated_date)}</td>
                  <td className="px-3 py-2">{r.tsp_company_name || "—"}</td>
                  <td className="px-3 py-2">{r.district || "—"}</td>
                  <td className="px-3 py-2">{r.center_name || "—"}</td>
                  <td className="px-3 py-2">{r.project_name || "—"}</td>
                  <td className="px-3 py-2">{r.batch_no || "—"}</td>
                  <td className="px-3 py-2 text-right num">{r.total_candidates}</td>
                  <td className="px-3 py-2 text-right num">{inr(r.amount_payable)}</td>
                  <td className="px-3 py-2 text-right num font-semibold">{inr(r.net_payable)}</td>
                  <td className="px-3 py-2">
                    <Badge className={`${STAGE_TONES[r.current_stage_id] || "bg-gray-100"} border font-normal`}>{r.current_stage_label || "—"}</Badge>
                  </td>
                  <td className="px-3 py-2 text-[12px] whitespace-nowrap">{fmtDT(r.current_stage_timestamp)}</td>
                  <td className="px-3 py-2">
                    {r.days_pending !== null && r.days_pending !== undefined ? (
                      <div className="flex items-center gap-1">
                        <span className="num text-[12px]">{r.days_pending} d</span>
                        {aging && <Badge className={`${aging.cls} border text-[10px] font-normal px-1.5 py-0`}>{aging.label}</Badge>}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right num">{inr(r.disbursed_amount)}</td>
                  <td className="px-3 py-2 text-right num text-red-700">{inr(r.outstanding_amount)}</td>
                  <td className="px-3 py-2">
                    <Button variant="outline" size="sm" onClick={() => nav(`/invoices/${r.id}`)} data-testid={`btn-view-${r.id}`}>
                      <ArrowRight size={12} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-[var(--muted)]">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="btn-prev">Prev</Button>
            <span className="text-[12px]">Page {page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} data-testid="btn-next">Next</Button>
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
            <DialogDescription>Stage 1 (Generated on Portal) will be stamped automatically at creation.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2 md:col-span-1">
              <Label>Invoice No. *</Label>
              <Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} data-testid="inv-no" />
            </div>
            <div>
              <Label>Invoice Type</Label>
              <Input value={form.invoice_type} onChange={(e) => setForm({ ...form, invoice_type: e.target.value })} placeholder="e.g. Milestone" data-testid="inv-type" />
            </div>
            <div>
              <Label>Milestone Type</Label>
              <Input value={form.milestone_type} onChange={(e) => setForm({ ...form, milestone_type: e.target.value })} placeholder="M1/M2/M3" data-testid="inv-ms" />
            </div>
            <div>
              <Label>TSP / Company</Label>
              <Select value={form.tsp_company_id || "__none"} onValueChange={(v) => setForm({ ...form, tsp_company_id: v === "__none" ? "" : v })}>
                <SelectTrigger data-testid="inv-company"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {companies.filter((c) => c.name).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>District</Label>
              <Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} data-testid="inv-district" />
            </div>
            <div>
              <Label>Training Centre</Label>
              <Select value={form.center_id || "__none"} onValueChange={(v) => setForm({ ...form, center_id: v === "__none" ? "" : v })}>
                <SelectTrigger data-testid="inv-center"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {centers.filter((c) => c.name).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project</Label>
              <Select value={form.project_id || "__none"} onValueChange={(v) => setForm({ ...form, project_id: v === "__none" ? "" : v })}>
                <SelectTrigger data-testid="inv-project"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {projects.filter((p) => p.name).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Batch</Label>
              <Select value={form.batch_id || "__none"} onValueChange={(v) => setForm({ ...form, batch_id: v === "__none" ? "" : v })}>
                <SelectTrigger data-testid="inv-batch"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {batches.filter((b) => b.code || b.name).slice(0, 200).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.code || b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Total Candidates</Label>
              <Input type="number" value={form.total_candidates} onChange={(e) => setForm({ ...form, total_candidates: e.target.value })} data-testid="inv-cand" />
            </div>
            <div>
              <Label>Amount Payable</Label>
              <Input type="number" step="0.01" value={form.amount_payable} onChange={(e) => setForm({ ...form, amount_payable: e.target.value })} data-testid="inv-amount" />
            </div>
            <div>
              <Label>Adjustment</Label>
              <Input type="number" step="0.01" value={form.adjustment} onChange={(e) => setForm({ ...form, adjustment: e.target.value })} data-testid="inv-adj" />
            </div>
            <div>
              <Label>Deduction</Label>
              <Input type="number" step="0.01" value={form.deduction} onChange={(e) => setForm({ ...form, deduction: e.target.value })} data-testid="inv-ded" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <Label>Remarks</Label>
              <Textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} data-testid="inv-remarks" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button onClick={saveInvoice} disabled={busy} data-testid="btn-save-invoice">
              {busy ? "Saving…" : "Create Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aging settings dialog */}
      <Dialog open={agingDlgOpen} onOpenChange={setAgingDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aging Thresholds</DialogTitle>
            <DialogDescription>Days pending buckets for Normal / Attention / Overdue.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Normal — up to (days)</Label>
              <Input type="number" value={agingCfg.normal_max_days} onChange={(e) => setAgingCfg((a) => ({ ...a, normal_max_days: e.target.value }))} data-testid="aging-normal" />
            </div>
            <div>
              <Label>Attention — up to (days)</Label>
              <Input type="number" value={agingCfg.attention_max_days} onChange={(e) => setAgingCfg((a) => ({ ...a, attention_max_days: e.target.value }))} data-testid="aging-attention" />
            </div>
            <div className="text-[11px] text-[var(--muted)]">Anything beyond the Attention threshold is flagged as Overdue.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAgingDlgOpen(false)}>Cancel</Button>
            <Button onClick={saveAging} data-testid="btn-save-aging">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList,
} from "recharts";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { inr } from "@/lib/i18n";
import {
  Target, PackageCheck, Layers3, Percent, Building2, Users2, IndianRupee, ShieldCheck,
  Wallet, TrendingUp, Search, RotateCcw, Download, Plus, ChevronDown, Eye, Pencil,
  MoreVertical, ArrowUpDown, ChevronLeft, ChevronRight, AlertTriangle, FileText,
  GraduationCap, ClipboardCheck, Briefcase, CheckCircle2, CircleDashed, Trash2,
  UserPlus, MapPin, X,
} from "lucide-react";

const nfmt = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("en-IN"));
const PAGE_SIZE = 8;

// Utilization → visual tone
const utilTone = (p) => {
  const v = Number(p) || 0;
  if (v >= 80) return { pill: "bg-emerald-50 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", hex: "#10B981" };
  if (v >= 50) return { pill: "bg-amber-50 text-amber-700 border-amber-200", bar: "bg-amber-500", hex: "#F59E0B" };
  return { pill: "bg-red-50 text-red-700 border-red-200", bar: "bg-red-500", hex: "#EF4444" };
};
// Utilization → status label
const utilStatus = (p, allocated) => {
  const v = Number(p) || 0;
  if (v === 0) return { label: "Not Started", cls: "bg-slate-100 text-slate-700 border-slate-200" };
  if (v >= 100) return { label: "Completed", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" };
  if (v >= 80) return { label: "On Track", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (v >= 50) return { label: "In Progress", cls: "bg-blue-50 text-blue-700 border-blue-200" };
  return { label: "At Risk", cls: "bg-red-50 text-red-700 border-red-200" };
};
// Target allocation status
const allocStatus = (p) => {
  const v = Number(p) || 0;
  if (v >= 80) return { label: "On Track", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (v >= 50) return { label: "In Progress", cls: "bg-blue-50 text-blue-700 border-blue-200" };
  if (v >= 1) return { label: "Attention", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "Critical", cls: "bg-red-50 text-red-700 border-red-200" };
};

const KPI_META = {
  total_target: { icon: Target, tint: "bg-blue-50", ic: "bg-blue-600/10 text-blue-700", bar: "bg-blue-500" },
  allocated: { icon: PackageCheck, tint: "bg-indigo-50", ic: "bg-indigo-600/10 text-indigo-700", bar: "bg-indigo-500" },
  remaining: { icon: Layers3, tint: "bg-purple-50", ic: "bg-purple-600/10 text-purple-700", bar: "bg-purple-500" },
  utilization: { icon: Percent, tint: "bg-emerald-50", ic: "bg-emerald-600/10 text-emerald-700", bar: "bg-emerald-500" },
  centres: { icon: Building2, tint: "bg-sky-50", ic: "bg-sky-600/10 text-sky-700", bar: "bg-sky-500" },
  batches: { icon: Users2, tint: "bg-amber-50", ic: "bg-amber-600/10 text-amber-700", bar: "bg-amber-500" },
};

function KpiCard({ metaKey, label, value, onClick, testid }) {
  const m = KPI_META[metaKey];
  const Icon = m.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="text-left relative overflow-hidden bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 group flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-blue-500/40"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`p-2 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105 ${m.ic}`}>
          <Icon size={16} />
        </span>
      </div>
      <div className="text-2xl font-bold tracking-tight text-slate-900 font-heading">{value}</div>
      <div className={`h-1 w-full rounded-full mt-3 ${m.bar}/70`} />
    </button>
  );
}

function FinCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm hover:border-slate-300 hover:shadow-md transition-all flex items-center gap-3">
      <span className={`p-2.5 rounded-lg ${accent}`}><Icon size={18} /></span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 truncate">{label}</div>
        <div className="text-xl font-bold text-slate-900 font-heading mt-0.5">{value}</div>
      </div>
    </div>
  );
}

function Card({ title, right, children, className = "" }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200/80 shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-slate-800 font-heading">{title}</h3>
          {right}
        </div>
      )}
      <div className={title ? "px-4 pb-4" : "p-4"}>{children}</div>
    </div>
  );
}

export default function BatchDashboard({
  kpi, cards = {}, grandTotal = {}, summaryRows = [], targets = [], batches = [], woList = [],
  filters, setFilter, clearFilters, projects = [], centers = [], fyOptions = [], loading,
  canManageWO, canManageTargets, canManageBatches,
  onAddWO, onAllocateTarget, onCreateBatch, onEditWO, onEditTarget, onCreateBatchForTarget,
  onDeleteWO, goToStage, fetchWOs,
}) {
  // ---- Derived metrics (targets-based, responsive to the global filter bar) ----
  const scopedTargets = useMemo(() => {
    const q = (filters.q || "").trim().toLowerCase();
    return targets.filter((t) => {
      if (filters.project_id !== "all" && t.project_id !== filters.project_id) return false;
      if (filters.center_id !== "all" && t.center_id !== filters.center_id) return false;
      if (filters.fy !== "all" && (t.fy || t.target_year || "") !== filters.fy) return false;
      if (q && ![t.project_name, t.center_name, t.company_name].some((v) => (v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [targets, filters]);

  const scopedBatches = useMemo(() => {
    const q = (filters.q || "").trim().toLowerCase();
    return batches.filter((b) => {
      if (filters.project_id !== "all" && b.project_id !== filters.project_id) return false;
      if (filters.center_id !== "all" && b.center_id !== filters.center_id) return false;
      if (filters.fy !== "all" && (b.fy_year || b.target_year || "") !== filters.fy) return false;
      if (q && !((b.name || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [batches, filters]);

  const totalTarget = scopedTargets.reduce((s, t) => s + (Number(t.total_target) || 0), 0);
  const allocated = scopedTargets.reduce((s, t) => s + (Number(t.allocated) || 0), 0);
  const remaining = scopedTargets.reduce((s, t) => s + (Number(t.remaining) || 0), 0);
  const utilization = totalTarget ? Math.round((allocated / totalTarget) * 100) : 0;

  const activeCentres = useMemo(() => {
    const s = new Set(scopedTargets.map((t) => t.center_id).filter(Boolean));
    if (s.size) return s.size;
    return new Set(summaryRows.map((r) => r.center_id).filter(Boolean)).size;
  }, [scopedTargets, summaryRows]);

  const activeBatches = scopedBatches.filter((b) => !b.closed).length;

  const donutData = [
    { name: "Allocated", value: allocated, color: "#2563EB" },
    { name: "Remaining", value: Math.max(0, remaining), color: "#CBD5E1" },
  ];

  const centreBars = useMemo(() => {
    const m = {};
    summaryRows.forEach((r) => {
      const key = r.center_name || "—";
      m[key] = (m[key] || 0) + (Number(r.total_wo_value) || 0);
    });
    return Object.entries(m)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [summaryRows]);

  const lifecycle = useMemo(() => {
    const bs = scopedBatches;
    const enrolled = bs.reduce((s, b) => s + (Number(b.enrolled) || 0), 0);
    const placed = bs.reduce((s, b) => s + (Number(b.placed_candidates) || 0), 0);
    const certified = bs.reduce((s, b) => s + (Number(b.passed_candidates) || 0), 0);
    const closed = bs.filter((b) => (b.lifecycle_status === "Closed" || b.closed)).length;
    return [
      { key: "targets", label: "Target", icon: Target, value: nfmt(totalTarget) },
      { key: "targets", label: "Allocated", icon: PackageCheck, value: nfmt(allocated) },
      { key: "batches", label: "Batches", icon: Layers3, value: nfmt(bs.length) },
      { key: "enroll", label: "Enrolled", icon: GraduationCap, value: enrolled ? nfmt(enrolled) : "—" },
      { key: "attendance", label: "Attendance", icon: ClipboardCheck, value: "—" },
      { key: "assessment", label: "Assessment", icon: ClipboardCheck, value: certified ? nfmt(certified) : "—" },
      { key: "placement", label: "Placement", icon: Briefcase, value: placed ? nfmt(placed) : "—" },
      { key: "closure", label: "Closure", icon: CheckCircle2, value: closed ? nfmt(closed) : "—" },
    ];
  }, [scopedBatches, totalTarget, allocated]);

  const pending = useMemo(() => {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const notAllocated = targets.filter((t) => (t.allocated || 0) === 0).length;
    const pendingCreation = targets.filter((t) => (t.remaining || 0) > 0).length;
    const assessPending = batches.filter((b) => ["Training Completed", "Assessment Pending", "Certification Pending"].includes(b.lifecycle_status)).length;
    const placePending = batches.filter((b) => ["Certified", "Placement in Progress"].includes(b.lifecycle_status)).length;
    const woExpiring = woList.filter((w) => w.effective_status === "active" && w.expiry_date && w.expiry_date >= today && w.expiry_date <= soon).length;
    return [
      { dot: "bg-red-500", n: notAllocated, label: "Targets not allocated", stage: "targets" },
      { dot: "bg-orange-500", n: pendingCreation, label: "Batches pending creation", stage: "batches" },
      { dot: "bg-amber-500", n: assessPending, label: "Assessments pending", stage: "assessment" },
      { dot: "bg-orange-500", n: placePending, label: "Placement records pending", stage: "placement" },
      { dot: "bg-red-500", n: woExpiring, label: "Work Orders nearing expiry", stage: "targets" },
    ];
  }, [targets, batches, woList]);

  const attention = useMemo(() =>
    targets.filter((t) => (t.allocated || 0) === 0 && (t.total_target || 0) > 0)
      .sort((a, b) => (b.total_target || 0) - (a.total_target || 0))
      .slice(0, 4), [targets]);

  // ---- WO summary table: sort + paginate ----
  const [sort, setSort] = useState({ key: "total_wo_value", dir: "desc" });
  const [page, setPage] = useState(1);
  const sortBy = (key) => {
    setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
    setPage(1);
  };
  const sortedRows = useMemo(() => {
    const rows = [...summaryRows];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const av = a[key], bv = b[key];
      const na = typeof av === "number", nb = typeof bv === "number";
      let c;
      if (na && nb) c = av - bv;
      else c = String(av ?? "").localeCompare(String(bv ?? ""));
      return dir === "asc" ? c : -c;
    });
    return rows;
  }, [summaryRows, sort]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ---- Drawer ----
  const [drawer, setDrawer] = useState({ open: false, row: null, wos: [], loading: false });
  const openDrawer = async (row) => {
    setDrawer({ open: true, row, wos: [], loading: true });
    let wos = [];
    try { wos = await fetchWOs(row); } catch { /* noop */ }
    setDrawer((d) => (d.row === row ? { ...d, wos, loading: false } : d));
  };
  const drawerBatches = useMemo(() => {
    const r = drawer.row;
    if (!r) return [];
    return batches.filter((b) => b.project_id === r.project_id && b.center_id === r.center_id
      && ((b.fy_year || b.target_year || "") === (r.fy || "")));
  }, [drawer.row, batches]);
  const drawerCandidates = drawerBatches.reduce((s, b) => s + (Number(b.enrolled) || 0), 0);

  const exportCsv = () => {
    const headers = ["Project", "Centre", "FY", "Work Order No", "Total Target", "Allocated", "Remaining", "Utilization%", "WO Value", "PBG Amount", "Status"];
    const lines = sortedRows.map((r) => [
      r.project_name, r.center_name, r.fy,
      r.wo_count > 1 ? `${r.wo_count} WOs` : (r.wo_number || ""),
      r.total_target, r.allocated, r.remaining, r.utilization_pct,
      r.total_wo_value, r.pbg_amount, utilStatus(r.utilization_pct, r.allocated).label,
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const csv = [headers.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "work_order_financial_summary.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const SortTh = ({ k, children, right }) => (
    <th className={`py-2.5 px-3 ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => sortBy(k)} className={`inline-flex items-center gap-1 hover:text-slate-900 ${right ? "flex-row-reverse" : ""}`} data-testid={`wo-sort-${k}`}>
        {children}<ArrowUpDown size={11} className={sort.key === k ? "text-blue-600" : "text-slate-300"} />
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      {/* ============ HEADER ============ */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="space-y-1.5">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-heading flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-blue-900 text-white"><Layers3 size={20} /></span>
            Batch Management
          </h1>
          <div className="text-sm text-slate-500">Complete Batch Lifecycle</div>
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            {["Target Allocation", "Batch Creation", "Enrollment", "Attendance", "Assessment", "Placement", "Closure"].map((s, i, arr) => (
              <React.Fragment key={s}>
                <span className="text-[11px] font-medium text-slate-500">{s}</span>
                {i < arr.length - 1 && <ChevronRight size={11} className="text-slate-300" />}
              </React.Fragment>
            ))}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-blue-900 hover:bg-blue-800 text-white rounded-lg gap-2 shadow-sm" data-testid="quick-actions-btn">
              <Plus size={15} /> Quick Actions <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canManageWO && <DropdownMenuItem onClick={() => onAddWO()} data-testid="qa-work-order"><FileText size={14} className="mr-2" /> Work Order</DropdownMenuItem>}
            {canManageTargets && <DropdownMenuItem onClick={() => onAllocateTarget()} data-testid="qa-allocate-target"><Target size={14} className="mr-2" /> Allocate Target</DropdownMenuItem>}
            {canManageBatches && <DropdownMenuItem onClick={() => onCreateBatch()} data-testid="qa-create-batch"><Layers3 size={14} className="mr-2" /> Create Batch</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => goToStage("enroll")} data-testid="qa-add-candidate"><UserPlus size={14} className="mr-2" /> Add Candidate</DropdownMenuItem>
            <DropdownMenuItem onClick={() => goToStage("placement")} data-testid="qa-record-placement"><Briefcase size={14} className="mr-2" /> Record Placement</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ============ KPI ROW ============ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <KpiCard metaKey="total_target" label="Total Target" value={nfmt(totalTarget)} testid="kpi-total-target" onClick={() => goToStage("targets")} />
        <KpiCard metaKey="allocated" label="Allocated" value={nfmt(allocated)} testid="kpi-allocated" onClick={() => goToStage("batches")} />
        <KpiCard metaKey="remaining" label="Remaining" value={nfmt(remaining)} testid="kpi-remaining" onClick={() => goToStage("targets")} />
        <KpiCard metaKey="utilization" label="Utilization" value={`${utilization}%`} testid="kpi-utilization" onClick={() => goToStage("targets")} />
        <KpiCard metaKey="centres" label="Active Centres" value={nfmt(activeCentres)} testid="kpi-centres" onClick={() => goToStage("targets")} />
        <KpiCard metaKey="batches" label="Active Batches" value={nfmt(activeBatches)} testid="kpi-active-batches" onClick={() => goToStage("batches")} />
      </div>

      {/* ============ FINANCIAL ROW ============ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <FinCard icon={IndianRupee} label="Total Work Order Value" value={inr(cards.total_work_order_value || 0)} accent="bg-blue-600/10 text-blue-700" />
        <FinCard icon={ShieldCheck} label="Total PBG Amount" value={inr(cards.total_pbg_amount || 0)} accent="bg-emerald-600/10 text-emerald-700" />
        <FinCard icon={Wallet} label="Allocated Value" value={inr(cards.allocated_value || 0)} accent="bg-violet-600/10 text-violet-700" />
        <FinCard icon={TrendingUp} label="Average Work Order Value" value={inr(cards.average_work_order_value || 0)} accent="bg-amber-600/10 text-amber-700" />
      </div>

      {/* ============ FILTER BAR ============ */}
      <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
            placeholder="Search by Project / Centre / Company / WO No."
            className="pl-9 h-9 rounded-lg bg-slate-50 border-slate-200 text-sm"
            data-testid="dash-search"
          />
        </div>
        <Select value={filters.project_id} onValueChange={(v) => setFilter("project_id", v)}>
          <SelectTrigger className="h-9 w-40 rounded-lg bg-slate-50 border-slate-200 text-xs" data-testid="dash-filter-project"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Projects</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.center_id} onValueChange={(v) => setFilter("center_id", v)}>
          <SelectTrigger className="h-9 w-40 rounded-lg bg-slate-50 border-slate-200 text-xs" data-testid="dash-filter-center"><SelectValue placeholder="Centre" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Centres</SelectItem>{centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.fy} onValueChange={(v) => setFilter("fy", v)}>
          <SelectTrigger className="h-9 w-32 rounded-lg bg-slate-50 border-slate-200 text-xs" data-testid="dash-filter-fy"><SelectValue placeholder="FY" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All FY</SelectItem>{fyOptions.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilter("status", v)}>
          <SelectTrigger className="h-9 w-32 rounded-lg bg-slate-50 border-slate-200 text-xs" data-testid="dash-filter-status"><SelectValue placeholder="WO Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={clearFilters} className="h-9 rounded-lg text-xs gap-1.5 border-slate-200" data-testid="dash-clear-filters"><RotateCcw size={13} /> Clear All</Button>
        <Button onClick={exportCsv} className="h-9 rounded-lg text-xs gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 shadow-none" data-testid="dash-export"><Download size={13} /> Export</Button>
      </div>

      {/* ============ ANALYTICS 4-COL ============ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
        {/* A · Donut */}
        <div className="col-span-12 lg:col-span-3">
          <Card title="Target Utilization" className="h-full">
            <div className="flex items-center gap-3">
              <div className="relative w-[120px] h-[120px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" innerRadius={40} outerRadius={56} paddingAngle={2} stroke="none">
                      {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold text-slate-900 font-heading">{utilization}%</span>
                </div>
              </div>
              <div className="text-xs space-y-2 flex-1">
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-600" /><span className="text-slate-500">Allocated</span><span className="ml-auto font-semibold text-slate-800">{nfmt(allocated)}</span></div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-slate-300" /><span className="text-slate-500">Remaining</span><span className="ml-auto font-semibold text-slate-800">{nfmt(remaining)}</span></div>
                <div className="pt-2 border-t border-slate-100"><span className="text-slate-500">Total Target</span><div className="font-bold text-slate-900 text-sm">{nfmt(totalTarget)}</div></div>
              </div>
            </div>
          </Card>
        </div>
        {/* B · Centre bar */}
        <div className="col-span-12 lg:col-span-4">
          <Card title="Centre-wise Work Order Value" className="h-full">
            {centreBars.length === 0 ? (
              <div className="text-xs text-slate-400 py-8 text-center">No work order data</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(140, centreBars.length * 34)}>
                <BarChart data={centreBars} layout="vertical" margin={{ left: 4, right: 60, top: 4, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => inr(v)} cursor={{ fill: "#f1f5f9" }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16} cursor="pointer"
                    onClick={(d) => { const c = centers.find((x) => x.name === d.name); if (c) setFilter("center_id", c.id); }}>
                    {centreBars.map((_, i) => <Cell key={i} fill={i % 2 === 0 ? "#1E3A8A" : "#3B82F6"} />)}
                    <LabelList dataKey="value" position="right" formatter={(v) => inr(v)} style={{ fontSize: 10, fill: "#334155" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
        {/* C · Lifecycle */}
        <div className="col-span-12 lg:col-span-3">
          <Card title="Batch Lifecycle" className="h-full">
            <div className="grid grid-cols-2 gap-2">
              {lifecycle.map((s, i) => {
                const Icon = s.icon;
                return (
                  <button key={i} onClick={() => goToStage(s.key)} className="text-left p-2 rounded-lg border border-slate-100 hover:bg-slate-50 hover:border-slate-200 transition-colors" data-testid={`lifecycle-${s.label.toLowerCase()}`}>
                    <div className="flex items-center gap-1.5 text-slate-400"><Icon size={12} /><span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{s.label}</span></div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5">{s.value}</div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
        {/* D · Pending Actions */}
        <div className="col-span-12 lg:col-span-2">
          <Card title="Pending Actions" className="h-full">
            <div className="space-y-2.5">
              {pending.map((p, i) => (
                <button key={i} onClick={() => goToStage(p.stage)} className="w-full flex items-center gap-2 text-left group" data-testid={`pending-${i}`}>
                  <span className={`w-6 h-6 shrink-0 rounded-full ${p.dot} text-white text-[11px] font-bold flex items-center justify-center`}>{p.n}</span>
                  <span className="text-[11px] text-slate-600 group-hover:text-slate-900 leading-tight">{p.label}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ============ ATTENTION REQUIRED ============ */}
      {attention.length > 0 && (
        <Card title="Attention Required">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {attention.map((t) => (
              <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/70" data-testid={`attention-${t.id}`}>
                <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                <span className="text-xs text-slate-700 flex-1"><b>{t.center_name || t.project_name}</b> has {nfmt(t.total_target)} unallocated targets</span>
                {canManageBatches && (t.remaining || 0) > 0 && (
                  <Button size="sm" onClick={() => onCreateBatchForTarget(t)} className="h-7 text-[11px] rounded-lg bg-amber-600 hover:bg-amber-700 text-white" data-testid={`attention-act-${t.id}`}>Allocate</Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ============ WORK ORDER FINANCIAL SUMMARY ============ */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800 font-heading">Work Order Financial Summary</h3>
          <span className="text-[11px] text-slate-400">{sortedRows.length} record(s)</span>
        </div>
        <div className="overflow-x-auto max-h-[460px]">
          <table className="w-full text-xs min-w-[960px]">
            <thead className="bg-slate-50/90 text-[11px] font-semibold text-slate-600 uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm">
              <tr>
                <SortTh k="project_name">Project</SortTh>
                <SortTh k="center_name">Centre</SortTh>
                <SortTh k="fy">FY</SortTh>
                <th className="py-2.5 px-3 text-left">Work Order No.</th>
                <SortTh k="total_target" right>Total Target</SortTh>
                <SortTh k="allocated" right>Allocated</SortTh>
                <SortTh k="remaining" right>Remaining</SortTh>
                <SortTh k="utilization_pct">Utilization</SortTh>
                <SortTh k="total_wo_value" right>WO Value</SortTh>
                <SortTh k="pbg_amount" right>PBG Amount</SortTh>
                <th className="py-2.5 px-3 text-left">Status</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={12} className="p-6 text-center text-slate-400">Loading…</td></tr>}
              {!loading && pageRows.length === 0 && <tr><td colSpan={12} className="p-8 text-center text-slate-400">No work orders match your filters.</td></tr>}
              {pageRows.map((r, i) => {
                const tone = utilTone(r.utilization_pct);
                const st = utilStatus(r.utilization_pct, r.allocated);
                return (
                  <tr key={i} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors text-slate-800" data-testid={`wo-row-${r.project_id}-${r.center_id}-${r.fy}`}>
                    <td className="py-2.5 px-3 font-semibold">{r.project_name || "—"}</td>
                    <td className="py-2.5 px-3">{r.center_name || "—"}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{r.fy || "—"}</td>
                    <td className="py-2.5 px-3 font-mono text-blue-700">{r.wo_count > 1 ? `${r.wo_count} WOs` : (r.wo_number || "—")}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{nfmt(r.total_target)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-700">{nfmt(r.allocated)}</td>
                    <td className="py-2.5 px-3 text-right text-amber-700 font-semibold">{nfmt(r.remaining)}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2 w-28">
                        <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${tone.bar}`} style={{ width: `${Math.min(100, r.utilization_pct || 0)}%` }} /></div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${tone.pill}`}>{r.utilization_pct || 0}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-900">{inr(r.total_wo_value || 0)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{inr(r.pbg_amount || 0)}</td>
                    <td className="py-2.5 px-3"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span></td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => openDrawer(r)} className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded flex items-center gap-1" data-testid={`wo-view-${r.project_id}-${r.center_id}-${r.fy}`}><Eye size={12} /> View</button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 text-slate-500 hover:bg-slate-100 rounded" data-testid={`wo-more-${r.project_id}-${r.center_id}-${r.fy}`}><MoreVertical size={14} /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => goToStage("batches")}><Layers3 size={13} className="mr-2" /> View Batches</DropdownMenuItem>
                            {canManageWO && drawer.row !== r && <DropdownMenuItem onClick={() => openDrawer(r)}><FileText size={13} className="mr-2" /> Financials</DropdownMenuItem>}
                            {canManageTargets && <DropdownMenuItem onClick={() => onCreateBatchForTarget({ project_id: r.project_id, center_id: r.center_id })}><Plus size={13} className="mr-2" /> Add Batch</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {sortedRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold text-slate-800 border-t-2 border-slate-200">
                  <td className="py-2.5 px-3" colSpan={4}>GRAND TOTAL</td>
                  <td className="py-2.5 px-3 text-right">{nfmt(grandTotal.total_target)}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-700">{nfmt(grandTotal.allocated)}</td>
                  <td className="py-2.5 px-3 text-right text-amber-700">{nfmt(grandTotal.remaining)}</td>
                  <td className="py-2.5 px-3">{totalTarget ? Math.round((grandTotal.allocated / grandTotal.total_target) * 100) : 0}%</td>
                  <td className="py-2.5 px-3 text-right">{inr(grandTotal.total_wo_value || 0)}</td>
                  <td className="py-2.5 px-3 text-right">{inr(grandTotal.pbg_amount || 0)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-slate-100">
            <span className="text-[11px] text-slate-400">Page {page} of {pageCount}</span>
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded border border-slate-200 text-slate-500 disabled:opacity-40 hover:bg-slate-50" data-testid="wo-page-prev"><ChevronLeft size={14} /></button>
            <button disabled={page === pageCount} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded border border-slate-200 text-slate-500 disabled:opacity-40 hover:bg-slate-50" data-testid="wo-page-next"><ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      {/* ============ TARGET ALLOCATION (BY CENTRE) ============ */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800 font-heading">Target Allocation <span className="text-slate-400 font-normal">(By Centre)</span></h3>
        </div>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-xs min-w-[860px]">
            <thead className="bg-slate-50/90 text-[11px] font-semibold text-slate-600 uppercase tracking-wider sticky top-0 z-10">
              <tr className="[&>th]:py-2.5 [&>th]:px-3 [&>th]:text-left">
                <th>Project</th><th>Centre</th><th>FY</th>
                <th className="!text-right">Target</th><th className="!text-right">Allocated</th><th className="!text-right">Remaining</th>
                <th>Progress</th><th>Status</th><th className="!text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {targets.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-slate-400">No targets allocated yet.</td></tr>}
              {targets.map((t) => {
                const util = t.total_target ? Math.round((t.allocated || 0) / t.total_target * 100) : 0;
                const tone = utilTone(util);
                const st = allocStatus(util);
                return (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors text-slate-800" data-testid={`ta-row-${t.id}`}>
                    <td className="py-2.5 px-3 font-semibold">{t.project_name || "—"}</td>
                    <td className="py-2.5 px-3">{t.center_name || <span className="text-slate-400 italic">All centres</span>}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{t.target_year || t.fy}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{nfmt(t.total_target)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-700">{nfmt(t.allocated)}</td>
                    <td className="py-2.5 px-3 text-right text-amber-700 font-semibold">{nfmt(t.remaining)}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2 w-36">
                        <div className="h-2 flex-1 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${tone.bar}`} style={{ width: `${Math.min(100, util)}%` }} /></div>
                        <span className="text-[10px] font-bold text-slate-500 w-8 text-right">{util}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span></td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        {(t.remaining || 0) > 0 && canManageBatches && (
                          <button onClick={() => onCreateBatchForTarget(t)} className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded flex items-center gap-1" data-testid={`ta-batch-${t.id}`}><Plus size={12} /> Batch</button>
                        )}
                        {canManageTargets && <button onClick={() => onEditTarget(t)} className="p-1 text-slate-500 hover:bg-slate-100 rounded" data-testid={`ta-edit-${t.id}`}><Pencil size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============ WORK ORDER DETAILS DRAWER ============ */}
      <Sheet open={drawer.open} onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col" data-testid="wo-drawer">
          <SheetHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <SheetTitle className="font-heading">Work Order Details</SheetTitle>
            <SheetDescription className="text-xs">{drawer.row ? `${drawer.row.project_name} · ${drawer.row.center_name} · ${drawer.row.fy}` : ""}</SheetDescription>
          </SheetHeader>
          {drawer.row && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold font-heading text-slate-900">{drawer.row.wo_count > 1 ? `${drawer.row.wo_count} Work Orders` : (drawer.row.wo_number || "—")}</span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${utilStatus(drawer.row.utilization_pct, drawer.row.allocated).cls}`}>{utilStatus(drawer.row.utilization_pct, drawer.row.allocated).label}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  ["Project", drawer.row.project_name],
                  ["Centre", drawer.row.center_name],
                  ["Financial Year", drawer.row.fy],
                  ["Work Order Value", inr(drawer.row.total_wo_value || 0)],
                  ["PBG Amount", inr(drawer.row.pbg_amount || 0)],
                  ["Total Target", nfmt(drawer.row.total_target)],
                  ["Allocated Target", nfmt(drawer.row.allocated)],
                  ["Remaining Target", nfmt(drawer.row.remaining)],
                  ["Batch Count", nfmt(drawerBatches.length)],
                  ["Candidate Count", nfmt(drawerCandidates)],
                ].map(([k, v]) => (
                  <div key={k} className="border-b border-slate-100 pb-2">
                    <dt className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{k}</dt>
                    <dd className="text-slate-900 font-semibold mt-0.5">{v ?? "—"}</dd>
                  </div>
                ))}
              </dl>
              {drawer.wos.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Linked Work Orders</div>
                  <div className="space-y-1.5">
                    {drawer.wos.map((w) => (
                      <div key={w.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-2">
                        <span className="font-mono font-semibold text-blue-700">{w.wo_number}</span>
                        <span className="text-slate-500">{inr(w.work_order_value || 0)}</span>
                        {canManageWO && <button onClick={() => { onEditWO(w); setDrawer((d) => ({ ...d, open: false })); }} className="text-slate-500 hover:text-blue-700" data-testid={`drawer-edit-wo-${w.id}`}><Pencil size={13} /></button>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {drawer.loading && <div className="text-xs text-slate-400">Loading work orders…</div>}
            </div>
          )}
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 grid grid-cols-2 gap-2">
            <Button variant="outline" className="rounded-lg text-xs gap-1.5" onClick={() => { setDrawer((d) => ({ ...d, open: false })); goToStage("batches"); }} data-testid="drawer-view-batches"><Layers3 size={14} /> View Batches</Button>
            <Button variant="outline" className="rounded-lg text-xs gap-1.5" onClick={() => { setDrawer((d) => ({ ...d, open: false })); goToStage("targets"); }} data-testid="drawer-view-financials"><Wallet size={14} /> View Financials</Button>
            {canManageWO && drawer.wos[0] && <Button className="rounded-lg text-xs gap-1.5 bg-blue-900 hover:bg-blue-800 col-span-2" onClick={() => { onEditWO(drawer.wos[0]); setDrawer((d) => ({ ...d, open: false })); }} data-testid="drawer-edit"><Pencil size={14} /> Edit Work Order</Button>}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

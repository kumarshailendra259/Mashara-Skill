import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { toBaseQty, toBaseFactor, compatibleUnits, isCompatible, displayLine } from "@/lib/units";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import {
  UtensilsCrossed, RefreshCw, Package, ClipboardList, BookOpen, LayoutDashboard,
  Plus, Check, X, Trash2, Download, PackagePlus, Soup, AlertTriangle, Boxes,
  IndianRupee, Users, TrendingDown, FileWarning, Pencil, Lock, Scale, CalendarCheck, Unlock,
  Wallet, Upload, FileText, Clock, FileBarChart2,
  CheckCircle2, XCircle, History, ChevronDown, ChevronUp, ChevronRight, ArrowUpDown, Search, PlusCircle, ArrowUpRight, Layers,
} from "lucide-react";

const API_ENTRY_ROLES = ["admin", "senior_manager", "manager", "center_manager", "mess_staff"];
const API_APPROVE_ROLES = ["admin", "senior_manager", "manager", "accountant"];
const API_ADMIN_ROLES = ["admin", "senior_manager", "manager", "center_manager"];

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function MessManagement() {
  const { user } = useAuth();
  const canEntry = API_ENTRY_ROLES.includes(user?.role);
  const canApprove = API_APPROVE_ROLES.includes(user?.role);
  const canAdmin = API_ADMIN_ROLES.includes(user?.role);

  const [tab, setTab] = useState("dashboard");
  const [centers, setCenters] = useState([]);
  const [centerId, setCenterId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);

  const [dash, setDash] = useState(null);
  const [items, setItems] = useState([]);
  const [stock, setStock] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [consumption, setConsumption] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [units, setUnits] = useState([]);
  const [closing, setClosing] = useState(null);
  const [stockCounts, setStockCounts] = useState([]);

  const [itemDlg, setItemDlg] = useState(null);      // item being created/edited
  const [receiptDlg, setReceiptDlg] = useState(false);
  const [receiptPrefill, setReceiptPrefill] = useState(null);   // item_id to pre-fill as a (removable) line
  const [consDlg, setConsDlg] = useState(null);      // "consumption" | "wastage"

  const centerParam = centerId ? `?center_id=${centerId}` : "";

  const loadCenters = async () => {
    try {
      const { data } = await api.get("/mess/centers");
      const list = Array.isArray(data) ? data : [];
      setCenters(list);
      if (list.length === 1) setCenterId((prev) => prev || list[0].id);
    } catch (e) { /* ignore */ }
  };

  const loadUnits = async () => {
    try { const { data } = await api.get("/mess/units"); setUnits(data.units || []); } catch (e) {}
  };

  const refresh = async () => {
    setLoading(true);
    try {
      if (tab === "dashboard") {
        const { data } = await api.get(`/mess/dashboard${centerParam}${centerParam ? "&" : "?"}date=${date}`);
        setDash(data);
        const { data: low } = await api.get(`/mess/stock${centerParam}${centerParam ? "&" : "?"}low_only=true`);
        setStock(low);
      } else if (tab === "items") {
        const { data } = await api.get("/mess/items");
        setItems(data);
      } else if (tab === "stock") {
        const { data } = await api.get(`/mess/stock${centerParam}`);
        setStock(data);
      } else if (tab === "receipts") {
        const { data } = await api.get(`/mess/receipts${centerParam}`);
        setReceipts(data);
      } else if (tab === "consumption") {
        const { data } = await api.get(`/mess/consumption${centerParam}${centerParam ? "&" : "?"}date=${date}`);
        setConsumption(data);
      } else if (tab === "ledger") {
        const { data } = await api.get(`/mess/ledger${centerParam}`);
        setLedger(data);
      } else if (tab === "closing") {
        if (centerId) {
          const { data } = await api.get(`/mess/closing?center_id=${centerId}&date=${date}`);
          setClosing(data);
        } else { setClosing(null); }
      } else if (tab === "stockcount") {
        const { data } = await api.get(`/mess/stock-counts${centerParam}`);
        setStockCounts(data);
        const { data: st } = await api.get(`/mess/stock${centerParam}`);
        setStock(st);
      }
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadCenters(); loadUnits(); api.get("/mess/items").then(r => setItems(r.data)).catch(() => {}); }, []);
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tab, centerId, date]);

  const centerName = (id) => centers.find((c) => c.id === id)?.name || "—";

  const TABS = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "items", label: "Item Master", icon: Package },
    { key: "stock", label: "Stock", icon: Boxes },
    { key: "receipts", label: "Goods Receipt", icon: ClipboardList },
    { key: "consumption", label: "Consumption", icon: Soup },
    { key: "closing", label: "Daily Closing", icon: CalendarCheck },
    { key: "stockcount", label: "Stock Count", icon: Scale },
    { key: "ledger", label: "Stock Ledger", icon: BookOpen },
    { key: "report", label: "Monthly Report", icon: FileBarChart2 },
  ];

  return (
    <div className="space-y-5 p-4 md:p-6 w-full" data-testid="mess-page">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[var(--brand)] via-indigo-700 to-blue-700 text-white p-6 md:p-7 shadow-lg">
        <div className="absolute -right-8 -top-8 w-48 h-48 bg-white/10 rounded-full blur-2xl" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="bg-white/15 backdrop-blur p-3 rounded-xl"><UtensilsCrossed size={26} /></div>
            <div>
              <div className="text-[11px] text-white/70 font-medium">Mess & Inventory</div>
              <h1 className="font-heading font-black tracking-tight text-2xl md:text-3xl">Mess Management</h1>
              <p className="text-white/80 text-sm mt-0.5">Inventory, consumption & cost control — weighted-average costing.</p>
            </div>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <div className="text-[9px] uppercase tracking-wide text-white/60 mb-0.5">Center</div>
              <select value={centerId} onChange={(e) => setCenterId(e.target.value)} className="text-sm rounded-lg px-2 py-1.5 text-slate-800 bg-white" data-testid="mess-center-select">
                <option value="">All authorized</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name || c.code || "(unnamed center)"}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wide text-white/60 mb-0.5">Date</div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm rounded-lg px-2 py-1.5 text-slate-800 bg-white" data-testid="mess-date" />
            </div>
            <Button variant="outline" onClick={refresh} className="rounded-lg gap-1.5 bg-white/10 border-white/30 text-white hover:bg-white/20" data-testid="mess-refresh"><RefreshCw size={14} /> Refresh</Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200" style={{ scrollbarWidth: "none" }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`mess-tab-${t.key}`}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${active ? "bg-[var(--brand)] text-white font-semibold shadow-sm" : "text-slate-600 hover:bg-slate-100 font-medium"}`}>
              <t.icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "dashboard" && <DashboardTab dash={dash} stock={stock} loading={loading}
        onReceive={(itemId) => { setReceiptPrefill(typeof itemId === "string" ? itemId : null); setReceiptDlg(true); }} onConsume={() => setConsDlg("consumption")}
        onWaste={() => setConsDlg("wastage")} canEntry={canEntry} centerId={centerId}
        centers={centers} onViewHistory={() => setTab("ledger")} onGoto={setTab} />}

      {tab === "items" && <ItemsTab items={items} canAdmin={canAdmin} units={units}
        onAdd={() => setItemDlg({})} onEdit={(it) => setItemDlg(it)} />}

      {tab === "stock" && <StockTab stock={stock} loading={loading} />}

      {tab === "receipts" && <ReceiptsTab receipts={receipts} loading={loading} canEntry={canEntry}
        canApprove={canApprove} canRegen={["admin", "accountant"].includes(user?.role)} onCreate={() => { setReceiptPrefill(null); setReceiptDlg(true); }} onChanged={refresh} centerName={centerName} />}

      {tab === "consumption" && <ConsumptionTab rows={consumption} loading={loading} canEntry={canEntry}
        onAdd={() => setConsDlg("consumption")} />}

      {tab === "ledger" && <LedgerTab ledger={ledger} loading={loading} centerParam={centerParam} />}

      {tab === "report" && <ReportTab centerId={centerId} centers={centers} />}

      {tab === "closing" && <ClosingTab closing={closing} loading={loading} canApprove={canApprove}
        centerId={centerId} date={date} onChanged={refresh} />}

      {tab === "stockcount" && <StockCountTab counts={stockCounts} stock={stock} loading={loading}
        canApprove={canApprove} centerId={centerId} date={date} onChanged={refresh} />}

      {/* Dialogs */}
      {itemDlg && <ItemDialog item={itemDlg} units={units} onClose={() => setItemDlg(null)}
        onSaved={() => { setItemDlg(null); api.get("/mess/items").then(r => setItems(r.data)); }} />}
      {receiptDlg && <ReceiptDialog items={items} units={units} centers={centers} centerId={centerId} prefillItemId={receiptPrefill}
        onClose={() => { setReceiptDlg(false); setReceiptPrefill(null); }} onSaved={() => { setReceiptDlg(false); setReceiptPrefill(null); setTab("receipts"); refresh(); }} />}
      {consDlg && <ConsumptionDialog mode={consDlg} items={items} units={units} centers={centers} centerId={centerId}
        onClose={() => setConsDlg(null)} onSaved={() => { setConsDlg(null); refresh(); }} />}
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
function KpiCard({ label, value, sub, Icon, tone }) {
  const tones = {
    blue: ["bg-blue-50", "border-blue-100", "text-blue-700", "bg-blue-500"],
    green: ["bg-emerald-50", "border-emerald-100", "text-emerald-700", "bg-emerald-500"],
    orange: ["bg-amber-50", "border-amber-100", "text-amber-700", "bg-amber-500"],
    purple: ["bg-purple-50", "border-purple-100", "text-purple-700", "bg-purple-500"],
    red: ["bg-rose-50", "border-rose-100", "text-rose-700", "bg-rose-500"],
  }[tone] || ["bg-slate-50", "border-slate-100", "text-slate-700", "bg-slate-500"];
  return (
    <div className={`${tones[0]} ${tones[1]} border rounded-xl p-4 flex items-start justify-between`} data-testid={`mess-kpi-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <div>
        <div className={`text-[10px] font-semibold uppercase tracking-wider ${tones[2]}`}>{label}</div>
        <div className="num font-black text-xl text-slate-900 mt-1">{value}</div>
        {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
      </div>
      <div className={`${tones[3]} text-white p-2 rounded-lg shadow-sm`}><Icon size={18} /></div>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
const MESS_STATUS = {
  available: { label: "Available", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  low: { label: "Low Stock", cls: "bg-amber-50 text-amber-800 border-amber-200", Icon: AlertTriangle },
  out: { label: "Out of Stock", cls: "bg-rose-50 text-rose-700 border-rose-200", Icon: XCircle },
};

function StatusBadge({ status }) {
  const s = MESS_STATUS[status] || MESS_STATUS.available;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold rounded-full border px-2 py-0.5 ${s.cls}`} data-testid={`status-${status}`}>
      <s.Icon size={12} /> {s.label}
    </span>
  );
}

function StatCard({ label, value, sub, Icon, accent, tone, testid }) {
  const tones = {
    blue: ["text-blue-600", "bg-blue-50"],
    green: ["text-emerald-600", "bg-emerald-50"],
    amber: ["text-amber-600", "bg-amber-50"],
    rose: ["text-rose-600", "bg-rose-50"],
  }[tone] || ["text-slate-600", "bg-slate-50"];
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-4 flex items-start justify-between border-l-4 ${accent}`} data-testid={testid}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="num font-black text-3xl text-slate-900 mt-1 tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
      </div>
      <div className={`${tones[1]} ${tones[0]} p-2 rounded-lg`}><Icon size={18} /></div>
    </div>
  );
}

function DashboardTab({ dash, stock, loading, onReceive, onConsume, onWaste, canEntry, centerId, centers, onViewHistory, onGoto }) {
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [report, setReport] = useState(null);
  const [loadingRep, setLoadingRep] = useState(false);
  const [histItem, setHistItem] = useState(null);
  const [showCost, setShowCost] = useState(false);
  const [pendingBills, setPendingBills] = useState([]);
  const [loadingBills, setLoadingBills] = useState(false);

  const range = useMemo(() => {
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
  }, [ym]);

  const qs = () => {
    const p = new URLSearchParams();
    if (centerId) p.set("center_id", centerId);
    p.set("date_from", range.from);
    p.set("date_to", range.to);
    return p.toString();
  };

  const loadReport = async () => {
    setLoadingRep(true);
    try { const { data } = await api.get(`/mess/stock-report?${qs()}`); setReport(data); }
    catch (e) { toast.error(formatError(e)); setReport(null); }
    finally { setLoadingRep(false); }
  };
  useEffect(() => { loadReport(); /* eslint-disable-next-line */ }, [centerId, range.from, range.to]);

  useEffect(() => {
    if (!showCost) return;
    setLoadingBills(true);
    const p = new URLSearchParams();
    if (centerId) p.set("center_id", centerId);
    p.set("status", "pending");
    api.get(`/mess/receipts?${p.toString()}`).then((r) => setPendingBills(r.data || []))
      .catch(() => setPendingBills([])).finally(() => setLoadingBills(false));
  }, [showCost, centerId]);

  const downloadPdf = async () => {
    try {
      const resp = await api.get(`/mess/stock-report.pdf?${qs()}`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([resp.data], { type: "application/pdf" }));
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (e) { toast.error(formatError(e)); }
  };

  const summary = report?.summary || { total_items: 0, available: 0, low: 0, out: 0, received_by_unit: {}, issued_by_unit: {} };
  const filtered = useMemo(() => {
    const rows = report?.rows || [];
    return rows.filter((r) =>
      (status === "all" || r.status === status) &&
      (!search || (r.name || "").toLowerCase().includes(search.toLowerCase()) || (r.category || "").toLowerCase().includes(search.toLowerCase()))
    );
  }, [report, status, search]);
  const unitStr = (obj) => {
    const e = Object.entries(obj || {});
    if (!e.length) return "—";
    return e.map(([u, q]) => `${repQty(q)} ${u || ""}`.trim()).join(" · ");
  };
  const d = dash || {};
  const cpp = d.cost_per_person == null ? "N/A" : inr(d.cost_per_person);
  const pill = (val, lbl, testid) => (
    <button onClick={() => setStatus(val)} data-testid={testid}
      className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${status === val ? "bg-[var(--brand)] text-white border-[var(--brand)]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{lbl}</button>
  );

  return (
    <div className="space-y-5" data-testid="mess-dashboard">
      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-2.5">
        {canEntry && <Button onClick={onReceive} className="brand-btn rounded-lg gap-1.5" data-testid="qa-receive"><PackagePlus size={15} /> Receive Stock</Button>}
        {canEntry && <Button onClick={onConsume} className="rounded-lg gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="qa-consume"><ArrowUpRight size={15} /> Issue / Consume</Button>}
        {canEntry && <Button onClick={onWaste} variant="outline" className="rounded-lg gap-1.5 text-rose-700 border-rose-300" data-testid="qa-waste"><TrendingDown size={15} /> Record Wastage</Button>}
        <Button onClick={() => setShowCost((v) => !v)} className={`rounded-lg gap-1.5 ${showCost ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-white text-indigo-700 border border-indigo-300 hover:bg-indigo-50"}`} data-testid="qa-cost-summary"><IndianRupee size={15} /> Today's Cost Summary {showCost ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</Button>
        <Button onClick={onViewHistory} variant="outline" className="rounded-lg gap-1.5" data-testid="qa-history"><History size={15} /> View Stock History</Button>
        <Button onClick={downloadPdf} variant="outline" className="rounded-lg gap-1.5 border-slate-800 text-slate-800" data-testid="qa-pdf"><FileText size={15} /> Generate PDF Report</Button>
      </div>

      {/* Inventory dashboard — hidden while the Today's Cost Summary view is open */}
      {!showCost && (<>
      {/* Inventory status KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={summary.total_items} sub="Distinct · selected period" Icon={Package} tone="blue" accent="border-l-blue-600" testid="mess-stat-total" />
        <StatCard label="Available" value={summary.available} sub="Healthy stock" Icon={CheckCircle2} tone="green" accent="border-l-emerald-500" testid="mess-stat-available" />
        <StatCard label="Low Stock" value={summary.low} sub="At / below reorder" Icon={AlertTriangle} tone="amber" accent="border-l-amber-500" testid="mess-stat-low" />
        <StatCard label="Out of Stock" value={summary.out} sub="Needs purchase" Icon={XCircle} tone="rose" accent="border-l-rose-500" testid="mess-stat-out" />
      </div>

      {/* Received / Issued by unit */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3" data-testid="mess-received-strip">
          <div className="bg-emerald-50 text-emerald-600 p-2.5 rounded-lg"><PackagePlus size={18} /></div>
          <div><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total Received (period)</div>
            <div className="num font-bold text-lg text-slate-900">{unitStr(summary.received_by_unit)}</div></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3" data-testid="mess-issued-strip">
          <div className="bg-blue-50 text-blue-600 p-2.5 rounded-lg"><ArrowUpRight size={18} /></div>
          <div><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total Issued (period)</div>
            <div className="num font-bold text-lg text-slate-900">{unitStr(summary.issued_by_unit)}</div></div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-wide text-slate-400 mb-1">Reporting Period</div>
          <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} className="text-sm rounded-lg px-2 py-1.5 border border-slate-200 text-slate-800" data-testid="mess-dash-month" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <div className="text-[9px] uppercase tracking-wide text-slate-400 mb-1">Search Item</div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item or category…" className="rounded-lg pl-8" data-testid="mess-dash-search" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {pill("all", "All", "filter-all")}
          {pill("available", "Available", "filter-available")}
          {pill("low", "Low Stock", "filter-low")}
          {pill("out", "Out of Stock", "filter-out")}
        </div>
      </div>

      {/* Interactive inventory table */}
      <InventoryTable rows={filtered} loading={loadingRep} canEntry={canEntry}
        onReceive={onReceive} onHistory={(it) => setHistItem(it)} />
      </>)}

      {/* Today's Cost Summary — toggled from the quick-actions bar */}
      {showCost && <CostSummaryPanel dash={dash} cpp={cpp} stock={stock}
        pendingBills={pendingBills} loadingBills={loadingBills} onGoto={onGoto}
        canEntry={canEntry} onReorder={onReceive} />}

      {histItem && <ItemHistoryDrawer item={histItem} centerId={centerId} onClose={() => setHistItem(null)} />}
    </div>
  );
}

/* ---- Today's Cost Summary panel (redesigned, toggled) ---- */
const LS_STATUS = {
  out: { label: "Out of Stock", cls: "bg-rose-100 text-rose-800 border-rose-200" },
  critical: { label: "Critical", cls: "bg-red-100 text-red-700 border-red-200" },
  low: { label: "Low Stock", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  ok: { label: "OK", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

function CostCard({ label, value, sub, Icon, tint }) {
  const T = {
    blue: ["bg-blue-50/70", "bg-blue-500", "text-blue-700"],
    green: ["bg-emerald-50/70", "bg-emerald-500", "text-emerald-700"],
    amber: ["bg-amber-50/80", "bg-amber-500", "text-amber-700"],
    purple: ["bg-violet-50/70", "bg-violet-500", "text-violet-700"],
    rose: ["bg-rose-50/70", "bg-rose-500", "text-rose-700"],
  }[tint] || ["bg-slate-50", "bg-slate-500", "text-slate-700"];
  return (
    <div className={`rounded-2xl border border-slate-100 ${T[0]} p-4 flex items-start justify-between shadow-sm hover:shadow-md transition-shadow`} data-testid={`cost-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="flex items-start gap-3 min-w-0">
        <div className={`${T[1]} text-white p-2.5 rounded-xl shadow-sm shrink-0`}><Icon size={18} /></div>
        <div className="min-w-0">
          <div className={`text-[11px] font-bold uppercase tracking-wider ${T[2]}`}>{label}</div>
          <div className="num font-black text-2xl text-slate-900 mt-0.5 truncate">{value}</div>
          <div className="text-[11px] text-slate-500">{sub}</div>
        </div>
      </div>
      <ChevronRight size={16} className="text-slate-300 mt-1 shrink-0" />
    </div>
  );
}

function StatTile({ Icon, tint, label, value, small }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <div className={`${tint} p-2 rounded-lg shrink-0`}><Icon size={16} /></div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className={`font-bold text-slate-900 ${small ? "text-xs" : "num text-lg"}`}>{value}</div>
      </div>
    </div>
  );
}

function CostSummaryPanel({ dash, cpp, stock, pendingBills, loadingBills, onGoto, canEntry, onReorder }) {
  const d = dash || {};
  const lastUpd = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const lows = stock || [];
  const bills = pendingBills || [];
  return (
    <div className="space-y-4 pt-1" data-testid="mess-cost-summary">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Today&apos;s Cost Summary · {d.date || ""}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <CostCard label="Opening Stock" value={inr(d.opening_value || 0)} sub="Start of day" Icon={Boxes} tint="blue" />
        <CostCard label="Goods Received" value={inr(d.today_received_value || 0)} sub="Today" Icon={PackagePlus} tint="green" />
        <CostCard label="Consumption Cost" value={inr(d.today_consumption_cost || 0)} sub="Today (weighted-avg)" Icon={Soup} tint="amber" />
        <CostCard label="Closing Stock" value={inr(d.closing_value || 0)} sub="Current valuation" Icon={Boxes} tint="purple" />
        <CostCard label="Mess Expenses" value={inr(d.today_mess_expenses || 0)} sub="Purchases today" Icon={IndianRupee} tint="blue" />
        <CostCard label="Meals Served" value={d.meals_served || 0} sub="Today" Icon={Users} tint="green" />
        <CostCard label="Cost / Person" value={cpp} sub="Consumption ÷ meals" Icon={IndianRupee} tint="amber" />
        <CostCard label="Wastage" value={inr(d.today_wastage_cost || 0)} sub="Today" Icon={TrendingDown} tint="rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Low Stock Alerts */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800"><AlertTriangle size={16} className="text-amber-500" /> Low Stock Alerts <span className="num text-xs text-slate-400">({lows.length})</span></div>
            <button onClick={() => onGoto("stock")} className="text-xs font-semibold text-[var(--brand)] hover:underline flex items-center gap-1" data-testid="ls-viewall">View All <ArrowUpRight size={12} /></button>
          </div>
          {lows.length === 0 ? <div className="text-xs text-slate-400 py-10 text-center">No low-stock items 🎉</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase"><tr>
                  <th className="text-left px-4 py-2">Item</th>
                  <th className="text-right px-3 py-2">Current Stock</th>
                  <th className="text-right px-3 py-2">Rate</th>
                  <th className="text-right px-3 py-2">Days Left</th>
                  <th className="text-center px-3 py-2">Status</th>
                  {canEntry && <th className="text-right px-3 py-2">Reorder</th>}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {lows.slice(0, 8).map((s) => {
                    const st = LS_STATUS[s.stock_status] || LS_STATUS.low;
                    return (
                      <tr key={s.item_id} className="hover:bg-slate-50" data-testid={`ls-${s.item_id}`}>
                        <td className="px-4 py-2.5"><div className="flex items-center gap-2.5">
                          <div className="bg-slate-100 text-slate-500 w-8 h-8 rounded-lg flex items-center justify-center shrink-0"><Package size={15} /></div>
                          <div className="min-w-0"><div className="font-semibold text-slate-800 truncate">{s.item_name}</div>{s.category && <div className="text-[11px] text-slate-400">{s.category}</div>}</div>
                        </div></td>
                        <td className="px-3 py-2.5 text-right num font-bold text-rose-600">{repQty(s.qty)} <span className="text-[10px] text-slate-400 font-normal">{s.base_unit}</span></td>
                        <td className="px-3 py-2.5 text-right num text-slate-600">{s.consumption_rate_daily ? `${repQty(s.consumption_rate_daily)}/day` : "—"}</td>
                        <td className="px-3 py-2.5 text-right num text-slate-700">{s.est_days_left == null ? "—" : `${s.est_days_left} day${s.est_days_left === 1 ? "" : "s"}`}</td>
                        <td className="px-3 py-2.5 text-center"><span className={`inline-block text-[11px] font-bold rounded-full border px-2 py-0.5 ${st.cls}`}>{st.label}</span></td>
                        {canEntry && <td className="px-3 py-2.5 text-right"><Button size="sm" variant="outline" className="h-7 rounded-lg gap-1 border-[var(--brand)] text-[var(--brand)]" onClick={() => onReorder(s.item_id)} data-testid={`ls-reorder-${s.item_id}`}><PackagePlus size={13} /> Reorder</Button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pending Purchase Bills */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800"><FileWarning size={16} className="text-blue-500" /> Pending Purchase Bills <span className="num text-xs text-slate-400">({bills.length})</span></div>
            <button onClick={() => onGoto("receipts")} className="text-xs font-semibold text-[var(--brand)] hover:underline flex items-center gap-1" data-testid="pb-viewall">View All <ArrowUpRight size={12} /></button>
          </div>
          {loadingBills ? <div className="text-xs text-slate-400 py-10 text-center">Loading…</div> :
            bills.length === 0 ? <div className="text-xs text-slate-400 py-10 text-center">No pending bills 🎉</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase"><tr>
                    <th className="text-left px-4 py-2">Bill No</th>
                    <th className="text-left px-3 py-2">Vendor</th>
                    <th className="text-left px-3 py-2">Item(s)</th>
                    <th className="text-right px-3 py-2">Amount</th>
                    <th className="text-right px-3 py-2">Action</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {bills.slice(0, 8).map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50" data-testid={`pb-${b.id}`}>
                        <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{b.invoice_no || "—"}</td>
                        <td className="px-3 py-2.5 text-slate-600">{b.supplier_name || "—"}</td>
                        <td className="px-3 py-2.5 text-slate-500 text-xs max-w-[150px] truncate">{(b.lines || []).map((l) => l.item_name).filter(Boolean).join(", ") || "—"}</td>
                        <td className="px-3 py-2.5 text-right num font-bold">{inr(b.total_amount || 0)}</td>
                        <td className="px-3 py-2.5 text-right"><Button size="sm" variant="outline" className="h-7 rounded-lg" onClick={() => onGoto("receipts")} data-testid={`pb-view-${b.id}`}>View</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>

      {/* Bottom stats bar (real metrics only) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-100" data-testid="mess-stats-bar">
        <StatTile Icon={Users} tint="text-emerald-600 bg-emerald-50" label="Meals Served Today" value={d.meals_served || 0} />
        <StatTile Icon={IndianRupee} tint="text-amber-600 bg-amber-50" label="Avg Cost / Person" value={cpp} />
        <StatTile Icon={Soup} tint="text-blue-600 bg-blue-50" label="Food Cost (today)" value={inr(d.today_consumption_cost || 0)} />
        <StatTile Icon={Clock} tint="text-slate-600 bg-slate-100" label="Last Updated" value={lastUpd} small />
      </div>
    </div>
  );
}

/* ---- Interactive inventory table (desktop grid + mobile cards) ---- */
function InventoryTable({ rows, loading, canEntry, onReceive, onHistory }) {
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const perPage = 15;

  useEffect(() => { setPage(1); }, [rows]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string" || typeof bv === "string") { av = (av || "").toString().toLowerCase(); bv = (bv || "").toString().toLowerCase(); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const cur = Math.min(page, pages);
  const start = (cur - 1) * perPage;
  const pageRows = sorted.slice(start, start + perPage);

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const Th = ({ k, children, className = "" }) => (
    <th className={`px-3 py-2.5 ${className}`}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-slate-800" data-testid={`inv-sort-${k}`}>
        {children} <ArrowUpDown size={11} className={sortKey === k ? "text-[var(--brand)]" : "text-slate-300"} />
      </button>
    </th>
  );

  if (loading && rows.length === 0) return <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">Loading inventory…</div>;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm" data-testid="mess-inventory-table">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 font-bold text-sm text-slate-800"><Layers size={16} className="text-[var(--brand)]" /> Inventory</div>
        <div className="text-xs text-slate-400">{sorted.length} item{sorted.length === 1 ? "" : "s"}</div>
      </div>

      {sorted.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-400">No items match the selected filters for this period.</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2.5 text-center w-14">Sr No</th>
                  <Th k="name" className="text-left">Item Name</Th>
                  <Th k="unit" className="text-center">Unit</Th>
                  <Th k="opening" className="text-right">Opening</Th>
                  <Th k="received" className="text-right">Received</Th>
                  <Th k="issued" className="text-right">Issued</Th>
                  <Th k="remaining" className="text-right">Remaining</Th>
                  <Th k="status" className="text-center">Status</Th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((r, i) => (
                  <tr key={r.item_id} className="hover:bg-slate-50" data-testid={`inv-row-${r.item_id}`}>
                    <td className="px-3 py-2.5 text-center num text-slate-400">{start + i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-800">{r.name}</div>
                      {r.category && <div className="text-[11px] text-slate-400">{r.category}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-600">{r.unit}</td>
                    <td className="px-3 py-2.5 text-right num tabular-nums">{repQty(r.opening)}</td>
                    <td className="px-3 py-2.5 text-right num tabular-nums text-emerald-700">{repQty(r.received)}</td>
                    <td className="px-3 py-2.5 text-right num tabular-nums text-rose-600">{repQty(r.issued)}</td>
                    <td className="px-3 py-2.5 text-right num tabular-nums font-bold">{repQty(r.remaining)}</td>
                    <td className="px-3 py-2.5 text-center"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => onHistory(r)} className="rounded-lg h-7 px-2 text-slate-500" data-testid={`inv-history-${r.item_id}`}><History size={13} /></Button>
                      {canEntry && <Button size="sm" variant="outline" onClick={() => onReceive(r.item_id)} className="rounded-lg h-7 px-2 ml-1 gap-1" data-testid={`inv-addentry-${r.item_id}`}><Plus size={12} /> Entry</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile expandable cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {pageRows.map((r, i) => {
              const open = expanded === r.item_id;
              return (
                <div key={r.item_id} data-testid={`inv-card-${r.item_id}`}>
                  <button onClick={() => setExpanded(open ? null : r.item_id)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 truncate">{start + i + 1}. {r.name}</div>
                      <div className="mt-1"><StatusBadge status={r.status} /></div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right"><div className="num font-black text-lg text-slate-900">{repQty(r.remaining)}</div><div className="text-[10px] text-slate-400">{r.unit}</div></div>
                      {open ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                    </div>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-slate-50 rounded-lg py-2"><div className="text-[10px] uppercase text-slate-400">Opening</div><div className="num font-bold text-slate-800">{repQty(r.opening)}</div></div>
                        <div className="bg-emerald-50 rounded-lg py-2"><div className="text-[10px] uppercase text-emerald-600">Received</div><div className="num font-bold text-emerald-700">{repQty(r.received)}</div></div>
                        <div className="bg-rose-50 rounded-lg py-2"><div className="text-[10px] uppercase text-rose-600">Issued</div><div className="num font-bold text-rose-700">{repQty(r.issued)}</div></div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => onHistory(r)} className="flex-1 rounded-lg gap-1.5" data-testid={`inv-mhistory-${r.item_id}`}><History size={13} /> History</Button>
                        {canEntry && <Button size="sm" onClick={() => onReceive(r.item_id)} className="flex-1 brand-btn rounded-lg gap-1.5" data-testid={`inv-maddentry-${r.item_id}`}><Plus size={13} /> Add Stock Entry</Button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
              <span className="text-slate-500">Page {cur} / {pages}</span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="rounded-lg h-8" data-testid="inv-prev">Prev</Button>
                <Button size="sm" variant="outline" disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="rounded-lg h-8" data-testid="inv-next">Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---- Per-item transaction history ---- */
function ItemHistoryDrawer({ item, centerId, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const p = new URLSearchParams();
    if (centerId) p.set("center_id", centerId);
    p.set("item_id", item.item_id);
    p.set("limit", "300");
    api.get(`/mess/ledger?${p.toString()}`).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [item, centerId]);
  const typeLabel = { receipt: "Received", consumption: "Consumed", wastage: "Wastage", adjustment: "Adjustment" };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-xl max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2"><History size={18} className="text-[var(--brand)]" /> {item.name} — Transaction History</DialogTitle>
          <DialogDescription className="sr-only">Stock ledger entries for this item</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto -mx-1">
          {rows === null ? <div className="text-center text-slate-400 py-10 text-sm">Loading…</div> :
            rows.length === 0 ? <div className="text-center text-slate-400 py-10 text-sm">No transactions recorded for this item.</div> : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Type</th>
                    <th className="text-right px-3 py-2">In</th><th className="text-right px-3 py-2">Out</th>
                    <th className="text-right px-3 py-2">Balance</th><th className="text-left px-3 py-2">By</th>
                    <th className="text-left px-3 py-2">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50" data-testid={`hist-${l.id}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{l.date}</td>
                      <td className="px-3 py-2"><span className="text-[11px] font-semibold text-slate-600">{typeLabel[l.type] || l.type}</span></td>
                      <td className="px-3 py-2 text-right num text-emerald-700">{l.qty_in ? repQty(l.qty_in) : "—"}</td>
                      <td className="px-3 py-2 text-right num text-rose-600">{l.qty_out ? repQty(l.qty_out) : "—"}</td>
                      <td className="px-3 py-2 text-right num font-bold">{repQty(l.balance_qty)}</td>
                      <td className="px-3 py-2 text-slate-500">{l.created_by_name || "—"}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{l.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Items ---------------- */
function ItemsTab({ items, canAdmin, onAdd, onEdit }) {
  const [q, setQ] = useState("");
  const filtered = items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) || (i.category || "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item / category…" className="max-w-xs rounded-lg" data-testid="item-search" />
        {canAdmin && <Button onClick={onAdd} className="brand-btn rounded-lg gap-1.5" data-testid="add-item-btn"><Plus size={15} /> Add Item</Button>}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase">
            <tr>
              <th className="text-left px-3 py-2">Item</th><th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Base Unit</th><th className="text-left px-3 py-2">Purchase Unit</th>
              <th className="text-right px-3 py-2">Conv.</th><th className="text-right px-3 py-2">Min</th>
              <th className="text-right px-3 py-2">Reorder</th><th className="text-right px-3 py-2">Avg Cost</th>
              <th className="text-center px-3 py-2">Status</th>{canAdmin && <th></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((it) => (
              <tr key={it.id} className="hover:bg-slate-50" data-testid={`item-row-${it.id}`}>
                <td className="px-3 py-2 font-semibold text-slate-800">{it.name}</td>
                <td className="px-3 py-2 text-slate-600">{it.category}</td>
                <td className="px-3 py-2">{it.base_unit}</td><td className="px-3 py-2">{it.purchase_unit}</td>
                <td className="px-3 py-2 text-right num">{it.conversion_factor}</td>
                <td className="px-3 py-2 text-right num">{it.min_stock}</td>
                <td className="px-3 py-2 text-right num">{it.reorder_level}</td>
                <td className="px-3 py-2 text-right num">{inr(it.avg_cost || 0)}</td>
                <td className="px-3 py-2 text-center">{it.active ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">ACTIVE</span> : <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">INACTIVE</span>}</td>
                {canAdmin && <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => onEdit(it)} className="rounded-lg h-7 gap-1" data-testid={`edit-item-${it.id}`}><Pencil size={12} /></Button></td>}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} className="text-center text-slate-400 py-8">No items</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemDialog({ item, units, onClose, onSaved }) {
  const editing = !!item.id;
  const [f, setF] = useState({
    name: item.name || "", category: item.category || "General",
    base_unit: item.base_unit || "kg", purchase_unit: item.purchase_unit || "kg",
    conversion_factor: item.conversion_factor ?? 1, min_stock: item.min_stock ?? 0,
    reorder_level: item.reorder_level ?? 0, avg_cost: item.avg_cost ?? 0, active: item.active ?? true,
    consumption_unit: item.consumption_unit || item.base_unit || "kg",
    allow_decimal: item.allow_decimal ?? true,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.error("Name required"); return; }
    if (Number(f.conversion_factor) <= 0) { toast.error("Conversion factor must be > 0"); return; }
    setBusy(true);
    try {
      const payload = { ...f, conversion_factor: Number(f.conversion_factor), min_stock: Number(f.min_stock), reorder_level: Number(f.reorder_level), avg_cost: Number(f.avg_cost) };
      if (editing) await api.put(`/mess/items/${item.id}`, payload);
      else await api.post("/mess/items", payload);
      toast.success(editing ? "Item updated" : "Item added");
      onSaved();
    } catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };
  const Field = ({ label, children }) => (<div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">{label}</div>{children}</div>);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-xl max-w-lg">
        <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Item" : "Add Item"}</DialogTitle><DialogDescription className="sr-only">Mess item master form</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="rounded-lg" data-testid="item-name" /></Field></div>
          <Field label="Category"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="rounded-lg" /></Field>
          <Field label="Avg Cost (₹)"><Input type="number" value={f.avg_cost} onChange={(e) => setF({ ...f, avg_cost: e.target.value })} className="rounded-lg" /></Field>
          <Field label="Base Unit"><select value={f.base_unit} onChange={(e) => setF({ ...f, base_unit: e.target.value })} className="w-full border border-slate-200 rounded-lg p-2 text-sm" data-testid="item-base-unit">{units.map(u => <option key={u}>{u}</option>)}</select></Field>
          <Field label="Purchase Unit"><select value={f.purchase_unit} onChange={(e) => setF({ ...f, purchase_unit: e.target.value })} className="w-full border border-slate-200 rounded-lg p-2 text-sm">{units.map(u => <option key={u}>{u}</option>)}</select></Field>
          <Field label="Conversion (1 purchase = ? base)"><Input type="number" value={f.conversion_factor} onChange={(e) => setF({ ...f, conversion_factor: e.target.value })} className="rounded-lg" data-testid="item-conv" /></Field>
          <Field label="Consumption Unit"><select value={f.consumption_unit} onChange={(e) => setF({ ...f, consumption_unit: e.target.value })} className="w-full border border-slate-200 rounded-lg p-2 text-sm" data-testid="item-cons-unit">{units.map(u => <option key={u}>{u}</option>)}</select></Field>
          <Field label="Min Stock"><Input type="number" value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} className="rounded-lg" /></Field>
          <Field label="Reorder Level"><Input type="number" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value })} className="rounded-lg" /></Field>
          <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.allow_decimal} onChange={(e) => setF({ ...f, allow_decimal: e.target.checked })} data-testid="item-allow-decimal" /> Allow decimal qty</label>
          <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
          <div className="col-span-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2 leading-relaxed">
            Rate is always entered <b>per base unit</b> ({f.base_unit}). Any compatible unit can be used when receiving/consuming — the system auto-converts to {f.base_unit}.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg">Cancel</Button>
          <Button onClick={save} disabled={busy} className="brand-btn rounded-lg gap-1" data-testid="save-item"><Check size={14} /> {busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Stock ---------------- */
function StockTab({ stock, loading }) {
  if (loading) return <div className="text-sm text-slate-500 p-8 text-center">Loading…</div>;
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase">
          <tr><th className="text-left px-3 py-2">Item</th><th className="text-left px-3 py-2">Category</th><th className="text-right px-3 py-2">Qty</th><th className="text-right px-3 py-2">Avg Cost</th><th className="text-right px-3 py-2">Value</th><th className="text-center px-3 py-2">Status</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {stock.map((s) => (
            <tr key={s.item_id} className="hover:bg-slate-50" data-testid={`stock-row-${s.item_id}`}>
              <td className="px-3 py-2 font-semibold text-slate-800">{s.item_name}</td>
              <td className="px-3 py-2 text-slate-600">{s.category}</td>
              <td className="px-3 py-2 text-right num font-bold">{s.qty} {s.base_unit}</td>
              <td className="px-3 py-2 text-right num">{inr(s.avg_cost || 0)}</td>
              <td className="px-3 py-2 text-right num font-bold text-emerald-700">{inr(s.value || 0)}</td>
              <td className="px-3 py-2 text-center">{s.is_low ? <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">LOW</span> : <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">OK</span>}</td>
            </tr>
          ))}
          {stock.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">No stock yet — approve a goods receipt first</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Receipts ---------------- */
function ReceiptsTab({ receipts, loading, canEntry, canApprove, canRegen, onCreate, onChanged, centerName }) {
  const [payFor, setPayFor] = useState(null);
  const [regenId, setRegenId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const toggleExpand = (id) => setExpanded((cur) => (cur === id ? null : id));
  const regenBill = async (r) => {
    setRegenId(r.id);
    try {
      const { data } = await api.post(`/mess/receipts/${r.id}/regenerate-bill`);
      toast.success(data.used_template
        ? `Bill ${data.bill_no} regenerated as PDF from your template`
        : `Bill ${data.bill_no} regenerated as PDF (default layout — template PDF unavailable)`);
      onChanged();
    } catch (e) { toast.error(formatError(e)); }
    finally { setRegenId(null); }
  };
  const pendingWithText = (r) => {
    const names = (r.pending_with || []).map((u) => u.name || u.email).filter(Boolean);
    if (names.length === 0) return r.current_step_label || "Pending approval";
    const shown = names.slice(0, 2).join(", ");
    const extra = names.length > 2 ? ` +${names.length - 2}` : "";
    return `${shown}${extra}`;
  };
  const downloadBill = async (r) => {
    try {
      const resp = await api.get(`/mess/receipts/${r.id}/bill`, { responseType: "blob" });
      const blob = resp.data;
      const type = blob.type || "application/pdf";
      const isPdf = type.includes("pdf");
      const url = URL.createObjectURL(blob);
      if (isPdf) {
        window.open(url, "_blank");              // view the PDF inline
      } else {
        const a = document.createElement("a");   // DOCX fallback → download so it opens in Word
        a.href = url; a.download = `${r.bill_no || "mess-bill"}.docx`; a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (e) { toast.error(formatError(e)); }
  };
  const viewAttachment = async (att) => {
    try {
      const resp = await api.get(`/files/view?path=${encodeURIComponent(att.path)}`, { responseType: "blob" });
      window.open(URL.createObjectURL(resp.data), "_blank");
    } catch (e) { toast.error(formatError(e)); }
  };
  if (loading) return <div className="text-sm text-slate-500 p-8 text-center">Loading…</div>;
  return (
    <div className="space-y-3">
      {(canEntry || canApprove) && (
        <div className="flex justify-end gap-2">
          {canApprove && <Button variant="outline" onClick={() => setReviewOpen(true)} className="rounded-lg gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" data-testid="unit-review-btn"><AlertTriangle size={15} /> Unit Review</Button>}
          {canEntry && <Button onClick={onCreate} className="brand-btn rounded-lg gap-1.5" data-testid="create-receipt-btn"><Plus size={15} /> New Goods Receipt</Button>}
        </div>
      )}
      <div className="space-y-2">
        {receipts.map((r) => (
          <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-4" data-testid={`receipt-${r.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-900">Inv {r.invoice_no}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${r.status === "approved" ? "bg-emerald-100 text-emerald-800" : r.status === "rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>{r.status.toUpperCase()}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${r.payment_status === "paid" ? "bg-emerald-100 text-emerald-800" : r.payment_status === "payment_pending" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{(r.payment_status || "unpaid").replace("_", " ").toUpperCase()}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {r.supplier_name || "—"} · {r.center_name || centerName(r.center_id)} · {r.invoice_date} ·{" "}
                  <button onClick={() => toggleExpand(r.id)} className="inline-flex items-center gap-0.5 font-semibold text-blue-700 hover:text-blue-900 hover:underline" data-testid={`receipt-items-toggle-${r.id}`}>
                    {r.lines?.length || 0} item(s)
                    {expanded === r.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
                {r.status === "pending" && (
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 w-fit" data-testid={`pending-with-${r.id}`}>
                    <Clock size={12} /> <span className="font-semibold">Pending with:</span> {pendingWithText(r)}
                    {r.current_step_label && <span className="text-amber-500">· {r.current_step_label}</span>}
                  </div>
                )}
                {(r.attachments || []).length > 0 && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {(r.attachments || []).map((att, i) => (
                      <button key={i} onClick={() => viewAttachment(att)} className="inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-0.5 hover:bg-blue-100" data-testid={`receipt-att-${r.id}-${i}`}>
                        <FileText size={11} /> {att.filename || "Bill"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <span className="num font-black text-lg text-emerald-700">{inr(r.total_amount)}</span>
                {canEntry && r.status === "approved" && (!r.payment_status || r.payment_status === "unpaid") && (
                  <Button size="sm" onClick={() => setPayFor(r)} className="brand-btn rounded-lg h-8 gap-1" data-testid={`raise-payment-${r.id}`}><Wallet size={12} /> Raise Payment</Button>
                )}
                {r.payment_status === "paid" && (
                  <Button size="sm" variant="outline" onClick={() => downloadBill(r)} className="rounded-lg h-8 gap-1 text-emerald-700 border-emerald-300" data-testid={`download-bill-${r.id}`}><Download size={12} /> Bill {r.bill_no ? `· ${r.bill_no}` : ""}</Button>
                )}
                {canRegen && r.payment_status === "paid" && r.bill_no && (
                  <Button size="sm" variant="outline" onClick={() => regenBill(r)} disabled={regenId === r.id} className="rounded-lg h-8 gap-1 text-slate-600 border-slate-300" data-testid={`regen-bill-${r.id}`} title="Regenerate bill as PDF using the current template">
                    <RefreshCw size={12} className={regenId === r.id ? "animate-spin" : ""} /> {regenId === r.id ? "Regenerating…" : "Regenerate"}
                  </Button>
                )}
              </div>
            </div>
            {expanded === r.id && (
              <div className="mt-3 border border-slate-200 rounded-xl overflow-hidden" data-testid={`receipt-items-${r.id}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[520px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-semibold text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-2">Item</th>
                        <th className="text-right px-3 py-2">Qty</th>
                        <th className="text-left px-3 py-2">Unit</th>
                        <th className="text-right px-3 py-2">Rate</th>
                        <th className="text-right px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(r.lines || []).map((l, i) => {
                        const d = displayLine(l);
                        return (
                        <tr key={i} data-testid={`receipt-${r.id}-line-${i}`}>
                          <td className="px-3 py-2 font-medium text-slate-800">{l.item_name || "—"}</td>
                          <td className="px-3 py-2 text-right num">{d.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                          <td className="px-3 py-2 text-slate-500">{d.unit}</td>
                          <td className="px-3 py-2 text-right num">{inr(d.rate)}</td>
                          <td className="px-3 py-2 text-right num font-semibold">{inr(d.amount)}</td>
                        </tr>
                        );
                      })}
                      {(r.lines || []).length === 0 && (
                        <tr><td colSpan={5} className="text-center text-slate-400 py-4">No item details</td></tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-bold text-slate-800 border-t border-slate-200">
                        <td className="px-3 py-2" colSpan={4}>Total</td>
                        <td className="px-3 py-2 text-right num" data-testid={`receipt-${r.id}-total`}>{inr((r.lines || []).reduce((s, l) => s + displayLine(l).amount, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        ))}
        {receipts.length === 0 && <div className="text-center text-slate-400 py-10 bg-white border border-slate-200 rounded-xl">No goods receipts</div>}
      </div>
      {!canApprove && receipts.some((r) => r.status === "pending") && (
        <div className="text-[11px] text-slate-400 text-center">Approvals are actioned from the <span className="font-semibold">Pending Approvals</span> inbox by the configured approvers.</div>
      )}
      {payFor && <RaisePaymentDialog receipt={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); onChanged(); }} />}
      {reviewOpen && <UnitReviewDialog onClose={() => setReviewOpen(false)} />}
    </div>
  );
}

function UnitReviewDialog({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ flagged: [], count: 0 });
  useEffect(() => {
    api.get("/mess/receipts/unit-review")
      .then((r) => setData(r.data || { flagged: [], count: 0 }))
      .catch((e) => toast.error(formatError(e)))
      .finally(() => setLoading(false));
  }, []);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-2xl max-w-4xl w-[96vw] max-h-[90vh] overflow-y-auto" data-testid="unit-review-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2"><AlertTriangle size={18} className="text-amber-600" /> Historical Unit Review</DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Read-only audit. These older receipt lines were entered in a unit different from the item's base unit and their stored amount looks off. Nothing is changed automatically — review and re-enter if needed.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="text-sm text-slate-500 p-8 text-center">Scanning receipts…</div>
        ) : data.count === 0 ? (
          <div className="text-center py-10" data-testid="unit-review-empty">
            <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-2" />
            <div className="text-slate-700 font-semibold">No unit-mismatch issues found</div>
            <div className="text-xs text-slate-500 mt-1">All historical receipts look consistent.</div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]" data-testid="unit-review-table">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-semibold text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Invoice</th>
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-right px-3 py-2">Entered</th>
                  <th className="text-right px-3 py-2">Converted</th>
                  <th className="text-right px-3 py-2">Rate</th>
                  <th className="text-right px-3 py-2">Stored ₹</th>
                  <th className="text-right px-3 py-2">Should be ₹</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.flagged.map((x, i) => (
                  <tr key={i} data-testid={`unit-review-row-${i}`} className="hover:bg-amber-50/40">
                    <td className="px-3 py-2"><div className="font-semibold text-slate-800">{x.invoice_no}</div><div className="text-[10px] text-slate-400">{x.invoice_date} · {x.status}</div></td>
                    <td className="px-3 py-2 text-slate-700">{x.item_name}</td>
                    <td className="px-3 py-2 text-right num">{x.qty} {x.unit}</td>
                    <td className="px-3 py-2 text-right num text-emerald-700">{x.converted_qty} {x.base_unit}</td>
                    <td className="px-3 py-2 text-right num">{inr(x.rate)}/{x.base_unit}</td>
                    <td className="px-3 py-2 text-right num text-rose-600 font-semibold">{inr(x.stored_amount)}</td>
                    <td className="px-3 py-2 text-right num text-emerald-700 font-bold">{inr(x.corrected_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function RaisePaymentDialog({ receipt, onClose, onSaved }) {
  const [f, setF] = useState({
    payment_mode: "bank", payment_date: todayStr(), paid_by_name: "",
    payee_bank_name: "", payee_account_no: "", payee_ifsc: "", payee_upi_id: "", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/mess/receipts/${receipt.id}/raise-payment`, f);
      toast.success("Payment raised — routed to approval workflow");
      onSaved();
    } catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-xl max-w-xl">
        <DialogHeader><DialogTitle className="font-heading">Raise Payment · Inv {receipt.invoice_no}</DialogTitle><DialogDescription className="sr-only">Raise a payment for this approved goods receipt</DialogDescription></DialogHeader>
        <div className="bg-slate-50 rounded-lg p-3 text-sm flex items-center justify-between">
          <span className="text-slate-600">{receipt.supplier_name || "Supplier"}</span>
          <span className="num font-black text-emerald-700">{inr(receipt.total_amount)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Payment Mode</div>
            <select value={f.payment_mode} onChange={(e) => setF({ ...f, payment_mode: e.target.value })} className="w-full border border-slate-200 rounded-lg p-2 text-sm" data-testid="pay-mode">
              <option value="bank">Bank Transfer</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option>
            </select></div>
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Payment Date</div><Input type="date" value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} className="rounded-lg" data-testid="pay-date" /></div>
          <div className="col-span-2"><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Paid By (name)</div><Input value={f.paid_by_name} onChange={(e) => setF({ ...f, paid_by_name: e.target.value })} className="rounded-lg" placeholder="e.g. Accounts Dept" data-testid="pay-by" /></div>
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Bank Name</div><Input value={f.payee_bank_name} onChange={(e) => setF({ ...f, payee_bank_name: e.target.value })} className="rounded-lg" /></div>
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Account No</div><Input value={f.payee_account_no} onChange={(e) => setF({ ...f, payee_account_no: e.target.value })} className="rounded-lg" /></div>
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">IFSC</div><Input value={f.payee_ifsc} onChange={(e) => setF({ ...f, payee_ifsc: e.target.value })} className="rounded-lg" /></div>
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">UPI ID</div><Input value={f.payee_upi_id} onChange={(e) => setF({ ...f, payee_upi_id: e.target.value })} className="rounded-lg" /></div>
          <div className="col-span-2"><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Notes</div><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="rounded-lg" /></div>
        </div>
        <div className="text-[11px] text-slate-500 mt-1">Payment routes through the Mess Payment approval chain. On final approval, the bill PDF is auto-generated.</div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg">Cancel</Button>
          <Button onClick={save} disabled={busy} className="brand-btn rounded-lg gap-1" data-testid="save-payment"><Check size={14} /> {busy ? "Submitting…" : "Submit for Approval"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineEditor({ items, units, lines, setLines, mode }) {
  const addLine = () => setLines([...lines, mode === "receipt"
    ? { item_id: "", qty: "", unit: "", unit_price: "", discount: 0, tax: 0, gst_rate: "", hsn_sac: "", accepted_qty: "", rejected_qty: 0 }
    : { item_id: "", qty: "", unit: "", kind: mode }]);
  const upd = (i, k, v) => { const n = [...lines]; n[i] = { ...n[i], [k]: v }; if (k === "item_id") { const it = items.find(x => x.id === v); if (it) n[i].unit = it.consumption_unit || it.base_unit; } setLines(n); };
  const rm = (i) => setLines(lines.filter((_, idx) => idx !== i));
  const unitsFor = (id) => { const it = items.find(x => x.id === id); return it ? compatibleUnits(it) : units; };
  return (
    <div className="space-y-2">
      {lines.map((ln, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end bg-slate-50 p-2 rounded-lg" data-testid={`line-${i}`}>
          <div className="col-span-4"><div className="text-[9px] uppercase text-slate-500">Item</div>
            <select value={ln.item_id} onChange={(e) => upd(i, "item_id", e.target.value)} className="w-full border border-slate-200 rounded-lg p-1.5 text-xs" data-testid={`line-item-${i}`}>
              <option value="">Select…</option>{items.filter(it => it.active !== false).map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
          </div>
          <div className="col-span-2"><div className="text-[9px] uppercase text-slate-500">Qty</div><Input type="number" value={ln.qty} onChange={(e) => upd(i, "qty", e.target.value)} className="rounded-lg h-8 text-xs" data-testid={`line-qty-${i}`} /></div>
          <div className="col-span-2"><div className="text-[9px] uppercase text-slate-500">Unit</div>
            <select value={ln.unit} onChange={(e) => upd(i, "unit", e.target.value)} className="w-full border border-slate-200 rounded-lg p-1.5 text-xs" data-testid={`line-unit-${i}`}>{unitsFor(ln.item_id).map(u => <option key={u}>{u}</option>)}</select>
          </div>
          {mode === "receipt" ? (
            <>
              <div className="col-span-1"><div className="text-[9px] uppercase text-slate-500">Rate</div><Input type="number" value={ln.unit_price} onChange={(e) => upd(i, "unit_price", e.target.value)} className="rounded-lg h-8 text-xs" data-testid={`line-rate-${i}`} /></div>
              <div className="col-span-2"><div className="text-[9px] uppercase text-slate-500">Accepted Qty</div><Input type="number" value={ln.accepted_qty} onChange={(e) => upd(i, "accepted_qty", e.target.value)} className="rounded-lg h-8 text-xs" data-testid={`line-acc-${i}`} /></div>
            </>
          ) : <div className="col-span-3" />}
          <div className="col-span-1 flex justify-end"><Button size="sm" variant="outline" onClick={() => rm(i)} className="rounded-lg h-8 w-8 p-0 text-rose-600" data-testid={`line-rm-${i}`}><Trash2 size={13} /></Button></div>
          {mode === "receipt" && (
            <div className="col-span-12 grid grid-cols-12 gap-2 mt-1">
              <div className="col-span-3"><div className="text-[9px] uppercase text-slate-500">HSN/SAC <span className="text-slate-300">(opt)</span></div><Input value={ln.hsn_sac || ""} onChange={(e) => upd(i, "hsn_sac", e.target.value)} className="rounded-lg h-8 text-xs" placeholder="e.g. 91069000" data-testid={`line-hsn-${i}`} /></div>
              <div className="col-span-2"><div className="text-[9px] uppercase text-slate-500">GST % <span className="text-slate-300">(opt)</span></div><Input type="number" value={ln.gst_rate ?? ""} onChange={(e) => upd(i, "gst_rate", e.target.value)} className="rounded-lg h-8 text-xs" placeholder="18" data-testid={`line-gst-${i}`} /></div>
              <div className="col-span-2"><div className="text-[9px] uppercase text-slate-500">Discount</div><Input type="number" value={ln.discount} onChange={(e) => upd(i, "discount", e.target.value)} className="rounded-lg h-8 text-xs" data-testid={`line-disc-${i}`} /></div>
              <div className="col-span-2"><div className="text-[9px] uppercase text-slate-500">Tax Amt <span className="text-slate-300">(if no %)</span></div><Input type="number" value={ln.tax} onChange={(e) => upd(i, "tax", e.target.value)} className="rounded-lg h-8 text-xs" data-testid={`line-tax-${i}`} /></div>
            </div>
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={addLine} className="rounded-lg gap-1" data-testid="add-line"><Plus size={13} /> Add Line</Button>
    </div>
  );
}

const GST_RATE_OPTIONS = ["0", "5", "12", "18", "28"];
const num = (v) => Number(v) || 0;
const newReceiptLine = () => ({ item_id: "", qty: "", unit: "", unit_price: "", discount: 0, tax: 0, gst_rate: "0", hsn_sac: "", accepted_qty: "", rejected_qty: 0 });

function ReceiptDialog({ items, units, centers, centerId, prefillItemId, onClose, onSaved }) {
  const [f, setF] = useState({ center_id: centerId || "", supplier_id: "", supplier_name: "", invoice_no: "", invoice_date: todayStr(), po_no: "", attachments: [] });
  const [lines, setLines] = useState(() => {
    if (prefillItemId) {
      const it = items.find((x) => x.id === prefillItemId);
      return [{ ...newReceiptLine(), item_id: prefillItemId, unit: it?.base_unit || "" }];
    }
    return [newReceiptLine()];
  });
  const [vendors, setVendors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { api.get("/vendors").then((r) => setVendors(Array.isArray(r.data) ? r.data : [])).catch(() => setVendors([])); }, []);

  const pickVendor = (id) => {
    const v = vendors.find((x) => x.id === id);
    setF((p) => ({ ...p, supplier_id: id, supplier_name: v ? v.name : "" }));
  };

  const itemOf = (id) => items.find((x) => x.id === id);
  const unitsFor = (id) => { const it = itemOf(id); return it ? compatibleUnits(it) : units; };
  const qtyBase = (ln) => { const it = itemOf(ln.item_id); const b = it ? toBaseQty(it, num(ln.qty), ln.unit) : null; return b == null ? num(ln.qty) : b; };
  const baseUnitOf = (ln) => { const it = itemOf(ln.item_id); return it?.base_unit || ln.unit || ""; };
  const addLine = () => setLines([...lines, newReceiptLine()]);
  const rmLine = (i) => setLines(lines.filter((_, idx) => idx !== i));
  const upd = (i, k, v) => {
    const n = [...lines];
    n[i] = { ...n[i], [k]: v };
    if (k === "item_id") { const it = itemOf(v); if (it) n[i].unit = it.base_unit; }
    setLines(n);
  };

  // Rate (unit_price) is ALWAYS per the item's BASE unit; qty is normalised to
  // base via the central engine before costing (500 gram @ ₹400/kg -> ₹200).
  const lineTaxable = (ln) => Math.max(qtyBase(ln) * num(ln.unit_price) - num(ln.discount), 0);
  const lineGst = (ln) => lineTaxable(ln) * num(ln.gst_rate) / 100;
  const lineTotal = (ln) => lineTaxable(ln) + lineGst(ln);
  const subtotal = lines.reduce((s, l) => s + qtyBase(l) * num(l.unit_price), 0);
  const totalDiscount = lines.reduce((s, l) => s + num(l.discount), 0);
  const totalGst = lines.reduce((s, l) => s + lineGst(l), 0);
  const grandTotal = subtotal - totalDiscount + totalGst;
  const rateSet = [...new Set(lines.filter((l) => num(l.qty) > 0).map((l) => num(l.gst_rate)))];
  const gstLabel = rateSet.length === 1 ? ` (${rateSet[0]}%)` : "";

  const uploadBill = async (file) => {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      setF((p) => ({ ...p, attachments: [...(p.attachments || []), data] }));
      toast.success("Bill attached");
    } catch (e) { toast.error(formatError(e)); } finally { setUploading(false); }
  };
  const rmAtt = (i) => setF((p) => ({ ...p, attachments: p.attachments.filter((_, idx) => idx !== i) }));

  const save = async () => {
    if (!f.center_id) { toast.error("Select a center"); return; }
    if (!f.invoice_no.trim()) { toast.error("Invoice number required"); return; }
    if (!f.supplier_id) { toast.error("Select a supplier from the vendor list"); return; }
    const clean = lines.filter((l) => l.item_id && Number(l.qty) > 0).map((l) => ({
      item_id: l.item_id, qty: Number(l.qty), unit: l.unit, unit_price: Number(l.unit_price || 0),
      discount: Number(l.discount || 0), tax: 0,
      gst_rate: l.gst_rate === "" || l.gst_rate == null ? null : Number(l.gst_rate),
      hsn_sac: (l.hsn_sac || "").trim() || null,
      accepted_qty: Number(l.accepted_qty || l.qty), rejected_qty: Number(l.rejected_qty || 0),
    }));
    if (clean.length === 0) { toast.error("Add at least one valid line"); return; }
    for (const l of clean) {
      const it = itemOf(l.item_id);
      if (it && !isCompatible(it, l.unit)) {
        toast.error(`Unit '${l.unit}' is not compatible with ${it.name} (base: ${it.base_unit})`);
        return;
      }
    }
    if (!(f.attachments || []).length) { toast.error("Bill attach karna zaroori hai (PDF/Image)"); return; }
    setBusy(true);
    try { await api.post("/mess/receipts", { ...f, lines: clean }); toast.success("Goods receipt created — routed to approval workflow"); onSaved(); }
    catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };

  const inputCls = "w-full border border-slate-200 rounded-lg px-2.5 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400";
  const Label = ({ children }) => <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide mb-1.5">{children}</div>;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-2xl max-w-6xl w-[96vw] max-h-[92vh] overflow-y-auto p-0 gap-0" data-testid="receipt-dialog">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 text-blue-600 p-2.5 rounded-xl"><Package size={22} /></div>
            <div>
              <DialogTitle className="font-heading text-xl text-slate-900">New Goods Receipt</DialogTitle>
              <DialogDescription className="text-sm text-slate-500">Record received goods against a purchase order</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Top fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><Label>Center</Label>
              <select value={f.center_id} onChange={(e) => setF({ ...f, center_id: e.target.value })} className={inputCls} data-testid="receipt-center"><option value="">Select Center</option>{centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><Label>Invoice No</Label><Input value={f.invoice_no} onChange={(e) => setF({ ...f, invoice_no: e.target.value })} placeholder="Enter invoice no." className="rounded-lg h-9" data-testid="receipt-invoice" /></div>
            <div><Label>Invoice Date</Label><Input type="date" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} className="rounded-lg h-9" data-testid="receipt-date" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Supplier</Label>
              <select value={f.supplier_id} onChange={(e) => pickVendor(e.target.value)} className={inputCls} data-testid="receipt-supplier">
                <option value="">Select Supplier</option>
                {vendors.filter((v) => v.active !== false).map((v) => <option key={v.id} value={v.id}>{v.name}{v.gst_number ? ` · ${v.gst_number}` : ""}</option>)}
              </select>
              {vendors.length === 0 && <div className="text-[11px] text-amber-600 mt-1">No vendors found — add suppliers in Procurement → Vendors.</div>}
            </div>
            <div><Label>PO No. <span className="text-slate-400 normal-case">(optional)</span></Label><Input value={f.po_no} onChange={(e) => setF({ ...f, po_no: e.target.value })} placeholder="Enter PO number" className="rounded-lg h-9" data-testid="receipt-po" /></div>
          </div>

          {/* Items table */}
          <div>
            <Label>Items</Label>
            <div className="rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide">
                    <th className="px-3 py-2.5 text-center w-10">S.No.</th>
                    <th className="px-3 py-2.5 text-left min-w-[260px]">Item</th>
                    <th className="px-2 py-2.5 text-left w-36">Qty</th>
                    <th className="px-2 py-2.5 text-left w-20">Unit</th>
                    <th className="px-2 py-2.5 text-left w-28">Rate <span className="normal-case text-slate-400">(per base unit)</span></th>
                    <th className="px-2 py-2.5 text-left w-20">GST %</th>
                    <th className="px-2 py-2.5 text-left w-24">Accepted Qty</th>
                    <th className="px-3 py-2.5 text-right w-28">Line Total</th>
                    <th className="px-2 py-2.5 text-center w-12">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0 align-top" data-testid={`line-${i}`}>
                      <td className="px-3 py-3 text-center text-slate-500 font-semibold">{i + 1}</td>
                      <td className="px-3 py-3">
                        <select value={ln.item_id} onChange={(e) => upd(i, "item_id", e.target.value)} className={inputCls} data-testid={`line-item-${i}`}>
                          <option value="">Select…</option>{items.filter((it) => it.active !== false).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-3">
                        <Input type="number" value={ln.qty} onChange={(e) => upd(i, "qty", e.target.value)} className="rounded-lg h-9 text-sm" data-testid={`line-qty-${i}`} />
                        {ln.item_id && num(ln.qty) > 0 && ln.unit !== baseUnitOf(ln) && (
                          <div className="text-[10px] text-emerald-600 font-semibold mt-1 whitespace-nowrap" data-testid={`line-conv-${i}`}>= {qtyBase(ln).toLocaleString(undefined, { maximumFractionDigits: 4 })} {baseUnitOf(ln)}</div>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <select value={ln.unit} onChange={(e) => upd(i, "unit", e.target.value)} className={inputCls} data-testid={`line-unit-${i}`}>{unitsFor(ln.item_id).map((u) => <option key={u}>{u}</option>)}</select>
                      </td>
                      <td className="px-2 py-3">
                        <Input type="number" value={ln.unit_price} onChange={(e) => upd(i, "unit_price", e.target.value)} className="rounded-lg h-9 text-sm" data-testid={`line-rate-${i}`} />
                        {ln.item_id && <div className="text-[10px] text-slate-400 mt-1 whitespace-nowrap">per {baseUnitOf(ln)}</div>}
                      </td>
                      <td className="px-2 py-3">
                        <select value={String(ln.gst_rate ?? "")} onChange={(e) => upd(i, "gst_rate", e.target.value)} className={inputCls} data-testid={`line-gst-${i}`}>
                          {[...new Set([...GST_RATE_OPTIONS, String(ln.gst_rate ?? "")])].filter((x) => x !== "").map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-3"><Input type="number" value={ln.accepted_qty} onChange={(e) => upd(i, "accepted_qty", e.target.value)} className="rounded-lg h-9 text-sm" data-testid={`line-acc-${i}`} /></td>
                      <td className="px-3 py-3 text-right font-bold text-slate-900 num whitespace-nowrap" data-testid={`line-total-${i}`}>{inr(lineTotal(ln))}</td>
                      <td className="px-2 py-3 text-center"><Button size="sm" variant="outline" onClick={() => rmLine(i)} className="rounded-lg h-8 w-8 p-0 text-rose-600 border-rose-200 hover:bg-rose-50" data-testid={`line-rm-${i}`}><Trash2 size={14} /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button size="sm" variant="outline" onClick={addLine} className="rounded-lg gap-1.5 mt-3 text-blue-600 border-blue-200 hover:bg-blue-50 font-semibold" data-testid="add-line"><Plus size={15} /> Add Line</Button>
          </div>

          {/* Amount summary */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide mb-3">Amount Summary</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 items-stretch">
              <div data-testid="receipt-subtotal"><div className="text-xs text-slate-500">Subtotal</div><div className="text-xl font-bold text-slate-900 num mt-0.5">{inr(subtotal)}</div></div>
              <div data-testid="receipt-gst"><div className="text-xs text-slate-500">Total GST{gstLabel}</div><div className="text-xl font-bold text-slate-900 num mt-0.5">{inr(totalGst)}</div></div>
              <div className="rounded-lg bg-blue-600 text-white p-3.5 shadow-sm" data-testid="receipt-grand-total">
                <div className="text-[10px] uppercase font-semibold text-blue-100 tracking-wide flex items-center justify-between">Grand Total <RefreshCw size={12} className="opacity-80" /></div>
                <div className="text-2xl font-black num mt-0.5 leading-tight">{inr(grandTotal)}</div>
                <div className="text-[10px] text-blue-100">(Updates automatically)</div>
              </div>
            </div>
          </div>

          {/* Shop bill upload */}
          <div>
            <Label>Shop Bill <span className="text-rose-500 normal-case font-semibold">(required)</span></Label>
            <label className={`flex items-center gap-3 cursor-pointer border border-dashed rounded-xl px-4 py-3 hover:bg-slate-50 transition-colors ${(f.attachments || []).length ? "border-slate-300" : "border-rose-300 bg-rose-50/40"}`} data-testid="receipt-bill-upload">
              <Upload size={20} className={(f.attachments || []).length ? "text-slate-400" : "text-rose-400"} />
              <div>
                <div className="text-sm font-semibold text-slate-700">{uploading ? "Uploading…" : "Attach bill (PDF/Image)"}</div>
                <div className="text-[11px] text-slate-400">Supported formats: PDF, JPG, PNG · Max size: 5MB · <span className="text-rose-500 font-semibold">mandatory</span></div>
              </div>
              <input type="file" className="hidden" accept=".pdf,image/*" disabled={uploading} onChange={(e) => uploadBill(e.target.files?.[0])} />
            </label>
            {(f.attachments || []).length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {(f.attachments || []).map((att, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-blue-50 border border-blue-200 text-blue-700 rounded-md px-2 py-1" data-testid={`receipt-att-chip-${i}`}>
                    <FileText size={11} /> {att.filename}
                    <button onClick={() => rmAtt(i)} className="ml-1 text-rose-500 hover:text-rose-700"><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <Button variant="outline" onClick={onClose} className="rounded-lg">Cancel</Button>
          <Button onClick={save} disabled={busy} className="brand-btn rounded-lg gap-1.5" data-testid="save-receipt"><Check size={16} /> {busy ? "Saving…" : "Create Receipt"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Consumption ---------------- */
function ConsumptionTab({ rows, loading, canEntry, onAdd }) {
  if (loading) return <div className="text-sm text-slate-500 p-8 text-center">Loading…</div>;
  return (
    <div className="space-y-3">
      {canEntry && <div className="flex justify-end"><Button onClick={onAdd} className="brand-btn rounded-lg gap-1.5" data-testid="add-consumption-btn"><Plus size={15} /> Record Consumption</Button></div>}
      <div className="space-y-2">
        {rows.map((c) => (
          <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4" data-testid={`consumption-${c.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-bold text-slate-900">{c.date} · {c.center_name || "—"}</div>
                <div className="text-xs text-slate-500 mt-0.5">{(c.meal_types || []).join(", ") || "—"} · {c.meals_served} meals · {c.lines?.length || 0} item(s)</div>
              </div>
              <div className="text-right">
                <div className="num font-black text-emerald-700">{inr(c.consumption_cost || 0)}</div>
                {c.wastage_cost > 0 && <div className="num text-xs text-rose-600">Wastage {inr(c.wastage_cost)}</div>}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-center text-slate-400 py-10 bg-white border border-slate-200 rounded-xl">No consumption records for this date</div>}
      </div>
    </div>
  );
}

function ConsumptionDialog({ mode, items, units, centers, centerId, onClose, onSaved }) {
  const [f, setF] = useState({ center_id: centerId || "", date: todayStr(), meals_served: 0, meal_types: [] });
  const [lines, setLines] = useState([{ item_id: "", qty: "", unit: "", kind: mode }]);
  const [busy, setBusy] = useState(false);
  const toggleMeal = (m) => setF((x) => ({ ...x, meal_types: x.meal_types.includes(m) ? x.meal_types.filter(z => z !== m) : [...x.meal_types, m] }));
  const save = async () => {
    if (!f.center_id) { toast.error("Select a center"); return; }
    const clean = lines.filter(l => l.item_id && Number(l.qty) > 0).map(l => ({ item_id: l.item_id, qty: Number(l.qty), unit: l.unit, kind: mode }));
    if (clean.length === 0) { toast.error("Add at least one valid line"); return; }
    setBusy(true);
    try { await api.post("/mess/consumption", { ...f, meals_served: Number(f.meals_served || 0), lines: clean }); toast.success(mode === "wastage" ? "Wastage recorded" : "Consumption recorded"); onSaved(); }
    catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-xl max-w-2xl">
        <DialogHeader><DialogTitle className="font-heading">{mode === "wastage" ? "Record Wastage" : "Record Consumption"}</DialogTitle><DialogDescription className="sr-only">Record daily consumption or wastage</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2"><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Center</div>
            <select value={f.center_id} onChange={(e) => setF({ ...f, center_id: e.target.value })} className="w-full border border-slate-200 rounded-lg p-2 text-sm" data-testid="cons-center"><option value="">Select…</option>{centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Date</div><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="rounded-lg" /></div>
          {mode !== "wastage" && <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Meals Served</div><Input type="number" value={f.meals_served} onChange={(e) => setF({ ...f, meals_served: e.target.value })} className="rounded-lg" data-testid="cons-meals" /></div>}
        </div>
        {mode !== "wastage" && (
          <div className="flex gap-2 flex-wrap">{["breakfast", "lunch", "snacks", "dinner"].map(m => (
            <button key={m} onClick={() => toggleMeal(m)} className={`text-xs rounded-lg px-2.5 py-1 border ${f.meal_types.includes(m) ? "bg-[var(--brand)] text-white border-[var(--brand)]" : "border-slate-200 text-slate-600"}`}>{m}</button>))}</div>
        )}
        <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Items {mode === "wastage" ? "(wastage)" : "(consumed)"}</div>
          <LineEditor items={items} units={units} lines={lines} setLines={setLines} mode={mode} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg">Cancel</Button>
          <Button onClick={save} disabled={busy} className="brand-btn rounded-lg gap-1" data-testid="save-consumption"><Check size={14} /> {busy ? "Saving…" : "Post"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Daily Closing ---------------- */
function ClosingTab({ closing, loading, canApprove, centerId, date, onChanged }) {
  const [busy, setBusy] = useState(false);
  if (!centerId) return <div className="text-center text-slate-400 py-10 bg-white border border-slate-200 rounded-xl">Select a specific center (top-right) to view / run Daily Closing.</div>;
  if (loading || !closing) return <div className="text-sm text-slate-500 p-8 text-center">Loading…</div>;
  const f = closing.figures || {};
  const c = closing.closing;
  const isClosed = c && c.status === "closed";
  const close = async () => {
    if (!window.confirm(`Close mess for ${date}? The day will be locked from editing.`)) return;
    setBusy(true);
    try { await api.post("/mess/closing", { center_id: centerId, date }); toast.success("Day closed & locked"); onChanged(); }
    catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };
  const reopen = async () => {
    const remarks = window.prompt("Reason to reopen this closed day? (required)");
    if (!remarks || !remarks.trim()) { toast.error("Reason required"); return; }
    setBusy(true);
    try { await api.post("/mess/closing/reopen", { center_id: centerId, date, remarks }); toast.success("Day reopened"); onChanged(); }
    catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };
  const Row = ({ label, value, strong }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-50 text-sm"><span className="text-slate-600">{label}</span><span className={`num ${strong ? "font-black text-slate-900" : "font-semibold text-slate-800"}`}>{value}</span></div>
  );
  return (
    <div className="space-y-4 max-w-2xl">
      <div className={`rounded-xl p-4 border flex items-center justify-between ${isClosed ? "bg-rose-50 border-rose-200" : "bg-emerald-50 border-emerald-200"}`} data-testid="closing-status">
        <div className="flex items-center gap-2 font-bold text-sm">{isClosed ? <Lock size={16} className="text-rose-600" /> : <Unlock size={16} className="text-emerald-600" />} {isClosed ? `CLOSED — locked by ${c.closed_by_name || "user"}` : "OPEN — not yet closed"}</div>
        {canApprove && (isClosed
          ? <Button onClick={reopen} disabled={busy} variant="outline" className="rounded-lg gap-1 text-amber-700 border-amber-300" data-testid="reopen-day-btn"><Unlock size={14} /> Reopen</Button>
          : <Button onClick={close} disabled={busy} className="brand-btn rounded-lg gap-1" data-testid="close-day-btn"><CalendarCheck size={14} /> {busy ? "Closing…" : "Close Day"}</Button>)}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="font-bold text-sm mb-2">Daily Mess Summary · {date}</div>
        <Row label="Opening Stock Value" value={inr(f.opening_value || 0)} />
        <Row label="Goods Received" value={inr(f.received_value || 0)} />
        <Row label="Consumption Cost" value={inr(f.consumption_cost || 0)} />
        <Row label="Wastage Cost" value={inr(f.wastage_cost || 0)} />
        <Row label="Closing Stock Value" value={inr(f.closing_value || 0)} />
        <Row label="Mess Expenses (purchases)" value={inr(f.mess_expenses || 0)} />
        <Row label="Meals Served" value={f.meals_served || 0} />
        <Row label="Total Daily Mess Cost" value={inr(f.total_daily_mess_cost || 0)} strong />
        <Row label="Cost / Person" value={f.cost_per_person == null ? "N/A" : inr(f.cost_per_person)} strong />
      </div>
    </div>
  );
}

/* ---------------- Physical Stock Count ---------------- */
function StockCountTab({ counts, stock, loading, canApprove, centerId, date, onChanged }) {
  const [counted, setCounted] = useState({});
  const [busy, setBusy] = useState(false);
  if (!centerId) return <div className="text-center text-slate-400 py-10 bg-white border border-slate-200 rounded-xl">Select a specific center (top-right) to run a physical stock count.</div>;
  if (loading) return <div className="text-sm text-slate-500 p-8 text-center">Loading…</div>;
  const submit = async () => {
    const lines = stock.filter(s => counted[s.item_id] !== undefined && counted[s.item_id] !== "").map(s => ({ item_id: s.item_id, counted_qty: Number(counted[s.item_id]), reason: "Physical count" }));
    if (lines.length === 0) { toast.error("Enter at least one counted quantity"); return; }
    setBusy(true);
    try { await api.post("/mess/stock-counts", { center_id: centerId, date, lines }); toast.success("Stock count posted — adjustments recorded"); setCounted({}); onChanged(); }
    catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      {canApprove && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2"><div className="font-bold text-sm">New Physical Count · {date}</div><Button onClick={submit} disabled={busy} className="brand-btn rounded-lg gap-1" data-testid="post-count-btn"><Check size={14} /> {busy ? "Posting…" : "Post Count & Adjust"}</Button></div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500 text-[11px] uppercase sticky top-0"><tr><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">System Qty</th><th className="text-right px-3 py-2">Counted Qty</th><th className="text-right px-3 py-2">Diff</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {stock.map(s => {
                  const cv = counted[s.item_id];
                  const diff = cv === undefined || cv === "" ? null : Number(cv) - s.qty;
                  return (
                    <tr key={s.item_id} data-testid={`count-row-${s.item_id}`}>
                      <td className="px-3 py-1.5 font-medium text-slate-800">{s.item_name}</td>
                      <td className="px-3 py-1.5 text-right num">{s.qty} {s.base_unit}</td>
                      <td className="px-3 py-1.5 text-right"><Input type="number" value={cv ?? ""} onChange={e => setCounted({ ...counted, [s.item_id]: e.target.value })} className="rounded-lg h-7 w-28 text-right text-xs inline-block" data-testid={`count-input-${s.item_id}`} /></td>
                      <td className={`px-3 py-1.5 text-right num font-bold ${diff == null ? "" : diff < 0 ? "text-rose-600" : diff > 0 ? "text-emerald-600" : "text-slate-400"}`}>{diff == null ? "—" : diff}</td>
                    </tr>
                  );
                })}
                {stock.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-6">No stock to count</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div>
        <div className="font-bold text-sm mb-2">Past Counts</div>
        <div className="space-y-2">
          {counts.map(c => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between" data-testid={`count-${c.id}`}>
              <div className="text-sm"><b>{c.date}</b> · {c.center_name || "—"} · {c.lines?.length || 0} item(s) · by {c.created_by_name}</div>
              <div className={`num font-bold ${c.total_diff_value < 0 ? "text-rose-600" : "text-emerald-700"}`}>{inr(c.total_diff_value || 0)}</div>
            </div>
          ))}
          {counts.length === 0 && <div className="text-center text-slate-400 py-6 bg-white border border-slate-200 rounded-xl">No stock counts yet</div>}
        </div>
      </div>
    </div>
  );
}

function LedgerTab({ ledger, loading, centerParam }) {
  const download = async () => {
    try {
      const resp = await api.get(`/mess/ledger/export.xlsx${centerParam}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement("a"); a.href = url; a.download = "mess_stock_ledger.xlsx"; a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };
  if (loading) return <div className="text-sm text-slate-500 p-8 text-center">Loading…</div>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={download} variant="outline" className="rounded-lg gap-1.5" data-testid="export-ledger"><Download size={14} /> Export Excel</Button></div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase">
            <tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Item</th><th className="text-left px-3 py-2">Type</th><th className="text-right px-3 py-2">In</th><th className="text-right px-3 py-2">Out</th><th className="text-right px-3 py-2">Unit Cost</th><th className="text-right px-3 py-2">Value</th><th className="text-right px-3 py-2">Bal Qty</th><th className="text-right px-3 py-2">Bal Value</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ledger.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50" data-testid={`ledger-${l.id}`}>
                <td className="px-3 py-2">{l.date}</td>
                <td className="px-3 py-2 font-medium text-slate-800">{l.item_name}</td>
                <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${l.type === "receipt" ? "bg-emerald-50 text-emerald-700" : l.type === "wastage" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{l.type}</span></td>
                <td className="px-3 py-2 text-right num text-emerald-700">{l.qty_in || ""}</td>
                <td className="px-3 py-2 text-right num text-rose-600">{l.qty_out || ""}</td>
                <td className="px-3 py-2 text-right num">{inr(l.unit_cost || 0)}</td>
                <td className="px-3 py-2 text-right num">{inr(l.value_delta || 0)}</td>
                <td className="px-3 py-2 text-right num font-bold">{l.balance_qty}</td>
                <td className="px-3 py-2 text-right num font-bold">{inr(l.balance_value || 0)}</td>
              </tr>
            ))}
            {ledger.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-8">No ledger entries</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* ---------------- Monthly / Date-wise Stock Report ---------------- */
const repQty = (v) => {
  const n = Math.round((Number(v) || 0) * 1000) / 1000;
  return String(n);
};

function ReportTab({ centerId, centers }) {
  const [mode, setMode] = useState("month");           // "month" | "range"
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [from, setFrom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => {
    if (mode === "month") {
      const [y, m] = ym.split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
    }
    return { date_from: from, date_to: to };
  }, [mode, ym, from, to]);

  const qs = () => {
    const p = new URLSearchParams();
    if (centerId) p.set("center_id", centerId);
    p.set("date_from", range.date_from);
    p.set("date_to", range.date_to);
    return p.toString();
  };

  const load = async () => {
    if (!range.date_from || !range.date_to) return;
    setLoading(true);
    try {
      const { data: d } = await api.get(`/mess/stock-report?${qs()}`);
      setData(d);
    } catch (e) { toast.error(formatError(e)); setData(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [centerId, range.date_from, range.date_to]);

  const downloadPdf = async () => {
    try {
      const resp = await api.get(`/mess/stock-report.pdf?${qs()}`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([resp.data], { type: "application/pdf" }));
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (e) { toast.error(formatError(e)); }
  };

  const rows = data?.rows || [];
  const centerName = centerId ? (centers.find((c) => c.id === centerId)?.name || "") : "All authorized centers";
  const pill = (active) => `px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-[var(--brand)] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className="space-y-4" data-testid="mess-report-tab">
      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-wide text-slate-400 mb-1">Report Type</div>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            <button onClick={() => setMode("month")} className={pill(mode === "month")} data-testid="report-mode-month">Monthly</button>
            <button onClick={() => setMode("range")} className={pill(mode === "range")} data-testid="report-mode-range">Date Range</button>
          </div>
        </div>
        {mode === "month" ? (
          <div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400 mb-1">Month</div>
            <input type="month" value={ym} onChange={(e) => setYm(e.target.value)}
              className="text-sm rounded-lg px-2 py-1.5 border border-slate-200 text-slate-800" data-testid="report-month" />
          </div>
        ) : (
          <>
            <div>
              <div className="text-[9px] uppercase tracking-wide text-slate-400 mb-1">From</div>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="text-sm rounded-lg px-2 py-1.5 border border-slate-200 text-slate-800" data-testid="report-from" />
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wide text-slate-400 mb-1">To</div>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="text-sm rounded-lg px-2 py-1.5 border border-slate-200 text-slate-800" data-testid="report-to" />
            </div>
          </>
        )}
        <div className="flex-1" />
        <Button onClick={downloadPdf} disabled={loading || rows.length === 0}
          className="brand-btn rounded-lg gap-1.5" data-testid="report-download-pdf">
          <Download size={14} /> Download PDF
        </Button>
      </div>

      {/* Preview (same columns as the PDF) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="text-center py-3 border-b border-slate-200">
          <div className="font-heading font-black text-xl text-slate-900">{data?.title || "—"}</div>
          <div className="text-xs text-slate-500 mt-0.5">Mess Stock Report · {data?.center_name || centerName}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-50 text-slate-600 text-[11px] uppercase">
              <tr>
                <th className="text-center px-2 py-2 border border-slate-200 w-14">Sr. No</th>
                <th className="text-left px-3 py-2 border border-slate-200">Description / Item Name</th>
                <th className="text-center px-2 py-2 border border-slate-200">Unit</th>
                <th className="text-center px-2 py-2 border border-slate-200">Opening Balance</th>
                <th className="text-center px-2 py-2 border border-slate-200">Received</th>
                <th className="text-center px-2 py-2 border border-slate-200">Issued</th>
                <th className="text-center px-2 py-2 border border-slate-200">Remaining Balance</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center text-slate-400 py-10">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-slate-400 py-10">No stock movement in this period</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.item_id} className="hover:bg-slate-50" data-testid={`report-row-${r.item_id}`}>
                  <td className="text-center px-2 py-2 border border-slate-200">{i + 1}</td>
                  <td className="text-left px-3 py-2 border border-slate-200 font-medium text-slate-800">{r.name}</td>
                  <td className="text-center px-2 py-2 border border-slate-200">{r.unit}</td>
                  <td className="text-center px-2 py-2 border border-slate-200 num">{repQty(r.opening)}</td>
                  <td className="text-center px-2 py-2 border border-slate-200 num text-emerald-700">{repQty(r.received)}</td>
                  <td className="text-center px-2 py-2 border border-slate-200 num text-rose-600">{repQty(r.issued)}</td>
                  <td className="text-center px-2 py-2 border border-slate-200 num font-bold">{repQty(r.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

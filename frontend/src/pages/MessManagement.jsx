import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
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
  Wallet, Upload, FileText, Clock,
} from "lucide-react";

const API_ENTRY_ROLES = ["admin", "senior_manager", "manager", "center_manager", "mess_staff"];
const API_APPROVE_ROLES = ["admin", "senior_manager", "manager", "accountant"];
const API_ADMIN_ROLES = ["admin", "senior_manager", "manager"];

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
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        onReceive={() => setReceiptDlg(true)} onConsume={() => setConsDlg("consumption")}
        onWaste={() => setConsDlg("wastage")} canEntry={canEntry} centerId={centerId} />}

      {tab === "items" && <ItemsTab items={items} canAdmin={canAdmin} units={units}
        onAdd={() => setItemDlg({})} onEdit={(it) => setItemDlg(it)} />}

      {tab === "stock" && <StockTab stock={stock} loading={loading} />}

      {tab === "receipts" && <ReceiptsTab receipts={receipts} loading={loading} canEntry={canEntry}
        canApprove={canApprove} canRegen={["admin", "accountant"].includes(user?.role)} onCreate={() => setReceiptDlg(true)} onChanged={refresh} centerName={centerName} />}

      {tab === "consumption" && <ConsumptionTab rows={consumption} loading={loading} canEntry={canEntry}
        onAdd={() => setConsDlg("consumption")} />}

      {tab === "ledger" && <LedgerTab ledger={ledger} loading={loading} centerParam={centerParam} />}

      {tab === "closing" && <ClosingTab closing={closing} loading={loading} canApprove={canApprove}
        centerId={centerId} date={date} onChanged={refresh} />}

      {tab === "stockcount" && <StockCountTab counts={stockCounts} stock={stock} loading={loading}
        canApprove={canApprove} centerId={centerId} date={date} onChanged={refresh} />}

      {/* Dialogs */}
      {itemDlg && <ItemDialog item={itemDlg} units={units} onClose={() => setItemDlg(null)}
        onSaved={() => { setItemDlg(null); api.get("/mess/items").then(r => setItems(r.data)); }} />}
      {receiptDlg && <ReceiptDialog items={items} units={units} centers={centers} centerId={centerId}
        onClose={() => setReceiptDlg(false)} onSaved={() => { setReceiptDlg(false); setTab("receipts"); refresh(); }} />}
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

function DashboardTab({ dash, stock, loading, onReceive, onConsume, onWaste, canEntry }) {
  if (loading && !dash) return <div className="text-sm text-slate-500 p-8 text-center">Loading…</div>;
  const d = dash || {};
  const cpp = d.cost_per_person == null ? "N/A" : inr(d.cost_per_person);
  return (
    <div className="space-y-4">
      {canEntry && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={onReceive} className="brand-btn rounded-lg gap-1.5" data-testid="qa-receive"><PackagePlus size={15} /> Receive Stock</Button>
          <Button onClick={onConsume} variant="outline" className="rounded-lg gap-1.5" data-testid="qa-consume"><Soup size={15} /> Record Consumption</Button>
          <Button onClick={onWaste} variant="outline" className="rounded-lg gap-1.5 text-rose-700 border-rose-300" data-testid="qa-waste"><TrendingDown size={15} /> Record Wastage</Button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Opening Stock" value={inr(d.opening_value || 0)} sub="Start of day" Icon={Boxes} tone="blue" />
        <KpiCard label="Goods Received" value={inr(d.today_received_value || 0)} sub="Today" Icon={PackagePlus} tone="green" />
        <KpiCard label="Consumption Cost" value={inr(d.today_consumption_cost || 0)} sub="Today (weighted-avg)" Icon={Soup} tone="orange" />
        <KpiCard label="Closing Stock" value={inr(d.closing_value || 0)} sub="Current valuation" Icon={Boxes} tone="purple" />
        <KpiCard label="Mess Expenses" value={inr(d.today_mess_expenses || 0)} sub="Purchases today" Icon={IndianRupee} tone="blue" />
        <KpiCard label="Meals Served" value={d.meals_served || 0} sub="Today" Icon={Users} tone="green" />
        <KpiCard label="Cost / Person" value={cpp} sub="Consumption ÷ meals" Icon={IndianRupee} tone="orange" />
        <KpiCard label="Wastage" value={inr(d.today_wastage_cost || 0)} sub="Today" Icon={TrendingDown} tone="red" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 font-bold text-sm mb-3"><AlertTriangle size={16} className="text-amber-500" /> Low Stock Alerts <span className="num text-xs text-slate-400">({d.low_stock_count || 0})</span></div>
          {(stock || []).length === 0 ? <div className="text-xs text-slate-400 py-4 text-center">No low-stock items 🎉</div> : (
            <div className="space-y-1.5 max-h-72 overflow-auto">
              {(stock || []).slice(0, 30).map((s) => (
                <div key={s.item_id} className="flex items-center justify-between text-sm border-b border-slate-50 py-1" data-testid={`low-${s.item_id}`}>
                  <span className="font-medium text-slate-800">{s.item_name}</span>
                  <span className="num text-rose-600 font-bold">{s.qty} {s.base_unit} <span className="text-[10px] text-slate-400">/ min {s.min_stock}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 font-bold text-sm mb-3"><FileWarning size={16} className="text-blue-500" /> Pending Purchase Bills</div>
          <div className="num font-black text-3xl text-slate-900">{d.pending_bills || 0}</div>
          <div className="text-xs text-slate-500 mt-1">Goods receipts awaiting approval</div>
        </div>
      </div>
    </div>
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
          <Field label="Min Stock"><Input type="number" value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} className="rounded-lg" /></Field>
          <Field label="Reorder Level"><Input type="number" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value })} className="rounded-lg" /></Field>
          <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
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
      {canEntry && <div className="flex justify-end"><Button onClick={onCreate} className="brand-btn rounded-lg gap-1.5" data-testid="create-receipt-btn"><Plus size={15} /> New Goods Receipt</Button></div>}
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
                <div className="text-xs text-slate-500 mt-1">{r.supplier_name || "—"} · {r.center_name || centerName(r.center_id)} · {r.invoice_date} · {r.lines?.length || 0} item(s)</div>
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
          </div>
        ))}
        {receipts.length === 0 && <div className="text-center text-slate-400 py-10 bg-white border border-slate-200 rounded-xl">No goods receipts</div>}
      </div>
      {!canApprove && receipts.some((r) => r.status === "pending") && (
        <div className="text-[11px] text-slate-400 text-center">Approvals are actioned from the <span className="font-semibold">Pending Approvals</span> inbox by the configured approvers.</div>
      )}
      {payFor && <RaisePaymentDialog receipt={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); onChanged(); }} />}
    </div>
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
  const upd = (i, k, v) => { const n = [...lines]; n[i] = { ...n[i], [k]: v }; if (k === "item_id") { const it = items.find(x => x.id === v); if (it) n[i].unit = it.base_unit; } setLines(n); };
  const rm = (i) => setLines(lines.filter((_, idx) => idx !== i));
  const unitsFor = (id) => { const it = items.find(x => x.id === id); return it ? [...new Set([it.base_unit, it.purchase_unit])] : units; };
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
const newReceiptLine = () => ({ item_id: "", qty: "", unit: "", unit_price: "", discount: 0, tax: 0, gst_rate: "18", hsn_sac: "", accepted_qty: "", rejected_qty: 0 });

function ReceiptDialog({ items, units, centers, centerId, onClose, onSaved }) {
  const [f, setF] = useState({ center_id: centerId || "", supplier_id: "", supplier_name: "", invoice_no: "", invoice_date: todayStr(), po_no: "", attachments: [] });
  const [lines, setLines] = useState([newReceiptLine()]);
  const [vendors, setVendors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { api.get("/vendors").then((r) => setVendors(Array.isArray(r.data) ? r.data : [])).catch(() => setVendors([])); }, []);

  const pickVendor = (id) => {
    const v = vendors.find((x) => x.id === id);
    setF((p) => ({ ...p, supplier_id: id, supplier_name: v ? v.name : "" }));
  };

  const unitsFor = (id) => { const it = items.find((x) => x.id === id); return it ? [...new Set([it.base_unit, it.purchase_unit])] : units; };
  const addLine = () => setLines([...lines, newReceiptLine()]);
  const rmLine = (i) => setLines(lines.filter((_, idx) => idx !== i));
  const upd = (i, k, v) => {
    const n = [...lines];
    n[i] = { ...n[i], [k]: v };
    if (k === "item_id") { const it = items.find((x) => x.id === v); if (it) n[i].unit = it.base_unit; }
    setLines(n);
  };

  const lineTaxable = (ln) => Math.max(num(ln.qty) * num(ln.unit_price) - num(ln.discount), 0);
  const lineGst = (ln) => lineTaxable(ln) * num(ln.gst_rate) / 100;
  const lineTotal = (ln) => lineTaxable(ln) + lineGst(ln);
  const subtotal = lines.reduce((s, l) => s + num(l.qty) * num(l.unit_price), 0);
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
              <table className="w-full text-sm min-w-[1000px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide">
                    <th className="px-3 py-2.5 text-center w-10">S.No.</th>
                    <th className="px-3 py-2.5 text-left min-w-[260px]">Item</th>
                    <th className="px-2 py-2.5 text-left w-16">Qty</th>
                    <th className="px-2 py-2.5 text-left w-20">Unit</th>
                    <th className="px-2 py-2.5 text-left w-24">Rate</th>
                    <th className="px-2 py-2.5 text-left w-24">Discount</th>
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
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px] uppercase font-semibold text-slate-400 whitespace-nowrap">HSN/SAC <span className="normal-case text-slate-300">(Optional)</span></span>
                          <Input value={ln.hsn_sac || ""} onChange={(e) => upd(i, "hsn_sac", e.target.value)} placeholder="Enter HSN/SAC" className="rounded-lg h-8 text-xs flex-1 min-w-0" data-testid={`line-hsn-${i}`} />
                        </div>
                      </td>
                      <td className="px-2 py-3"><Input type="number" value={ln.qty} onChange={(e) => upd(i, "qty", e.target.value)} className="rounded-lg h-9 text-sm" data-testid={`line-qty-${i}`} /></td>
                      <td className="px-2 py-3">
                        <select value={ln.unit} onChange={(e) => upd(i, "unit", e.target.value)} className={inputCls} data-testid={`line-unit-${i}`}>{unitsFor(ln.item_id).map((u) => <option key={u}>{u}</option>)}</select>
                      </td>
                      <td className="px-2 py-3"><Input type="number" value={ln.unit_price} onChange={(e) => upd(i, "unit_price", e.target.value)} className="rounded-lg h-9 text-sm" data-testid={`line-rate-${i}`} /></td>
                      <td className="px-2 py-3"><Input type="number" value={ln.discount} onChange={(e) => upd(i, "discount", e.target.value)} className="rounded-lg h-9 text-sm" data-testid={`line-disc-${i}`} /></td>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-stretch">
              <div data-testid="receipt-subtotal"><div className="text-xs text-slate-500">Subtotal</div><div className="text-xl font-bold text-slate-900 num mt-0.5">{inr(subtotal)}</div></div>
              <div data-testid="receipt-discount"><div className="text-xs text-slate-500">Total Discount</div><div className="text-xl font-bold text-slate-900 num mt-0.5">{inr(totalDiscount)}</div></div>
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
            <Label>Shop Bill <span className="text-slate-400 normal-case">(upload — optional)</span></Label>
            <label className="flex items-center gap-3 cursor-pointer border border-dashed border-slate-300 rounded-xl px-4 py-3 hover:bg-slate-50 transition-colors" data-testid="receipt-bill-upload">
              <Upload size={20} className="text-slate-400" />
              <div>
                <div className="text-sm font-semibold text-slate-700">{uploading ? "Uploading…" : "Attach bill (PDF/Image)"}</div>
                <div className="text-[11px] text-slate-400">Supported formats: PDF, JPG, PNG · Max size: 5MB</div>
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

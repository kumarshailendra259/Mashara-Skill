import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import {
  UtensilsCrossed, RefreshCw, Package, ClipboardList, BookOpen, LayoutDashboard,
  Plus, Check, X, Trash2, Download, PackagePlus, Soup, AlertTriangle, Boxes,
  IndianRupee, Users, TrendingDown, FileWarning, Pencil,
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

  const [itemDlg, setItemDlg] = useState(null);      // item being created/edited
  const [receiptDlg, setReceiptDlg] = useState(false);
  const [consDlg, setConsDlg] = useState(null);      // "consumption" | "wastage"

  const centerParam = centerId ? `?center_id=${centerId}` : "";

  const loadCenters = async () => {
    try {
      const { data } = await api.get("/centers");
      const list = Array.isArray(data) ? data : [];
      setCenters(list);
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
        canApprove={canApprove} onCreate={() => setReceiptDlg(true)} onChanged={refresh} centerName={centerName} />}

      {tab === "consumption" && <ConsumptionTab rows={consumption} loading={loading} canEntry={canEntry}
        onAdd={() => setConsDlg("consumption")} />}

      {tab === "ledger" && <LedgerTab ledger={ledger} loading={loading} centerParam={centerParam} />}

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
        <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Item" : "Add Item"}</DialogTitle></DialogHeader>
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
function ReceiptsTab({ receipts, loading, canEntry, canApprove, onCreate, onChanged, centerName }) {
  const act = async (id, action) => {
    try {
      let remarks = "";
      if (action === "reject") { remarks = window.prompt("Reason for rejection?") || ""; }
      await api.post(`/mess/receipts/${id}/${action}`, action === "reject" ? { remarks } : {});
      toast.success(`Receipt ${action === "approve" ? "approved — stock & expense posted" : "rejected"}`);
      onChanged();
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
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-900">Inv {r.invoice_no}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${r.status === "approved" ? "bg-emerald-100 text-emerald-800" : r.status === "rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>{r.status.toUpperCase()}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">{(r.payment_status || "unpaid").toUpperCase()}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">{r.supplier_name || "—"} · {r.center_name || centerName(r.center_id)} · {r.invoice_date} · {r.lines?.length || 0} item(s)</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="num font-black text-lg text-emerald-700">{inr(r.total_amount)}</span>
                {canApprove && r.status === "pending" && (
                  <>
                    <Button size="sm" onClick={() => act(r.id, "approve")} className="brand-btn rounded-lg h-8 gap-1" data-testid={`approve-receipt-${r.id}`}><Check size={12} /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => act(r.id, "reject")} className="rounded-lg h-8 gap-1 text-rose-700 border-rose-300" data-testid={`reject-receipt-${r.id}`}><X size={12} /> Reject</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {receipts.length === 0 && <div className="text-center text-slate-400 py-10 bg-white border border-slate-200 rounded-xl">No goods receipts</div>}
      </div>
    </div>
  );
}

function LineEditor({ items, units, lines, setLines, mode }) {
  const addLine = () => setLines([...lines, mode === "receipt"
    ? { item_id: "", qty: "", unit: "", unit_price: "", discount: 0, tax: 0, accepted_qty: "", rejected_qty: 0 }
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
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={addLine} className="rounded-lg gap-1" data-testid="add-line"><Plus size={13} /> Add Line</Button>
    </div>
  );
}

function ReceiptDialog({ items, units, centers, centerId, onClose, onSaved }) {
  const [f, setF] = useState({ center_id: centerId || "", supplier_name: "", invoice_no: "", invoice_date: todayStr(), po_no: "" });
  const [lines, setLines] = useState([{ item_id: "", qty: "", unit: "", unit_price: "", discount: 0, tax: 0, accepted_qty: "", rejected_qty: 0 }]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.center_id) { toast.error("Select a center"); return; }
    if (!f.invoice_no.trim()) { toast.error("Invoice number required"); return; }
    const clean = lines.filter(l => l.item_id && Number(l.qty) > 0).map(l => ({
      item_id: l.item_id, qty: Number(l.qty), unit: l.unit, unit_price: Number(l.unit_price || 0),
      discount: Number(l.discount || 0), tax: Number(l.tax || 0),
      accepted_qty: Number(l.accepted_qty || l.qty), rejected_qty: Number(l.rejected_qty || 0),
    }));
    if (clean.length === 0) { toast.error("Add at least one valid line"); return; }
    setBusy(true);
    try { await api.post("/mess/receipts", { ...f, lines: clean }); toast.success("Goods receipt created (pending approval)"); onSaved(); }
    catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-xl max-w-3xl">
        <DialogHeader><DialogTitle className="font-heading">New Goods Receipt</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2"><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Center</div>
            <select value={f.center_id} onChange={(e) => setF({ ...f, center_id: e.target.value })} className="w-full border border-slate-200 rounded-lg p-2 text-sm" data-testid="receipt-center"><option value="">Select…</option>{centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Invoice No</div><Input value={f.invoice_no} onChange={(e) => setF({ ...f, invoice_no: e.target.value })} className="rounded-lg" data-testid="receipt-invoice" /></div>
          <div><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Invoice Date</div><Input type="date" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} className="rounded-lg" /></div>
          <div className="col-span-2"><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Supplier</div><Input value={f.supplier_name} onChange={(e) => setF({ ...f, supplier_name: e.target.value })} className="rounded-lg" data-testid="receipt-supplier" /></div>
          <div className="col-span-2"><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">PO No (optional)</div><Input value={f.po_no} onChange={(e) => setF({ ...f, po_no: e.target.value })} className="rounded-lg" /></div>
        </div>
        <div className="mt-2"><div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Items</div>
          <LineEditor items={items} units={units} lines={lines} setLines={setLines} mode="receipt" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg">Cancel</Button>
          <Button onClick={save} disabled={busy} className="brand-btn rounded-lg gap-1" data-testid="save-receipt"><Check size={14} /> {busy ? "Saving…" : "Create Receipt"}</Button>
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
        <DialogHeader><DialogTitle className="font-heading">{mode === "wastage" ? "Record Wastage" : "Record Consumption"}</DialogTitle></DialogHeader>
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

/* ---------------- Ledger ---------------- */
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

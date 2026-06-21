import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Printer, Search, AlertTriangle, Check } from "lucide-react";

const TXN_TYPES = ["expense", "investment", "income"];

export default function Stock() {
  const { t } = useLang();
  const { user } = useAuth();
  const canAdd = ["admin", "manager", "center_manager", "accountant"].includes(user?.role);

  const [centers, setCenters] = useState([]);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ center_id: "", txn_type: "", start: "", end: "", search: "" });
  const [loading, setLoading] = useState(false);

  // Quick-add stock dialog (creates a 1-line expense txn)
  const [open, setOpen] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const emptyForm = { center_id: "", txn_type: "expense", date: todayIso, name: "", quantity: 1, rate: 0 };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    api.get("/entities/center").then((r) => setCenters(r.data)).catch(() => {});
  }, []);

  const params = useMemo(() => {
    const p = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    return p;
  }, [filters]);

  const load = () => {
    setLoading(true);
    api.get("/stock", { params }).then((r) => setRows(r.data)).catch(() => setRows([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [params]);

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));

  const amount = (parseFloat(form.quantity) || 0) * (parseFloat(form.rate) || 0);

  const quickAdd = async () => {
    if (!form.name.trim()) { toast.error("Item name required"); return; }
    if (!(amount > 0)) { toast.error("Qty × Rate must be > 0"); return; }
    try {
      await api.post("/transactions", {
        type: form.txn_type,
        amount,
        date: form.date,
        description: `Stock entry: ${form.name}`,
        company_id: null, partner_id: null,
        center_id: form.center_id || null,
        project_id: null,
        items: [{
          name: form.name.trim(),
          quantity: parseFloat(form.quantity) || 0,
          rate: parseFloat(form.rate) || 0,
          amount,
        }],
        attachments: [],
      });
      setOpen(false);
      setForm(emptyForm);
      load();
      toast.success("Stock added");
    } catch (e) { toast.error(formatError(e)); }
  };

  // Totals
  const totals = rows.reduce((acc, r) => {
    acc.qty += parseFloat(r.quantity) || 0;
    acc.amount += parseFloat(r.amount) || 0;
    if (r.is_duplicate) acc.dups += 1;
    return acc;
  }, { qty: 0, amount: 0, dups: 0 });

  return (
    <div className="space-y-5" data-testid="stock-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">{t("stock") || "Stock"}</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">Center-wise Stock</h1>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <Button variant="outline" onClick={() => window.print()} className="rounded-none gap-2" data-testid="btn-print"><Printer size={14} /> Print</Button>
          {canAdd && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="brand-btn rounded-none gap-2" data-testid="btn-new-stock"><Plus size={16} /> Add Stock</Button>
              </DialogTrigger>
              <DialogContent className="rounded-none">
                <DialogHeader><DialogTitle className="font-heading">Add Stock Item</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label>Item Name</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. A4 paper, Laptop, Cement bags…" className="rounded-none" data-testid="stock-name" />
                  </div>
                  <div>
                    <Label>Quantity</Label>
                    <Input type="number" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="rounded-none num" data-testid="stock-qty" />
                  </div>
                  <div>
                    <Label>Rate (per unit)</Label>
                    <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="rounded-none num" data-testid="stock-rate" />
                  </div>
                  <div>
                    <Label>Center</Label>
                    <Select value={form.center_id || "__none"} onValueChange={(v) => setForm({ ...form, center_id: v === "__none" ? "" : v })}>
                      <SelectTrigger className="rounded-none" data-testid="stock-center"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">—</SelectItem>
                        {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Transaction Type</Label>
                    <Select value={form.txn_type} onValueChange={(v) => setForm({ ...form, txn_type: v })}>
                      <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                      <SelectContent>{TXN_TYPES.map((tt) => <SelectItem key={tt} value={tt}>{tt}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>Purchase Date</Label>
                    <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-none" data-testid="stock-date" />
                  </div>
                  <div className="col-span-2 border-t border-[var(--border)] pt-2 flex justify-between items-center">
                    <span className="overline">Total Amount</span>
                    <span className="num font-bold text-lg">{inr(amount)}</span>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button>
                  <Button onClick={quickAdd} className="brand-btn rounded-none" data-testid="stock-save">Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="swiss-card p-4 grid grid-cols-2 md:grid-cols-5 gap-3 no-print">
        <div>
          <Label className="overline">Center</Label>
          <Select value={filters.center_id || "__all"} onValueChange={(v) => setF("center_id", v === "__all" ? "" : v)}>
            <SelectTrigger className="rounded-none" data-testid="filter-center"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All centers</SelectItem>
              {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="overline">Type</Label>
          <Select value={filters.txn_type || "__all"} onValueChange={(v) => setF("txn_type", v === "__all" ? "" : v)}>
            <SelectTrigger className="rounded-none" data-testid="filter-txntype"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All types</SelectItem>
              {TXN_TYPES.map((tt) => <SelectItem key={tt} value={tt}>{tt}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="overline">From</Label>
          <Input type="date" value={filters.start} onChange={(e) => setF("start", e.target.value)} className="rounded-none" data-testid="filter-start" />
        </div>
        <div>
          <Label className="overline">To</Label>
          <Input type="date" value={filters.end} onChange={(e) => setF("end", e.target.value)} className="rounded-none" data-testid="filter-end" />
        </div>
        <div>
          <Label className="overline">Search Item</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <Input value={filters.search} onChange={(e) => setF("search", e.target.value)} className="rounded-none pl-7" placeholder="Item name" data-testid="filter-search" />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print-summary">
        <div className="swiss-card p-3"><div className="overline">Rows</div><div className="num font-bold text-2xl">{rows.length}</div></div>
        <div className="swiss-card p-3"><div className="overline">Total Quantity</div><div className="num font-bold text-2xl">{totals.qty.toLocaleString()}</div></div>
        <div className="swiss-card p-3"><div className="overline">Total Amount</div><div className="num font-bold text-2xl">{inr(totals.amount)}</div></div>
        <div className="swiss-card p-3"><div className="overline">Duplicates</div><div className="num font-bold text-2xl text-[var(--warning)]">{totals.dups}</div></div>
      </div>

      {/* Table */}
      <div className="swiss-card overflow-x-auto" data-testid="stock-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3">Purchase Date</th>
              <th className="text-left p-3">Item</th>
              <th className="text-left p-3">Center</th>
              <th className="text-left p-3">Type</th>
              <th className="text-right p-3">Qty</th>
              <th className="text-right p-3">Rate</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3 w-32">Flag</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 overline">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 overline">No stock items</td></tr>
            ) : rows.map((r, i) => (
              <tr key={`${r.txn_id}-${r.name}-${i}`} className={`border-b border-[var(--border)] hover:bg-gray-50 ${r.is_duplicate ? "bg-[#fffaf0]" : ""}`}>
                <td className="p-3 num">{r.date}</td>
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.center_name || <span className="text-[var(--muted)]">—</span>}</td>
                <td className="p-3">
                  <span className={`inline-block px-2 py-0.5 text-xs border ${
                    r.txn_type === "income" ? "border-[var(--success)] text-[var(--success)]" :
                    r.txn_type === "expense" ? "border-[var(--danger)] text-[var(--danger)]" :
                    "border-[var(--brand)] text-[var(--brand)]"
                  }`}>{r.txn_type}</span>
                </td>
                <td className="p-3 num">{(r.quantity || 0).toLocaleString()}</td>
                <td className="p-3 num">{inr(r.rate)}</td>
                <td className="p-3 num font-medium">{inr(r.amount)}</td>
                <td className="p-3 overline text-xs">{r.txn_status}</td>
                <td className="p-3">
                  {r.is_duplicate ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs border border-[var(--warning)] text-[#9a7a00]" data-testid={`flag-dup-${i}`}>
                      <AlertTriangle size={12} /> Duplicate
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs border border-[var(--success)] text-[var(--success)]">
                      <Check size={12} /> First
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] bg-gray-50 font-semibold">
                <td colSpan={4} className="p-3 text-right overline">Total</td>
                <td className="p-3 num">{totals.qty.toLocaleString()}</td>
                <td></td>
                <td className="p-3 num">{inr(totals.amount)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

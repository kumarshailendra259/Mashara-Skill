import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Download, Upload, Paperclip, List, CheckSquare } from "lucide-react";
import PrintButton from "@/components/PrintButton";

const TXN_TYPES = ["investment", "income", "expense"];
const ENTITY_TYPES = ["company", "partner", "center", "project"];

export default function Transactions() {
  const { t } = useLang();
  const { user } = useAuth();
  const canEdit = ["admin", "manager", "center_manager", "partner", "accountant"].includes(user?.role);
  const canDelete = user?.role === "admin";
  const isAdmin = user?.role === "admin";
  const [entities, setEntities] = useState({ company: [], partner: [], center: [], project: [] });
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ type: "", status: "", company_id: "", partner_id: "", center_id: "", project_id: "", start: "", end: "" });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [itemSuggestions, setItemSuggestions] = useState([]);

  // Load distinct item names for the datalist (autocomplete)
  useEffect(() => {
    api.get("/items/suggestions").then((r) => setItemSuggestions(r.data || [])).catch(() => {});
  }, [open]);
  const emptyForm = { type: "expense", amount: "", date: new Date().toISOString().slice(0, 10), description: "", company_id: "", partner_id: "", center_id: "", project_id: "", items: [], attachments: [] };
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef(null);
  const attachRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const loadEntities = () =>
    Promise.all(ENTITY_TYPES.map((tt) => api.get(`/entities/${tt}`))).then((r) => {
      const e = {}; ENTITY_TYPES.forEach((tt, i) => (e[tt] = r[i].data)); setEntities(e);
    });

  const params = useMemo(() => {
    const p = {}; Object.entries(filters).forEach(([k, v]) => v && (p[k] = v)); return p;
  }, [filters]);

  const load = () => api.get("/transactions", { params }).then((r) => setItems(r.data));

  const approveTxn = async (id) => {
    try { await api.post(`/transactions/${id}/approve`); load(); toast.success("Approved"); }
    catch (e) { toast.error(formatError(e)); }
  };
  const rejectTxn = async (id) => {
    const reason = window.prompt("Reason (optional):") || "";
    try { await api.post(`/transactions/${id}/reject`, { reason }); load(); toast.success("Rejected"); }
    catch (e) { toast.error(formatError(e)); }
  };

  const eligibleIds = items.filter((it) => it.status !== "approved").map((it) => it.id);
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
  const toggleOne = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected((s) => {
    if (eligibleIds.every((id) => s.has(id))) return new Set();
    return new Set(eligibleIds);
  });
  const bulkApprove = async () => {
    const ids = Array.from(selected).filter((id) => eligibleIds.includes(id));
    if (ids.length === 0) { toast.error("Nothing to approve"); return; }
    try {
      const { data } = await api.post("/transactions/bulk-approve", { ids });
      setSelected(new Set());
      await load();
      toast.success(`Approved ${data.approved} transaction${data.approved === 1 ? "" : "s"}`);
    } catch (e) { toast.error(formatError(e)); }
  };

  useEffect(() => { loadEntities(); }, []);
  useEffect(() => { load(); }, [params]);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (it) => {
    setEditing(it);
    setForm({
      type: it.type, amount: it.amount, date: it.date, description: it.description || "",
      company_id: it.company_id || "", partner_id: it.partner_id || "",
      center_id: it.center_id || "", project_id: it.project_id || "",
      items: it.items || [], attachments: it.attachments || [],
    });
    setOpen(true);
  };

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { name: "", quantity: 1, rate: 0, amount: 0 }] }));
  const updateItem = (idx, key, val) => setForm((f) => {
    const items = f.items.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, [key]: val };
      if (key === "quantity" || key === "rate") {
        const q = parseFloat(next.quantity || 0);
        const r = parseFloat(next.rate || 0);
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
      const payload = { ...form, amount: computedAmount };
      ENTITY_TYPES.forEach((et) => { if (!payload[`${et}_id`]) payload[`${et}_id`] = null; });
      if (editing) await api.put(`/transactions/${editing.id}`, payload);
      else await api.post("/transactions", payload);
      setOpen(false); load(); toast.success("Saved");
    } catch (e) { toast.error(formatError(e)); }
  };

  const [deleting, setDeleting] = useState(new Set());
  const remove = async (it) => {
    if (deleting.has(it.id)) return; // prevent double-click race
    if (!window.confirm(t("confirm_delete"))) return;
    setDeleting((s) => new Set(s).add(it.id));
    // Optimistic: drop the row from local state immediately so it can't be re-clicked
    setItems((cur) => cur.filter((x) => x.id !== it.id));
    try {
      await api.delete(`/transactions/${it.id}`);
      toast.success("Deleted");
    } catch (e) {
      toast.error(formatError(e));
      load(); // restore list on failure
    } finally {
      setDeleting((s) => { const n = new Set(s); n.delete(it.id); return n; });
    }
  };

  const nameOf = (etype, id) => entities[etype].find((e) => e.id === id)?.name || "—";

  const exportCsv = () => {
    const header = ["type", "amount", "date", "description", "company", "partner", "center", "project"];
    const rows = items.map((it) => [
      it.type, it.amount, it.date, (it.description || "").replace(/"/g, '""'),
      nameOf("company", it.company_id), nameOf("partner", it.partner_id),
      nameOf("center", it.center_id), nameOf("project", it.project_id),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "")}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `transactions_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      const { data } = await api.post("/transactions/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported ${data.inserted}` + (data.errors?.length ? ` (${data.errors.length} errors)` : ""));
      loadEntities(); load();
    } catch (err) { toast.error(formatError(err)); }
    finally { e.target.value = ""; }
  };

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));

  return (
    <div className="space-y-5" data-testid="transactions-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">{t("transactions")}</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t("transactions")}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && selected.size > 0 && (
            <Button onClick={bulkApprove} className="brand-btn rounded-none gap-2" data-testid="btn-bulk-approve">
              <CheckSquare size={14} /> Approve ({selected.size})
            </Button>
          )}
          <PrintButton />
          <Button variant="outline" onClick={exportCsv} className="rounded-none gap-2" data-testid="btn-export"><Download size={14} /> {t("export_csv")}</Button>
          {canEdit && (
            <>
              <input ref={fileRef} type="file" accept=".csv" hidden onChange={importCsv} data-testid="csv-file" />
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="rounded-none gap-2" data-testid="btn-import"><Upload size={14} /> {t("import_csv")}</Button>
              <Button onClick={openNew} className="brand-btn rounded-none gap-2" data-testid="btn-new-txn"><Plus size={16} /> {t("new_transaction")}</Button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="swiss-card p-4 grid grid-cols-2 md:grid-cols-7 gap-3">
        <div>
          <Label className="overline">{t("status")}</Label>
          <Select value={filters.status || "__all"} onValueChange={(v) => setF("status", v === "__all" ? "" : v)}>
            <SelectTrigger className="rounded-none" data-testid="filter-status"><SelectValue placeholder={t("all")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("all")}</SelectItem>
              <SelectItem value="pending">{t("pending")}</SelectItem>
              <SelectItem value="approved">{t("approved")}</SelectItem>
              <SelectItem value="rejected">{t("rejected")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="overline">{t("type")}</Label>
          <Select value={filters.type || "__all"} onValueChange={(v) => setF("type", v === "__all" ? "" : v)}>
            <SelectTrigger className="rounded-none" data-testid="filter-type"><SelectValue placeholder={t("all")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("all")}</SelectItem>
              {TXN_TYPES.map((tt) => <SelectItem key={tt} value={tt}>{t(tt)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {ENTITY_TYPES.map((etype) => (
          <div key={etype}>
            <Label className="overline">{t(etype)}</Label>
            <Select value={filters[`${etype}_id`] || "__all"} onValueChange={(v) => setF(`${etype}_id`, v === "__all" ? "" : v)}>
              <SelectTrigger className="rounded-none"><SelectValue placeholder={t("all")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t("all")}</SelectItem>
                {entities[etype].map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
        <div>
          <Label className="overline">From</Label>
          <Input type="date" value={filters.start} onChange={(e) => setF("start", e.target.value)} className="rounded-none" />
        </div>
        <div>
          <Label className="overline">To</Label>
          <Input type="date" value={filters.end} onChange={(e) => setF("end", e.target.value)} className="rounded-none" />
        </div>
      </div>

      {/* Table */}
      <div className="swiss-card overflow-x-auto" data-testid="txn-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] overline bg-gray-50">
              {isAdmin && (
                <th className="text-left p-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer" data-testid="select-all-txn" disabled={eligibleIds.length === 0} />
                </th>
              )}
              <th className="text-left p-3">{t("date")}</th>
              <th className="text-left p-3">{t("type")}</th>
              <th className="text-right p-3">{t("amount")}</th>
              <th className="text-left p-3">{t("company")}</th>
              <th className="text-left p-3">{t("partner")}</th>
              <th className="text-left p-3">{t("center")}</th>
              <th className="text-left p-3">{t("project")}</th>
              <th className="text-left p-3">{t("description")}</th>
              <th className="text-left p-3">{t("status")}</th>
              {canEdit && <th className="p-3 text-right w-40">{t("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={isAdmin ? 11 : 10} className="text-center py-8 overline">{t("no_data")}</td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                {isAdmin && (
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggleOne(it.id)}
                      disabled={it.status === "approved"}
                      className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                      data-testid={`select-txn-${it.id}`}
                    />
                  </td>
                )}
                <td className="p-3 num">{it.date}</td>
                <td className="p-3">
                  <span className={`inline-block px-2 py-0.5 text-xs border ${
                    it.type === "income" ? "border-[var(--success)] text-[var(--success)]" :
                    it.type === "expense" ? "border-[var(--danger)] text-[var(--danger)]" :
                    "border-[var(--brand)] text-[var(--brand)]"
                  }`}>{t(it.type)}</span>
                </td>
                <td className={`p-3 num font-medium ${it.type === "income" ? "value-positive" : it.type === "expense" ? "value-negative" : ""}`}>{inr(it.amount)}</td>
                <td className="p-3">{nameOf("company", it.company_id)}</td>
                <td className="p-3">{nameOf("partner", it.partner_id)}</td>
                <td className="p-3">{nameOf("center", it.center_id)}</td>
                <td className="p-3">{nameOf("project", it.project_id)}</td>
                <td className="p-3 text-[var(--muted)] max-w-xs truncate">
                  <div className="flex items-center gap-2">
                    {(it.items?.length || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--brand)] border border-[var(--brand)] px-1.5 py-0.5" title={`${it.items.length} items`}>
                        <List size={11} /> {it.items.length}
                      </span>
                    )}
                    {(it.attachments?.length || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)] border border-[var(--border)] px-1.5 py-0.5" title={`${it.attachments.length} attachments`}>
                        <Paperclip size={11} /> {it.attachments.length}
                      </span>
                    )}
                    <span className="truncate">{it.description}</span>
                  </div>
                </td>
                <td className="p-3">
                  <span className={`inline-block px-2 py-0.5 text-xs border ${
                    it.status === "approved" ? "border-[var(--success)] text-[var(--success)]" :
                    it.status === "rejected" ? "border-[var(--danger)] text-[var(--danger)]" :
                    "border-[var(--warning)] text-[#9a7a00]"
                  }`} title={it.rejected_reason || ""}>{t(it.status || "pending")}</span>
                </td>
                {canEdit && (
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-1">
                      {isAdmin && it.status !== "approved" && (
                        <Button size="sm" variant="ghost" onClick={() => approveTxn(it.id)} className="rounded-none h-8 px-2 text-[var(--success)]" data-testid={`approve-${it.id}`}>{t("approve")}</Button>
                      )}
                      {isAdmin && it.status !== "rejected" && (
                        <Button size="sm" variant="ghost" onClick={() => rejectTxn(it.id)} className="rounded-none h-8 px-2 text-[var(--danger)]" data-testid={`reject-${it.id}`}>{t("reject")}</Button>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => openEdit(it)} className="rounded-none h-8 w-8"><Pencil size={14} /></Button>
                      {canDelete && <Button size="icon" variant="ghost" disabled={deleting.has(it.id)} onClick={() => remove(it)} className="rounded-none h-8 w-8 hover:text-[var(--danger)] disabled:opacity-40"><Trash2 size={14} /></Button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-tight">{editing ? t("edit") : t("new_transaction")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("type")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="rounded-none" data-testid="txn-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TXN_TYPES.map((tt) => <SelectItem key={tt} value={tt}>{t(tt)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("amount")} {form.items.length > 0 && <span className="text-xs text-[var(--muted)]">(auto from items)</span>}</Label>
              <Input
                type="number" step="0.01"
                value={form.items.length ? itemsTotal : form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                disabled={form.items.length > 0}
                className="rounded-none" data-testid="txn-amount"
              />
            </div>
            <div className="col-span-2">
              <Label>{t("date")}</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-none" data-testid="txn-date" />
            </div>
            {ENTITY_TYPES.map((etype) => (
              <div key={etype}>
                <Label>{t(etype)}</Label>
                <Select value={form[`${etype}_id`] || "__none"} onValueChange={(v) => setForm({ ...form, [`${etype}_id`]: v === "__none" ? "" : v })}>
                  <SelectTrigger className="rounded-none" data-testid={`txn-${etype}`}><SelectValue placeholder={t("all")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {entities[etype].map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="col-span-2">
              <Label>{t("description")}</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-none" rows={2} />
            </div>

            {/* Items */}
            <div className="col-span-2 border-t border-[var(--border)] pt-4 mt-2">
              <div className="flex items-center justify-between mb-2">
                <Label className="overline">{t("items") || "Items"}</Label>
                <Button type="button" size="sm" variant="outline" className="rounded-none gap-2" onClick={addItem} data-testid="btn-add-item">
                  <Plus size={14} /> {t("add") || "Add"}
                </Button>
              </div>
              {form.items.length === 0 ? (
                <div className="overline text-center py-3 border border-dashed border-[var(--border)]">No items — optional. Add line items for granular tracking.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="overline border-b border-[var(--border)]">
                      <th className="text-left py-2">Item</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Rate</th>
                      <th className="text-right">Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, idx) => {
                      const itemKey = it._k || (it._k = `it-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
                      return (
                      <tr key={itemKey} className="border-b border-[var(--border)]">
                        <td className="py-1.5 pr-2">
                          <Input value={it.name} onChange={(e) => updateItem(idx, "name", e.target.value)} placeholder="Item name" list="txn-item-names" className="rounded-none h-8" data-testid={`item-name-${idx}`} />
                        </td>
                        <td className="py-1.5 pr-2 w-20">
                          <Input type="number" step="0.01" value={it.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} className="rounded-none h-8 num" />
                        </td>
                        <td className="py-1.5 pr-2 w-28">
                          <Input type="number" step="0.01" value={it.rate} onChange={(e) => updateItem(idx, "rate", e.target.value)} className="rounded-none h-8 num" />
                        </td>
                        <td className="py-1.5 pr-2 w-28">
                          <Input type="number" step="0.01" value={it.amount} onChange={(e) => updateItem(idx, "amount", parseFloat(e.target.value) || 0)} className="rounded-none h-8 num font-medium" />
                        </td>
                        <td className="w-10">
                          <Button type="button" size="icon" variant="ghost" onClick={() => removeItem(idx)} className="h-8 w-8 rounded-none hover:text-[var(--danger)]"><Trash2 size={14} /></Button>
                        </td>
                      </tr>
                      );
                    })}
                    <tr>
                      <td colSpan={3} className="text-right overline pt-2">Items Total</td>
                      <td className="num font-bold pt-2">{inr(itemsTotal)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* Attachments */}
            <div className="col-span-2 border-t border-[var(--border)] pt-4 mt-2">
              <div className="flex items-center justify-between mb-2">
                <Label className="overline">Attachments</Label>
                <div>
                  <input ref={attachRef} type="file" hidden onChange={uploadAttachment} data-testid="attach-input" />
                  <Button type="button" size="sm" variant="outline" className="rounded-none gap-2" disabled={uploading} onClick={() => attachRef.current?.click()} data-testid="btn-attach">
                    <Upload size={14} /> {uploading ? "Uploading…" : "Attach file"}
                  </Button>
                </div>
              </div>
              {form.attachments.length === 0 ? (
                <div className="overline text-center py-3 border border-dashed border-[var(--border)]">No attachments — upload bills, receipts, invoices (max 10MB).</div>
              ) : (
                <ul className="space-y-1">
                  {form.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between border border-[var(--border)] px-3 py-2 text-sm">
                      <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline truncate">
                        {a.filename}
                      </a>
                      <div className="flex items-center gap-3 ml-3">
                        <span className="overline">{(a.size / 1024).toFixed(0)} KB</span>
                        <Button type="button" size="icon" variant="ghost" onClick={() => removeAttachment(a.id)} className="h-7 w-7 rounded-none hover:text-[var(--danger)]"><Trash2 size={14} /></Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">{t("cancel")}</Button>
            <Button onClick={save} className="brand-btn rounded-none" data-testid="txn-save">{t("save")}</Button>
          </DialogFooter>
          {/* Shared datalist for item-name autocomplete */}
          <datalist id="txn-item-names">
            {itemSuggestions.map((s) => <option key={s.name} value={s.name} />)}
          </datalist>
        </DialogContent>
      </Dialog>
    </div>
  );
}

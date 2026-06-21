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
import { Plus, Pencil, Trash2, Download, Upload } from "lucide-react";

const TXN_TYPES = ["investment", "income", "expense"];
const ENTITY_TYPES = ["company", "partner", "center", "project"];

export default function Transactions() {
  const { t } = useLang();
  const { user } = useAuth();
  const canEdit = ["admin", "manager"].includes(user?.role);
  const canDelete = user?.role === "admin";
  const [entities, setEntities] = useState({ company: [], partner: [], center: [], project: [] });
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ type: "", company_id: "", partner_id: "", center_id: "", project_id: "", start: "", end: "" });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const emptyForm = { type: "expense", amount: "", date: new Date().toISOString().slice(0, 10), description: "", company_id: "", partner_id: "", center_id: "", project_id: "" };
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef(null);

  const loadEntities = () =>
    Promise.all(ENTITY_TYPES.map((tt) => api.get(`/entities/${tt}`))).then((r) => {
      const e = {}; ENTITY_TYPES.forEach((tt, i) => (e[tt] = r[i].data)); setEntities(e);
    });

  const params = useMemo(() => {
    const p = {}; Object.entries(filters).forEach(([k, v]) => v && (p[k] = v)); return p;
  }, [filters]);

  const load = () => api.get("/transactions", { params }).then((r) => setItems(r.data));

  useEffect(() => { loadEntities(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params]);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (it) => {
    setEditing(it);
    setForm({
      type: it.type, amount: it.amount, date: it.date, description: it.description || "",
      company_id: it.company_id || "", partner_id: it.partner_id || "",
      center_id: it.center_id || "", project_id: it.project_id || "",
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = { ...form, amount: parseFloat(form.amount) };
      ENTITY_TYPES.forEach((et) => { if (!payload[`${et}_id`]) payload[`${et}_id`] = null; });
      if (editing) await api.put(`/transactions/${editing.id}`, payload);
      else await api.post("/transactions", payload);
      setOpen(false); load(); toast.success("Saved");
    } catch (e) { toast.error(formatError(e)); }
  };

  const remove = async (it) => {
    if (!window.confirm(t("confirm_delete"))) return;
    try { await api.delete(`/transactions/${it.id}`); load(); toast.success("Deleted"); }
    catch (e) { toast.error(formatError(e)); }
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
              <th className="text-left p-3">{t("date")}</th>
              <th className="text-left p-3">{t("type")}</th>
              <th className="text-right p-3">{t("amount")}</th>
              <th className="text-left p-3">{t("company")}</th>
              <th className="text-left p-3">{t("partner")}</th>
              <th className="text-left p-3">{t("center")}</th>
              <th className="text-left p-3">{t("project")}</th>
              <th className="text-left p-3">{t("description")}</th>
              {canEdit && <th className="p-3 text-right w-28">{t("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 overline">{t("no_data")}</td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="border-b border-[var(--border)] hover:bg-gray-50">
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
                <td className="p-3 text-[var(--muted)] max-w-xs truncate">{it.description}</td>
                {canEdit && (
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(it)} className="rounded-none h-8 w-8"><Pencil size={14} /></Button>
                      {canDelete && <Button size="icon" variant="ghost" onClick={() => remove(it)} className="rounded-none h-8 w-8 hover:text-[var(--danger)]"><Trash2 size={14} /></Button>}
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
        <DialogContent className="rounded-none max-w-lg">
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
              <Label>{t("amount")}</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-none" data-testid="txn-amount" />
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">{t("cancel")}</Button>
            <Button onClick={save} className="brand-btn rounded-none" data-testid="txn-save">{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

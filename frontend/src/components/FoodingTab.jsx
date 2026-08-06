import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, Utensils, Sparkles } from "lucide-react";

// Fooding income manager for a single batch.
// Each row = one month entry. gross = mandays × cost/manday. Income split uses the
// batch's partner_share_percent. NO TDS deduction (per business spec).

const monthLabel = (m) => {
  if (!m || m.length !== 7) return m || "—";
  const [y, mm] = m.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(mm, 10) - 1] || mm} ${y}`;
};

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function FoodingTab({ batch, companies, partners, canEdit, canReceive }) {
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const empty = { month: currentMonth(), mandays_claimed: 0, boarding_cost_per_manday: 0, description: "" };
  const [form, setForm] = useState(empty);
  const [recvOpen, setRecvOpen] = useState(false);
  const [recvTarget, setRecvTarget] = useState(null);
  const [recvCompanyId, setRecvCompanyId] = useState("");

  const load = async () => {
    if (!batch?.id) { setEntries([]); return; }
    try {
      const r = await api.get("/fooding-entries", { params: { batch_id: batch.id } });
      setEntries(r.data);
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { load(); }, [batch?.id]);

  const openNew = () => {
    if (batch.closed) { toast.error("Batch is closed — reopen to add entries"); return; }
    setEditing(null);
    setForm(empty);
    setOpen(true);
  };
  const openEdit = (e) => {
    setEditing(e);
    setForm({
      month: e.month, mandays_claimed: e.mandays_claimed, boarding_cost_per_manday: e.boarding_cost_per_manday,
      description: e.description || "",
    });
    setOpen(true);
  };
  const save = async () => {
    try {
      const payload = {
        batch_id: batch.id,
        month: form.month,
        mandays_claimed: parseFloat(form.mandays_claimed) || 0,
        boarding_cost_per_manday: parseFloat(form.boarding_cost_per_manday) || 0,
        description: form.description || "",
      };
      if (editing) await api.put(`/fooding-entries/${editing.id}`, payload);
      else await api.post("/fooding-entries", payload);
      setOpen(false);
      load();
      toast.success("Saved");
    } catch (e) { toast.error(formatError(e)); }
  };

  const suggestMandays = async () => {
    if (!form.month) { toast.error("Pick a month first"); return; }
    try {
      const r = await api.get(`/batches/${batch.id}/mandays-suggestion`, { params: { month: form.month } });
      setForm((s) => ({ ...s, mandays_claimed: r.data.mandays_suggestion || 0 }));
      toast.success(`Suggested: ${r.data.mandays_suggestion} mandays (${r.data.source})`);
    } catch (e) { toast.error(formatError(e)); }
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete fooding entry for ${monthLabel(e.month)}?${e.status === "received" ? " This will also delete linked transactions." : ""}`)) return;
    try {
      await api.delete(`/fooding-entries/${e.id}`);
      load();
      toast.success("Deleted");
    } catch (err) { toast.error(formatError(err)); }
  };

  const [recvBusy, setRecvBusy] = useState(false);
  const openReceive = (e) => {
    setRecvTarget(e);
    setRecvCompanyId(e.company_id || batch.company_id || "");
    setRecvOpen(true);
  };
  const confirmReceive = async () => {
    if (!recvTarget || recvBusy) return;  // guard against rapid double-click
    setRecvBusy(true);
    try {
      await api.patch(`/fooding-entries/${recvTarget.id}/receive`, { company_id: recvCompanyId || null });
      setRecvOpen(false);
      load();
      toast.success("Received & transactions recorded");
    } catch (e) { toast.error(formatError(e)); }
    finally { setRecvBusy(false); }
  };

  const totals = useMemo(() => {
    const gross = entries.reduce((s, e) => s + (e.gross_amount || 0), 0);
    const received = entries.filter((e) => e.status === "received").reduce((s, e) => s + (e.gross_amount || 0), 0);
    return { gross, received, count: entries.length };
  }, [entries]);

  const formGross = (parseFloat(form.mandays_claimed) || 0) * (parseFloat(form.boarding_cost_per_manday) || 0);

  return (
    <div className="space-y-4" data-testid="fooding-tab">
      {batch.closed && (
        <div className="border-l-4 border-[var(--warning)] bg-yellow-50 p-3 text-sm">
          <span className="overline text-[var(--warning)]">Batch Closed</span> — no new fooding entries can be added. Reopen the batch above to resume.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="swiss-card p-3"><div className="overline">Entries</div><div className="num font-bold text-2xl">{totals.count}</div></div>
        <div className="swiss-card p-3"><div className="overline">Gross Configured</div><div className="num font-bold text-xl">{inr(totals.gross)}</div></div>
        <div className="swiss-card p-3"><div className="overline">Received</div><div className="num font-bold text-xl value-positive">{inr(totals.received)}</div></div>
        <div className="swiss-card p-3"><div className="overline">Pending</div><div className="num font-bold text-xl value-negative">{inr(totals.gross - totals.received)}</div></div>
      </div>

      <div className="flex justify-between items-center">
        <div>
          <div className="font-heading font-bold text-lg flex items-center gap-2"><Utensils size={16} className="text-[var(--brand)]" /> Monthly Fooding Entries</div>
          <div className="overline text-xs">Mandays × Boarding cost · split by partner_share_percent ({batch.partner_share_percent || 0}%) · no TDS</div>
        </div>
        {canEdit && !batch.closed && (
          <Button onClick={openNew} className="brand-btn rounded-none gap-1" data-testid="btn-new-fooding"><Plus size={14} /> Add Month</Button>
        )}
      </div>

      <div className="swiss-card overflow-x-auto" data-testid="fooding-table">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
            <th className="text-left p-3">Month</th>
            <th className="text-right p-3">Mandays</th>
            <th className="text-right p-3">Cost/Manday</th>
            <th className="text-right p-3">Gross</th>
            <th className="text-left p-3">Status</th>
            <th className="text-left p-3">Received</th>
            <th className="text-right p-3">Actions</th>
          </tr></thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 overline">No fooding entries yet. Click <em>Add Month</em> to start.</td></tr>
            ) : entries.map((e) => (
              <tr key={e.id} className="border-b border-[var(--border)] last:border-0" data-testid={`fooding-row-${e.id}`}>
                <td className="p-3 font-medium">{monthLabel(e.month)}</td>
                <td className="p-3 num text-right">{(e.mandays_claimed || 0).toLocaleString("en-IN")}</td>
                <td className="p-3 num text-right">{inr(e.boarding_cost_per_manday)}</td>
                <td className="p-3 num text-right font-medium">{inr(e.gross_amount)}</td>
                <td className="p-3 overline text-xs">
                  {e.status === "received" ? <span className="text-[var(--success)]">Received</span> : <span className="text-[var(--muted)]">Pending</span>}
                </td>
                <td className="p-3 num">{e.received_date || "—"}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  {e.status !== "received" && canReceive && (
                    <Button size="sm" onClick={() => openReceive(e)} className="brand-btn rounded-none gap-1 h-8 mr-1" data-testid={`btn-recv-fooding-${e.id}`}><Check size={12} /> Receive</Button>
                  )}
                  {canEdit && e.status !== "received" && (
                    <Button variant="outline" size="sm" onClick={() => openEdit(e)} className="rounded-none h-8 w-8 p-0 mr-1" data-testid={`btn-edit-fooding-${e.id}`}><Pencil size={12} /></Button>
                  )}
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={() => remove(e)} className="rounded-none h-8 w-8 p-0 hover:text-[var(--danger)]" data-testid={`btn-del-fooding-${e.id}`}><Trash2 size={12} /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-heading">{editing ? "Edit Fooding Entry" : "New Fooding Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Month <span className="text-[var(--danger)]">*</span></Label>
              <Input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} className="rounded-none" data-testid="fooding-month" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mandays Claimed</Label>
                <div className="flex gap-2">
                  <Input type="number" min="0" step="1" value={form.mandays_claimed} onChange={(e) => setForm({ ...form, mandays_claimed: e.target.value })} className="rounded-none num" data-testid="fooding-mandays" />
                  <Button type="button" variant="outline" size="icon" onClick={suggestMandays} title="Auto-suggest from HRMS attendance" className="rounded-none shrink-0" data-testid="fooding-suggest">
                    <Sparkles size={14} />
                  </Button>
                </div>
                <div className="overline text-[10px] text-[var(--muted)] mt-1">Click ✨ to fetch from HRMS attendance for this center.</div>
              </div>
              <div>
                <Label>Boarding Cost / Manday (₹)</Label>
                <Input type="number" min="0" step="0.01" value={form.boarding_cost_per_manday} onChange={(e) => setForm({ ...form, boarding_cost_per_manday: e.target.value })} className="rounded-none num" data-testid="fooding-cost" />
              </div>
            </div>
            <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-2 text-sm flex justify-between items-center">
              <span className="overline">Gross (auto)</span>
              <span className="num font-bold text-lg">{inr(formGross)}</span>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={save} className="brand-btn rounded-none" data-testid="fooding-save">{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog open={recvOpen} onOpenChange={setRecvOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-heading">Mark Fooding {recvTarget ? monthLabel(recvTarget.month) : ""} as Received</DialogTitle>
          </DialogHeader>
          {recvTarget && (
            <div className="space-y-3">
              <div className="border border-[var(--border)] p-3 bg-gray-50 space-y-1 text-sm">
                <div className="flex justify-between"><span className="overline">Mandays</span><span className="num">{(recvTarget.mandays_claimed || 0).toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span className="overline">Cost / Manday</span><span className="num">{inr(recvTarget.boarding_cost_per_manday)}</span></div>
                <div className="flex justify-between border-t border-[var(--border)] pt-1 mt-1"><span className="overline">Gross</span><span className="num font-bold value-positive">{inr(recvTarget.gross_amount)}</span></div>
              </div>
              <div>
                <Label>Company (Income credited under)</Label>
                <Select value={recvCompanyId || "__none__"} onValueChange={(v) => setRecvCompanyId(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="rounded-none" data-testid="fooding-recv-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(batch.partner_ids || []).length > 0 && (batch.partner_share_percent || 0) > 0 && (
                <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-2 text-xs">
                  Split: Company {(100 - (batch.partner_share_percent || 0)).toFixed(2)}% · Partners ({(batch.partner_ids || []).length}) {batch.partner_share_percent}% equally
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecvOpen(false)} className="rounded-none" disabled={recvBusy}>Cancel</Button>
            <Button onClick={confirmReceive} disabled={recvBusy} className={`brand-btn rounded-none gap-1 ${recvBusy ? "opacity-60 cursor-not-allowed" : ""}`} data-testid="fooding-recv-confirm"><Check size={14} /> {recvBusy ? "Processing…" : "Confirm Receive"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

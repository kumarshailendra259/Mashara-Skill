import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Percent, Plus, Pencil, Trash2, Info } from "lucide-react";
import { toast } from "sonner";

const BLANK = { label: "", fy_from: "", fy_to: "9999", rates: { I: 0, II: 0, III: 0 } };

export default function RateConfig() {
  const [slabs, setSlabs] = useState([]);
  const [lwe, setLwe] = useState(1.1);
  const [cats, setCats] = useState(["I", "II", "III"]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/work-order/rate-config");
      setSlabs(r.data.slabs || []);
      setLwe(r.data.lwe_multiplier || 1.1);
      setCats(r.data.categories || ["I", "II", "III"]);
    } catch { toast.error("Failed to load rate config"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing(null); setF({ ...BLANK, rates: { I: 0, II: 0, III: 0 } }); setOpen(true); };
  const openEdit = (s) => { setEditing(s); setF({ label: s.label, fy_from: String(s.fy_from), fy_to: String(s.fy_to ?? 9999), rates: { ...s.rates } }); setOpen(true); };

  const setRate = (cat, v) => setF((s) => ({ ...s, rates: { ...s.rates, [cat]: v } }));

  const save = async () => {
    if (!f.label.trim()) { toast.error("Label zaroori hai"); return; }
    setSaving(true);
    try {
      const payload = {
        label: f.label.trim(),
        fy_from: Number(f.fy_from),
        fy_to: Number(f.fy_to) || 9999,
        rates: Object.fromEntries(cats.map((c) => [c, Number(f.rates[c]) || 0])),
      };
      if (editing) await api.patch(`/work-order/rate-config/${editing.id}`, payload);
      else await api.post("/work-order/rate-config", payload);
      toast.success(editing ? "Slab updated" : "Slab added");
      setOpen(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to save"); }
    finally { setSaving(false); }
  };

  const del = async (s) => {
    if (!window.confirm(`Delete rate slab "${s.label}"? Existing records keep their computed rates.`)) return;
    try { await api.delete(`/work-order/rate-config/${s.id}`); toast.success("Slab deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed to delete"); }
  };

  return (
    <div className="p-4 md:p-6 space-y-5" data-testid="rate-config-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-md bg-[var(--brand-soft)] text-[var(--brand)] flex items-center justify-center"><Percent size={18} /></div>
          <div>
            <h1 className="text-xl font-heading font-bold">Rate Configuration</h1>
            <p className="text-xs text-[var(--muted)]">FY-wise per-hour base rates by Category. Used by Work Order & Batch rate engine.</p>
          </div>
        </div>
        <Button className="brand-btn" onClick={openAdd} data-testid="rc-add-btn"><Plus size={15} /> Add FY Slab</Button>
      </div>

      <div className="swiss-card p-3 flex items-center gap-2 text-xs text-[var(--muted)]">
        <Info size={14} className="text-[var(--brand)]" />
        <span>LWE (Left Wing Extremism) districts get a <b className="text-[var(--brand)]">×{lwe}</b> multiplier on the base rate automatically. A given Financial Year must map to exactly one slab (ranges cannot overlap).</span>
      </div>

      <div className="swiss-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slab Label</TableHead>
              <TableHead className="text-center">FY From</TableHead>
              <TableHead className="text-center">FY To</TableHead>
              {cats.map((c) => <TableHead key={c} className="text-right">Category {c} (₹/hr)</TableHead>)}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={4 + cats.length} className="text-center py-8 text-[var(--muted)]">Loading…</TableCell></TableRow>}
            {!loading && slabs.length === 0 && <TableRow><TableCell colSpan={4 + cats.length} className="text-center py-8 text-[var(--muted)]">No slabs configured.</TableCell></TableRow>}
            {slabs.map((s) => (
              <TableRow key={s.id} data-testid={`rc-row-${s.id}`}>
                <TableCell className="font-medium">{s.label}</TableCell>
                <TableCell className="text-center num">{s.fy_from}</TableCell>
                <TableCell className="text-center num">{s.fy_to >= 9999 ? "∞" : s.fy_to}</TableCell>
                {cats.map((c) => <TableCell key={c} className="text-right num font-semibold">₹{Number(s.rates?.[c] || 0).toFixed(2)}</TableCell>)}
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)} title="Edit" data-testid={`rc-edit-${s.id}`}><Pencil size={13} /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-600" onClick={() => del(s)} title="Delete" data-testid={`rc-del-${s.id}`}><Trash2 size={13} /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="rc-form">
          <DialogHeader>
            <DialogTitle className="font-heading">{editing ? "Edit FY Slab" : "Add FY Slab"}</DialogTitle>
            <DialogDescription>Per-hour base rate per Category for a Financial Year range.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="overline">Slab Label *</Label>
              <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. 2027-28 & later" data-testid="rc-inp-label" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="overline">FY From (year)</Label>
                <Input type="number" value={f.fy_from} onChange={(e) => setF({ ...f, fy_from: e.target.value })} placeholder="2027" data-testid="rc-inp-from" /></div>
              <div><Label className="overline">FY To (year, 9999 = onwards)</Label>
                <Input type="number" value={f.fy_to} onChange={(e) => setF({ ...f, fy_to: e.target.value })} placeholder="9999" data-testid="rc-inp-to" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {cats.map((c) => (
                <div key={c}><Label className="overline">Cat {c} ₹/hr</Label>
                  <Input type="number" value={f.rates[c] ?? 0} onChange={(e) => setRate(c, e.target.value)} data-testid={`rc-inp-rate-${c}`} /></div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="brand-btn" data-testid="rc-save-btn">{saving ? "Saving…" : (editing ? "Update" : "Add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

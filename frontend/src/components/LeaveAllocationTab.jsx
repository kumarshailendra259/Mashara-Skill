import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Wallet, Plus, Pencil, Trash2, Send, RefreshCw } from "lucide-react";

// HR Settings → Leave Allocation tab.
// Two sub-sections:
//   1. Leave Types (CRUD): CL, SL, PL, COMP, LWP + custom
//   2. Allocate balances: pick type + year + days + scope (all / center / individual staff)
//      then a table of current balances with quick adjust.

const COLOR_OPTS = ["blue", "emerald", "amber", "purple", "rose", "indigo", "teal"];
const BADGE_HUE = {
  blue: "bg-blue-50 text-[var(--brand)] border-blue-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
};

export default function LeaveAllocationTab() {
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [staff, setStaff] = useState([]);
  const [centers, setCenters] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  // Leave Type CRUD dialog
  const [typeDialog, setTypeDialog] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [typeForm, setTypeForm] = useState(blankTypeForm());

  // Allocate dialog
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocForm, setAllocForm] = useState(blankAllocForm());

  // Adjust balance dialog
  const [adjustOpen, setAdjustOpen] = useState(null); // balance row
  const [adjustForm, setAdjustForm] = useState({ delta_allocated: 0, delta_used: 0, remarks: "" });

  const load = async () => {
    setLoading(true);
    try {
      const [t, b, s, c] = await Promise.all([
        api.get("/leave-types"),
        api.get(`/leave-balances?year=${year}`),
        api.get("/staff"),
        api.get("/entities/center"),
      ]);
      setTypes(t.data || []);
      setBalances(b.data || []);
      setStaff(s.data || []);
      setCenters(c.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [year]);

  const typeById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types]);
  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const centerName = (id) => centers.find((c) => c.id === id)?.name || "—";

  // --- Leave Type CRUD ---
  const openNewType = () => { setEditingType(null); setTypeForm(blankTypeForm()); setTypeDialog(true); };
  const openEditType = (t) => { setEditingType(t.id); setTypeForm({ ...t }); setTypeDialog(true); };
  const saveType = async () => {
    if (!typeForm.name?.trim() || !typeForm.code?.trim()) {
      toast.error("Name and code are required"); return;
    }
    try {
      const payload = {
        name: typeForm.name.trim(),
        code: typeForm.code.trim().toUpperCase(),
        annual_quota: Number(typeForm.annual_quota || 0),
        paid: !!typeForm.paid,
        carry_forward: !!typeForm.carry_forward,
        color: typeForm.color || "blue",
        active: typeForm.active !== false,
      };
      if (editingType) await api.put(`/leave-types/${editingType}`, payload);
      else await api.post("/leave-types", payload);
      toast.success(editingType ? "Updated" : "Created");
      setTypeDialog(false); load();
    } catch (e) { toast.error(formatError(e)); }
  };
  const deleteType = async (t) => {
    if (!window.confirm(`Delete leave type "${t.name}"? (Used balances will block deletion)`)) return;
    try { await api.delete(`/leave-types/${t.id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };

  // --- Allocate ---
  const openAllocate = () => {
    setAllocForm({ ...blankAllocForm(), year, leave_type_id: types[0]?.id || "" });
    setAllocOpen(true);
  };
  const submitAllocate = async () => {
    if (!allocForm.leave_type_id) { toast.error("Pick a leave type"); return; }
    if (!allocForm.days || Number(allocForm.days) < 0) { toast.error("Days must be ≥ 0"); return; }
    if (!allocForm.remarks || allocForm.remarks.length < 3) { toast.error("Remarks required (min 3 chars)"); return; }
    try {
      const payload = {
        leave_type_id: allocForm.leave_type_id,
        year: Number(allocForm.year),
        days: Number(allocForm.days),
        mode: allocForm.mode,
        remarks: allocForm.remarks,
        staff_ids: allocForm.scope === "individual" ? allocForm.staff_ids : [],
        center_id: allocForm.scope === "center" ? allocForm.center_id : null,
      };
      const r = await api.post("/leave-balances/allocate", payload);
      toast.success(`Allocated to ${r.data.updated} staff (${r.data.leave_type} · ${r.data.year})`);
      setAllocOpen(false); load();
    } catch (e) { toast.error(formatError(e)); }
  };

  // --- Adjust balance ---
  const submitAdjust = async () => {
    if (!adjustForm.remarks || adjustForm.remarks.length < 3) {
      toast.error("Remarks required (min 3 chars)"); return;
    }
    try {
      await api.patch(`/leave-balances/${adjustOpen.id}`, {
        delta_allocated: Number(adjustForm.delta_allocated || 0),
        delta_used: Number(adjustForm.delta_used || 0),
        remarks: adjustForm.remarks,
      });
      toast.success("Balance adjusted");
      setAdjustOpen(null); setAdjustForm({ delta_allocated: 0, delta_used: 0, remarks: "" });
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="leave-allocation-tab">
      {/* Header strip + Year picker */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="overline">Provisioning</div>
          <h2 className="font-heading font-black text-2xl mt-1 flex items-center gap-2">
            <Wallet size={20} className="text-[var(--brand)]" /> Leave Allocation
          </h2>
          <div className="text-xs text-[var(--muted)] mt-1">Define leave types (CL/SL/PL…) and allocate annual quotas to staff. Used days are auto-deducted on leave approval.</div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="overline text-xs">Year</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="rounded-none w-[100px]" data-testid="year-select"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-none">
              {yearOptions().map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={load} className="rounded-none gap-1" data-testid="btn-refresh-balances">
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </div>

      {/* Leave Types CRUD */}
      <div className="swiss-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="overline text-[var(--brand)]">Leave Types</div>
            <div className="text-xs text-[var(--muted)]">Codes like CL, SL, PL, COMP, LWP — used in the leave request form &amp; balances.</div>
          </div>
          <Button onClick={openNewType} className="brand-btn rounded-none gap-1" data-testid="btn-new-leave-type">
            <Plus size={14} /> Add Type
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {types.map((t) => (
            <div key={t.id} className="border border-[var(--border)] p-3 flex items-start gap-3" data-testid={`lt-card-${t.code}`}>
              <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border ${BADGE_HUE[t.color] || BADGE_HUE.blue}`}>{t.code}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-[var(--muted)] num">{t.annual_quota} days/yr · {t.paid ? "Paid" : "Unpaid"}{t.carry_forward ? " · CF" : ""}</div>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => openEditType(t)} className="text-[var(--muted)] hover:text-[var(--brand)]" data-testid={`btn-edit-lt-${t.code}`}><Pencil size={14} /></button>
                <button type="button" onClick={() => deleteType(t)} className="text-[var(--muted)] hover:text-[var(--danger)]" data-testid={`btn-del-lt-${t.code}`}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {types.length === 0 && (
            <div className="col-span-full overline text-center py-6">No leave types — add one above (defaults are auto-seeded after first load)</div>
          )}
        </div>
      </div>

      {/* Allocate + balances table */}
      <div className="swiss-card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="overline text-[var(--brand)]">Staff Balances · {year}</div>
            <div className="text-xs text-[var(--muted)]">Allocated, used and remaining days per staff per type for the selected year.</div>
          </div>
          <Button onClick={openAllocate} className="brand-btn rounded-none gap-1" data-testid="btn-allocate">
            <Send size={14} /> Allocate to Staff
          </Button>
        </div>
        {loading ? (
          <div className="overline text-center py-8">Loading…</div>
        ) : balances.length === 0 ? (
          <div className="overline text-center py-8">No balances for {year} yet — click <em>Allocate</em> to provision.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" data-testid="balances-table">
              <thead className="bg-gray-50">
                <tr>
                  <Th>Staff</Th><Th>Center</Th><Th>Type</Th><Th>Allocated</Th><Th>Used</Th><Th>Balance</Th><Th>Last Note</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => {
                  const s = staffById[b.staff_id];
                  const t = typeById[b.leave_type_id];
                  return (
                    <tr key={b.id} className="border-t border-[var(--border)]" data-testid={`bal-row-${b.id}`}>
                      <Td className="font-medium">{s?.name || b.staff_id.slice(0, 8)}<div className="text-xs text-[var(--muted)]">{s?.designation || ""}</div></Td>
                      <Td className="text-xs">{centerName(s?.center_id)}</Td>
                      <Td><span className={`inline-block px-2 py-0.5 text-[10px] font-bold border ${BADGE_HUE[t?.color] || BADGE_HUE.blue}`}>{b.leave_type_code}</span></Td>
                      <Td className="num font-medium">{b.allocated}</Td>
                      <Td className="num">{b.used}</Td>
                      <Td className="num font-bold value-positive">{b.balance}</Td>
                      <Td className="text-xs text-[var(--muted)] max-w-[200px] truncate">{b.last_remarks || "—"}</Td>
                      <Td>
                        <Button variant="outline" size="sm" className="rounded-none h-7 gap-1" onClick={() => { setAdjustOpen(b); setAdjustForm({ delta_allocated: 0, delta_used: 0, remarks: "" }); }} data-testid={`btn-adjust-${b.id}`}>
                          <Pencil size={12} /> Adjust
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Leave Type dialog ---- */}
      <Dialog open={typeDialog} onOpenChange={setTypeDialog}>
        <DialogContent className="rounded-none">
          <DialogHeader><DialogTitle className="font-heading">{editingType ? "Edit Leave Type" : "New Leave Type"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *"><Input value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} className="rounded-none" data-testid="lt-name" /></Field>
            <Field label="Code * (e.g. CL, SL)">
              <Input value={typeForm.code} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value.toUpperCase().slice(0, 10) })} className="rounded-none num font-bold" data-testid="lt-code" />
            </Field>
            <Field label="Annual Quota (days)">
              <Input type="number" step="0.5" value={typeForm.annual_quota} onChange={(e) => setTypeForm({ ...typeForm, annual_quota: e.target.value })} className="rounded-none num" data-testid="lt-quota" />
            </Field>
            <Field label="Color">
              <Select value={typeForm.color || "blue"} onValueChange={(v) => setTypeForm({ ...typeForm, color: v })}>
                <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-none">
                  {COLOR_OPTS.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className={`inline-block w-3 h-3 mr-2 ${BADGE_HUE[c]} border`}></span>{c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="col-span-1 flex items-center gap-2 text-sm mt-2">
              <Checkbox checked={!!typeForm.paid} onCheckedChange={(v) => setTypeForm({ ...typeForm, paid: !!v })} data-testid="lt-paid" />
              <span>Paid leave</span>
            </label>
            <label className="col-span-1 flex items-center gap-2 text-sm mt-2">
              <Checkbox checked={!!typeForm.carry_forward} onCheckedChange={(v) => setTypeForm({ ...typeForm, carry_forward: !!v })} data-testid="lt-cf" />
              <span>Carry-forward year-over-year</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypeDialog(false)} className="rounded-none">Cancel</Button>
            <Button onClick={saveType} className="brand-btn rounded-none" data-testid="btn-save-lt">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Allocate dialog ---- */}
      <Dialog open={allocOpen} onOpenChange={setAllocOpen}>
        <DialogContent className="rounded-none max-w-2xl">
          <DialogHeader><DialogTitle className="font-heading">Allocate Leave Days</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Leave Type *">
                <Select value={allocForm.leave_type_id} onValueChange={(v) => setAllocForm({ ...allocForm, leave_type_id: v })}>
                  <SelectTrigger className="rounded-none" data-testid="alloc-type"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="rounded-none">
                    {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.code} — {t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Year *">
                <Input type="number" min={2020} max={2100} value={allocForm.year} onChange={(e) => setAllocForm({ ...allocForm, year: e.target.value })} className="rounded-none num" />
              </Field>
              <Field label="Days *">
                <Input type="number" step="0.5" min={0} value={allocForm.days} onChange={(e) => setAllocForm({ ...allocForm, days: e.target.value })} className="rounded-none num" data-testid="alloc-days" />
              </Field>
              <Field label="Mode">
                <Select value={allocForm.mode} onValueChange={(v) => setAllocForm({ ...allocForm, mode: v })}>
                  <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-none">
                    <SelectItem value="set">Set (overwrite allocated)</SelectItem>
                    <SelectItem value="add">Add (increment allocated)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Scope *">
              <div className="flex gap-2 text-sm">
                {[
                  { v: "all",        label: "All Active Staff" },
                  { v: "center",     label: "By Center" },
                  { v: "individual", label: "Specific Staff" },
                ].map((s) => (
                  <label key={s.v} className={`flex-1 border p-2 cursor-pointer ${allocForm.scope === s.v ? "border-[var(--brand)] bg-blue-50" : "border-[var(--border)]"}`}>
                    <input type="radio" name="scope" checked={allocForm.scope === s.v} onChange={() => setAllocForm({ ...allocForm, scope: s.v })} className="mr-2" data-testid={`alloc-scope-${s.v}`} />
                    {s.label}
                  </label>
                ))}
              </div>
            </Field>
            {allocForm.scope === "center" && (
              <Field label="Center">
                <Select value={allocForm.center_id} onValueChange={(v) => setAllocForm({ ...allocForm, center_id: v })}>
                  <SelectTrigger className="rounded-none" data-testid="alloc-center"><SelectValue placeholder="Pick center" /></SelectTrigger>
                  <SelectContent className="rounded-none">
                    {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {allocForm.scope === "individual" && (
              <Field label="Pick Staff (multi-select)">
                <div className="max-h-[180px] overflow-y-auto border border-[var(--border)] p-2 space-y-1">
                  {staff.map((s) => {
                    const checked = allocForm.staff_ids.includes(s.id);
                    return (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={checked} onCheckedChange={(v) => {
                          setAllocForm((f) => ({
                            ...f,
                            staff_ids: v ? [...f.staff_ids, s.id] : f.staff_ids.filter((x) => x !== s.id),
                          }));
                        }} />
                        <span className="flex-1 truncate">{s.name} <span className="text-[var(--muted)]">· {s.designation || ""}</span></span>
                      </label>
                    );
                  })}
                  {staff.length === 0 && <div className="overline text-xs text-center py-3">No staff</div>}
                </div>
                <div className="text-xs text-[var(--muted)] mt-1">{allocForm.staff_ids.length} selected</div>
              </Field>
            )}
            <Field label="Remarks * (audit note)">
              <Textarea rows={2} value={allocForm.remarks} onChange={(e) => setAllocForm({ ...allocForm, remarks: e.target.value })} placeholder="e.g. FY26 opening balance" className="rounded-none" data-testid="alloc-remarks" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={submitAllocate} className="brand-btn rounded-none gap-1" data-testid="btn-submit-allocate">
              <Send size={14} /> Allocate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Adjust dialog ---- */}
      <Dialog open={!!adjustOpen} onOpenChange={(v) => !v && setAdjustOpen(null)}>
        <DialogContent className="rounded-none">
          <DialogHeader><DialogTitle className="font-heading">Adjust Balance</DialogTitle></DialogHeader>
          {adjustOpen && (
            <div className="space-y-3">
              <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-3 text-sm">
                <div className="font-medium">{staffById[adjustOpen.staff_id]?.name || adjustOpen.staff_id.slice(0, 8)}</div>
                <div className="text-xs num">
                  {adjustOpen.leave_type_code} · {adjustOpen.year} · Allocated <b>{adjustOpen.allocated}</b> · Used <b>{adjustOpen.used}</b> · Balance <b>{adjustOpen.balance}</b>
                </div>
              </div>
              <Field label="Delta Allocated (positive adds, negative reduces)">
                <Input type="number" step="0.5" value={adjustForm.delta_allocated} onChange={(e) => setAdjustForm({ ...adjustForm, delta_allocated: e.target.value })} className="rounded-none num" data-testid="adj-alloc" />
              </Field>
              <Field label="Delta Used (manual correction)">
                <Input type="number" step="0.5" value={adjustForm.delta_used} onChange={(e) => setAdjustForm({ ...adjustForm, delta_used: e.target.value })} className="rounded-none num" data-testid="adj-used" />
              </Field>
              <Field label="Remarks *">
                <Textarea rows={2} value={adjustForm.remarks} onChange={(e) => setAdjustForm({ ...adjustForm, remarks: e.target.value })} className="rounded-none" data-testid="adj-remarks" />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(null)} className="rounded-none">Cancel</Button>
            <Button onClick={submitAdjust} className="brand-btn rounded-none" data-testid="btn-save-adjust">Save Adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function blankTypeForm() {
  return { name: "", code: "", annual_quota: 0, paid: true, carry_forward: false, color: "blue", active: true };
}

function blankAllocForm() {
  return {
    leave_type_id: "", year: new Date().getFullYear(), days: 12, mode: "set",
    scope: "all", center_id: "", staff_ids: [], remarks: "",
  };
}

function yearOptions() {
  const cur = new Date().getFullYear();
  return [cur - 1, cur, cur + 1, cur + 2];
}

const Field = ({ label, children }) => (
  <div>
    <Label className="overline text-xs">{label}</Label>
    <div className="mt-1">{children}</div>
  </div>
);

const Th = ({ children }) => <th className="text-left px-3 py-2 overline text-xs whitespace-nowrap">{children}</th>;
const Td = ({ children, className }) => <td className={`px-3 py-2 ${className || ""}`}>{children}</td>;

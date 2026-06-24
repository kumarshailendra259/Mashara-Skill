import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Check, X, MapPin, Calendar, Clock, AlertCircle } from "lucide-react";
import PrintButton from "@/components/PrintButton";

export default function HrSettings() {
  const { user } = useAuth();
  const canEdit = ["admin", "hr"].includes(user?.role);

  if (!canEdit) {
    return <div className="swiss-card p-8 text-center"><div className="overline">Forbidden</div><p className="text-sm text-[var(--muted)] mt-2">Only Admin and HR can manage HR settings.</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="overline">Settings · HRMS</div>
          <h1 className="font-heading font-black text-4xl mt-1">HR Settings</h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">Manage holidays, geofences (check-in zones), shifts (timing &amp; penalty rules), and review attendance regularisation requests.</p>
        </div>
        <PrintButton title="HR Settings" />
      </div>

      <Tabs defaultValue="holidays">
        <TabsList className="rounded-none">
          <TabsTrigger value="holidays" data-testid="tab-holidays"><Calendar size={14} className="mr-2" /> Holidays</TabsTrigger>
          <TabsTrigger value="geofences" data-testid="tab-geofences"><MapPin size={14} className="mr-2" /> Geofences</TabsTrigger>
          <TabsTrigger value="shifts" data-testid="tab-shifts"><Clock size={14} className="mr-2" /> Shifts</TabsTrigger>
          <TabsTrigger value="regularisations" data-testid="tab-reg"><AlertCircle size={14} className="mr-2" /> Regularisations</TabsTrigger>
        </TabsList>

        <TabsContent value="holidays" className="mt-4"><HolidaysTab /></TabsContent>
        <TabsContent value="geofences" className="mt-4"><GeofencesTab /></TabsContent>
        <TabsContent value="shifts" className="mt-4"><ShiftsTab /></TabsContent>
        <TabsContent value="regularisations" className="mt-4"><RegularisationsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================================================ HOLIDAYS ============================================================ */
function HolidaysTab() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: "", name: "", type: "public", is_recurring: false });

  const load = async () => { try { const r = await api.get("/holidays"); setList(r.data || []); } catch (e) { toast.error(formatError(e)); } };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.date || !form.name.trim()) { toast.error("Date and name required"); return; }
    try { await api.post("/holidays", form); setOpen(false); setForm({ date: "", name: "", type: "public", is_recurring: false }); load(); toast.success("Added"); }
    catch (e) { toast.error(formatError(e)); }
  };
  const remove = async (h) => {
    if (!window.confirm(`Delete holiday "${h.name}"?`)) return;
    try { await api.delete(`/holidays/${h.id}`); load(); toast.success("Deleted"); } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="brand-btn rounded-none gap-2" data-testid="btn-new-holiday"><Plus size={16} /> Add Holiday</Button></DialogTrigger>
          <DialogContent className="rounded-none">
            <DialogHeader><DialogTitle className="font-heading">New Holiday</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-none" data-testid="hol-date" /></div>
              <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali" className="rounded-none" data-testid="hol-name" /></div>
              <div><Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="festival">Festival</SelectItem>
                    <SelectItem value="weekly_off">Weekly Off</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })} /> Recurring (every year)</label>
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button><Button onClick={save} className="brand-btn rounded-none" data-testid="hol-save">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="swiss-card overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
          <th className="text-left p-3">Date</th><th className="text-left p-3">Name</th><th className="text-left p-3">Type</th><th className="text-left p-3">Recurring</th><th className="text-right p-3 no-print">Actions</th>
        </tr></thead><tbody>
          {list.length === 0 ? <tr><td colSpan={5} className="text-center py-8 overline">No holidays yet</td></tr> : list.map((h) => (
            <tr key={h.id} className="border-b border-[var(--border)] hover:bg-gray-50">
              <td className="p-3 font-medium">{new Date(h.date).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</td>
              <td className="p-3">{h.name}</td>
              <td className="p-3 capitalize">{h.type}</td>
              <td className="p-3">{h.is_recurring ? "Yes" : "—"}</td>
              <td className="p-3 text-right no-print"><Button size="sm" variant="outline" onClick={() => remove(h)} className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50" data-testid={`hol-del-${h.id}`}><Trash2 size={14} /></Button></td>
            </tr>
          ))}
        </tbody></table></div>
    </div>
  );
}

/* ============================================================ GEOFENCES ============================================================ */
function GeofencesTab() {
  const [list, setList] = useState([]);
  const [centers, setCenters] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", center_id: "", latitude: "", longitude: "", radius_m: 200, active: true });

  const load = async () => {
    try {
      const [g, c] = await Promise.all([api.get("/geofences"), api.get("/entities/center")]);
      setList(g.data || []);
      setCenters(c.data || []);
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { load(); }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) })); toast.success("Location captured"); },
      (err) => toast.error(err.message || "Location denied"),
      { enableHighAccuracy: true },
    );
  };

  const save = async () => {
    const lat = parseFloat(form.latitude); const lng = parseFloat(form.longitude);
    if (!form.name.trim()) { toast.error("Name required"); return; }
    if (Number.isNaN(lat) || Number.isNaN(lng)) { toast.error("Valid lat/lng required"); return; }
    try {
      await api.post("/geofences", { name: form.name, center_id: form.center_id || null, latitude: lat, longitude: lng, radius_m: +form.radius_m || 200, active: form.active });
      setOpen(false); setForm({ name: "", center_id: "", latitude: "", longitude: "", radius_m: 200, active: true });
      load(); toast.success("Added");
    } catch (e) { toast.error(formatError(e)); }
  };
  const remove = async (g) => { if (!window.confirm(`Delete geofence "${g.name}"?`)) return; try { await api.delete(`/geofences/${g.id}`); load(); toast.success("Deleted"); } catch (e) { toast.error(formatError(e)); } };

  const cName = (cid) => centers.find((c) => c.id === cid)?.name || "Global";

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="brand-btn rounded-none gap-2" data-testid="btn-new-fence"><Plus size={16} /> Add Geofence</Button></DialogTrigger>
          <DialogContent className="rounded-none">
            <DialogHeader><DialogTitle className="font-heading">New Geofence</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mumbai Office" className="rounded-none" data-testid="fence-name" /></div>
              <div className="col-span-2"><Label>Center (scope)</Label>
                <Select value={form.center_id || "__global"} onValueChange={(v) => setForm({ ...form, center_id: v === "__global" ? "" : v })}>
                  <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__global">Global (all centers)</SelectItem>
                    {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Latitude</Label><Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="19.076" className="rounded-none" data-testid="fence-lat" /></div>
              <div><Label>Longitude</Label><Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="72.8777" className="rounded-none" data-testid="fence-lng" /></div>
              <div className="col-span-2"><Button variant="outline" onClick={useMyLocation} className="rounded-none w-full gap-2"><MapPin size={14} /> Use my current location</Button></div>
              <div><Label>Radius (metres)</Label><Input type="number" value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: e.target.value })} className="rounded-none" data-testid="fence-radius" /></div>
              <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button><Button onClick={save} className="brand-btn rounded-none" data-testid="fence-save">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="swiss-card overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
          <th className="text-left p-3">Name</th><th className="text-left p-3">Center</th><th className="text-left p-3">Coordinates</th><th className="text-right p-3">Radius</th><th className="text-left p-3">Active</th><th className="text-right p-3 no-print">Actions</th>
        </tr></thead><tbody>
          {list.length === 0 ? <tr><td colSpan={6} className="text-center py-8 overline">No geofences yet</td></tr> : list.map((g) => (
            <tr key={g.id} className="border-b border-[var(--border)] hover:bg-gray-50">
              <td className="p-3 font-medium">{g.name}</td>
              <td className="p-3">{cName(g.center_id)}</td>
              <td className="p-3 text-xs"><a href={`https://www.google.com/maps?q=${g.latitude},${g.longitude}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline">{g.latitude.toFixed(4)}, {g.longitude.toFixed(4)}</a></td>
              <td className="p-3 num">{g.radius_m} m</td>
              <td className="p-3">{g.active ? <span className="text-[var(--success)] font-medium">Yes</span> : "—"}</td>
              <td className="p-3 text-right no-print"><Button size="sm" variant="outline" onClick={() => remove(g)} className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50"><Trash2 size={14} /></Button></td>
            </tr>
          ))}
        </tbody></table></div>
    </div>
  );
}

/* ============================================================ SHIFTS ============================================================ */
function ShiftsTab() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const empty = { name: "", start_time: "09:00", end_time: "18:00", grace_minutes: 10, late_penalty_per_hour: 0, half_day_after_minutes: 120, min_hours_for_present: 4, active: true };
  const [form, setForm] = useState(empty);

  const load = async () => { try { const r = await api.get("/shifts"); setList(r.data || []); } catch (e) { toast.error(formatError(e)); } };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditingId(null); setForm(empty); setOpen(true); };
  const openEdit = (s) => { setEditingId(s.id); setForm({ ...empty, ...s }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim() || !form.start_time || !form.end_time) { toast.error("Name + start/end required"); return; }
    try {
      const payload = {
        name: form.name, start_time: form.start_time, end_time: form.end_time,
        grace_minutes: +form.grace_minutes || 0, late_penalty_per_hour: +form.late_penalty_per_hour || 0,
        half_day_after_minutes: +form.half_day_after_minutes || 0, min_hours_for_present: +form.min_hours_for_present || 0,
        active: !!form.active,
      };
      if (editingId) await api.put(`/shifts/${editingId}`, payload); else await api.post("/shifts", payload);
      setOpen(false); load(); toast.success(editingId ? "Updated" : "Added");
    } catch (e) { toast.error(formatError(e)); }
  };
  const remove = async (s) => { if (!window.confirm(`Delete shift "${s.name}"? Staff assigned will be unlinked.`)) return; try { await api.delete(`/shifts/${s.id}`); load(); toast.success("Deleted"); } catch (e) { toast.error(formatError(e)); } };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditingId(null); } }}>
          <DialogTrigger asChild><Button onClick={openAdd} className="brand-btn rounded-none gap-2" data-testid="btn-new-shift"><Plus size={16} /> Add Shift</Button></DialogTrigger>
          <DialogContent className="rounded-none max-w-2xl">
            <DialogHeader><DialogTitle className="font-heading">{editingId ? "Edit Shift" : "New Shift"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Day Shift" className="rounded-none" data-testid="shift-name" /></div>
              <div><Label>Start Time</Label><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="rounded-none" data-testid="shift-start" /></div>
              <div><Label>End Time</Label><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="rounded-none" data-testid="shift-end" /></div>
              <div><Label>Grace Minutes</Label><Input type="number" value={form.grace_minutes} onChange={(e) => setForm({ ...form, grace_minutes: e.target.value })} className="rounded-none" /><div className="text-[10px] text-[var(--muted)] mt-1">Free buffer after start_time before counting late</div></div>
              <div><Label>Late Penalty / hour (₹)</Label><Input type="number" value={form.late_penalty_per_hour} onChange={(e) => setForm({ ...form, late_penalty_per_hour: e.target.value })} className="rounded-none" /><div className="text-[10px] text-[var(--muted)] mt-1">Deducted from payroll per hour late</div></div>
              <div><Label>Half-day after (min)</Label><Input type="number" value={form.half_day_after_minutes} onChange={(e) => setForm({ ...form, half_day_after_minutes: e.target.value })} className="rounded-none" /><div className="text-[10px] text-[var(--muted)] mt-1">Late by &gt; this → status = half</div></div>
              <div><Label>Min hours for Present</Label><Input type="number" step="0.5" value={form.min_hours_for_present} onChange={(e) => setForm({ ...form, min_hours_for_present: e.target.value })} className="rounded-none" /><div className="text-[10px] text-[var(--muted)] mt-1">Punched duration &lt; this → half-day</div></div>
              <div className="col-span-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button><Button onClick={save} className="brand-btn rounded-none" data-testid="shift-save">{editingId ? "Update" : "Save"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="swiss-card overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
          <th className="text-left p-3">Name</th><th className="text-left p-3">Timing</th><th className="text-right p-3">Grace</th><th className="text-right p-3">Penalty/hr</th><th className="text-right p-3">Half-day after</th><th className="text-left p-3">Active</th><th className="text-right p-3 no-print">Actions</th>
        </tr></thead><tbody>
          {list.length === 0 ? <tr><td colSpan={7} className="text-center py-8 overline">No shifts yet</td></tr> : list.map((s) => (
            <tr key={s.id} className="border-b border-[var(--border)] hover:bg-gray-50">
              <td className="p-3 font-medium">{s.name}</td>
              <td className="p-3">{s.start_time} → {s.end_time}</td>
              <td className="p-3 num">{s.grace_minutes} min</td>
              <td className="p-3 num">₹{s.late_penalty_per_hour || 0}</td>
              <td className="p-3 num">{s.half_day_after_minutes} min</td>
              <td className="p-3">{s.active ? <span className="text-[var(--success)] font-medium">Yes</span> : "—"}</td>
              <td className="p-3 text-right no-print">
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="outline" onClick={() => openEdit(s)} className="rounded-none h-8 px-2"><Pencil size={14} /></Button>
                  <Button size="sm" variant="outline" onClick={() => remove(s)} className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50"><Trash2 size={14} /></Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody></table></div>
    </div>
  );
}

/* ============================================================ REGULARISATIONS ============================================================ */
function RegularisationsTab() {
  const [list, setList] = useState([]);

  const load = async () => { try { const r = await api.get("/regularisations"); setList(r.data || []); } catch (e) { toast.error(formatError(e)); } };
  useEffect(() => { load(); }, []);

  const decide = async (rid, decision) => {
    const remarks = decision === "rejected" ? (window.prompt("Reason for rejection?") || "") : "";
    try { await api.patch(`/regularisations/${rid}?decision=${decision}&remarks=${encodeURIComponent(remarks)}`); load(); toast.success(decision); }
    catch (e) { toast.error(formatError(e)); }
  };

  const pending = list.filter((r) => r.status === "pending");
  const decided = list.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-4">
      <div className="swiss-card overflow-x-auto">
        <div className="px-3 pt-3 overline">Pending ({pending.length})</div>
        <table className="w-full text-sm mt-2">
          <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
            <th className="text-left p-3">Staff</th><th className="text-left p-3">Date</th><th className="text-left p-3">Requested Status</th><th className="text-left p-3">Reason</th><th className="text-right p-3 no-print">Action</th>
          </tr></thead><tbody>
            {pending.length === 0 ? <tr><td colSpan={5} className="text-center py-8 overline">No pending requests</td></tr> : pending.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                <td className="p-3 font-medium">{r.staff_name}</td>
                <td className="p-3">{new Date(r.date).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}</td>
                <td className="p-3 capitalize">{r.status}</td>
                <td className="p-3">{r.reason}</td>
                <td className="p-3 text-right no-print">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" onClick={() => decide(r.id, "approved")} className="brand-btn rounded-none h-8 px-2 gap-1" data-testid={`reg-approve-${r.id}`}><Check size={14} /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => decide(r.id, "rejected")} className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50" data-testid={`reg-reject-${r.id}`}><X size={14} /> Reject</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {decided.length > 0 && (
        <div className="swiss-card overflow-x-auto">
          <div className="px-3 pt-3 overline">History</div>
          <table className="w-full text-sm mt-2">
            <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3">Staff</th><th className="text-left p-3">Date</th><th className="text-left p-3">Status</th><th className="text-left p-3">Reason</th><th className="text-left p-3">Remarks</th>
            </tr></thead><tbody>
              {decided.slice(0, 50).map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                  <td className="p-3 font-medium">{r.staff_name}</td>
                  <td className="p-3">{new Date(r.date).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</td>
                  <td className="p-3"><span className={`text-xs uppercase font-bold px-2 py-1 ${r.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{r.status}</span></td>
                  <td className="p-3 text-xs">{r.reason}</td>
                  <td className="p-3 text-xs">{r.decision_remarks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

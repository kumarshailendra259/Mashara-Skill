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
import { Plus, Trash2, Pencil, Check, X, MapPin, Calendar, Clock, AlertCircle, Wallet, FileText, Megaphone, Receipt } from "lucide-react";
import PrintButton from "@/components/PrintButton";
import LeaveAllocationTab from "@/components/LeaveAllocationTab";
import MapPicker from "@/components/MapPicker";
import OfferLetterTemplatesTab from "@/components/OfferLetterTemplatesTab";
import SalarySlipTemplatesTab from "@/components/SalarySlipTemplatesTab";

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
        <PrintButton title="HRD Settings" />
      </div>

      <Tabs defaultValue="holidays">
        <TabsList className="rounded-none">
          <TabsTrigger value="holidays" data-testid="tab-holidays"><Calendar size={14} className="mr-2" /> Holidays</TabsTrigger>
          <TabsTrigger value="announcements" data-testid="tab-announcements"><Megaphone size={14} className="mr-2" /> Announcements</TabsTrigger>
          <TabsTrigger value="leave_allocation" data-testid="tab-leave-allocation"><Wallet size={14} className="mr-2" /> Leave Allocation</TabsTrigger>
          <TabsTrigger value="geofences" data-testid="tab-geofences"><MapPin size={14} className="mr-2" /> Geofences</TabsTrigger>
          <TabsTrigger value="shifts" data-testid="tab-shifts"><Clock size={14} className="mr-2" /> Shifts</TabsTrigger>
          <TabsTrigger value="offer_letters" data-testid="tab-offer-letters"><FileText size={14} className="mr-2" /> Offer Letters</TabsTrigger>
          <TabsTrigger value="salary_slips" data-testid="tab-salary-slips"><Receipt size={14} className="mr-2" /> Salary Slips</TabsTrigger>
        </TabsList>

        <TabsContent value="holidays" className="mt-4"><HolidaysTab /></TabsContent>
        <TabsContent value="announcements" className="mt-4"><AnnouncementsTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="leave_allocation" className="mt-4"><LeaveAllocationTab /></TabsContent>
        <TabsContent value="geofences" className="mt-4"><GeofencesTab /></TabsContent>
        <TabsContent value="shifts" className="mt-4"><ShiftsTab /></TabsContent>
        <TabsContent value="offer_letters" className="mt-4"><OfferLetterTemplatesTab /></TabsContent>
        <TabsContent value="salary_slips" className="mt-4"><SalarySlipTemplatesTab /></TabsContent>
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
  // Phase 36 — address search state
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);

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

  /**
   * Phase 36 — Address search via OpenStreetMap Nominatim (same free geocoder
   * already used elsewhere in the app). Returns up to 6 suggestions; user picks
   * one and lat/lng snaps to that place. `countrycodes=in` biases results to
   * India so "Ranchi Head Office" doesn't jump to a US result.
   */
  const runSearch = async (q) => {
    const query = (q ?? searchQ).trim();
    if (!query) { setSearchResults([]); return; }
    setSearchBusy(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=in&q=${encodeURIComponent(query)}`;
      const r = await fetch(url, { headers: { "Accept-Language": "en" } });
      const data = await r.json();
      setSearchResults(Array.isArray(data) ? data : []);
      if ((data || []).length === 0) toast.info("No matches — try a landmark, PIN code, or full address");
    } catch (e) {
      toast.error("Search failed — check your internet");
    } finally { setSearchBusy(false); }
  };
  const pickResult = (r) => {
    const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    setForm((f) => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
    setSearchResults([]);
    setSearchQ(r.display_name.slice(0, 60));
    toast.success("Location placed on map");
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
          <DialogContent className="rounded-none max-w-2xl">
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
              <div className="col-span-2">
                <Label className="flex items-center justify-between">
                  <span>Map (click anywhere or <b>drag the marker</b>)</span>
                  <button type="button" onClick={useMyLocation} className="text-xs text-[var(--brand)] hover:underline inline-flex items-center gap-1" data-testid="fence-use-loc"><MapPin size={12} /> Use my location</button>
                </Label>
                {/* Phase 36 — Address search bar */}
                <div className="relative mt-2">
                  <div className="flex gap-2">
                    <Input
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
                      placeholder="Search location — e.g. Ranchi Head Office, PIN 834001, Mumbai railway station"
                      className="rounded-none"
                      data-testid="fence-search-input"
                    />
                    <Button
                      type="button"
                      onClick={() => runSearch()}
                      disabled={searchBusy || !searchQ.trim()}
                      variant="outline"
                      className="rounded-none whitespace-nowrap gap-1"
                      data-testid="fence-search-btn"
                    >
                      {searchBusy ? "Searching…" : "Search"}
                    </Button>
                  </div>
                  {searchResults.length > 0 && (
                    <div
                      className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[var(--border)] shadow-lg max-h-60 overflow-y-auto"
                      data-testid="fence-search-results"
                    >
                      {searchResults.map((r, idx) => (
                        <button
                          type="button"
                          key={`${r.place_id}-${idx}`}
                          onClick={() => pickResult(r)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-[var(--border)] last:border-0"
                          data-testid={`fence-search-result-${idx}`}
                        >
                          <div className="font-medium truncate">{r.display_name}</div>
                          <div className="text-[10px] text-[var(--muted)] font-mono">
                            {parseFloat(r.lat).toFixed(5)}, {parseFloat(r.lon).toFixed(5)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-2">
                  <MapPicker
                    value={{ lat: form.latitude, lng: form.longitude }}
                    onChange={(p) => setForm((f) => ({ ...f, latitude: p.lat.toFixed(6), longitude: p.lng.toFixed(6) }))}
                    radiusM={Number(form.radius_m) || 0}
                    height={300}
                  />
                </div>
                <div className="text-xs text-[var(--muted)] mt-1">Tip: search karo, ya map pe click karo, phir marker drag karke exact location fix karo. Circle radius preview dikha raha hai.</div>
              </div>
              <div><Label>Latitude</Label><Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="19.076" className="rounded-none num" data-testid="fence-lat" /></div>
              <div><Label>Longitude</Label><Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="72.8777" className="rounded-none num" data-testid="fence-lng" /></div>
              <div><Label>Radius (metres)</Label><Input type="number" value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: e.target.value })} className="rounded-none num" data-testid="fence-radius" /></div>
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


// ---------------- Announcements tab ----------------
function AnnouncementsTab({ canEdit }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ title: "", body: "", priority: "info", expires_at: "" });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/announcements/active");
      setItems(data || []);
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast.error("Title aur body dono zaruri hain");
      return;
    }
    setBusy(true);
    try {
      await api.post("/announcements", {
        title: form.title.trim(),
        body: form.body.trim(),
        priority: form.priority,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      });
      toast.success("Announcement broadcast — sabhi dashboards pe blink hoga");
      setForm({ title: "", body: "", priority: "info", expires_at: "" });
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete announcement "${a.title}"?`)) return;
    try { await api.delete(`/announcements/${a.id}`); load(); toast.success("Deleted"); }
    catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="swiss-card p-4 space-y-3">
          <div className="overline font-heading font-bold">New Announcement</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="overline">Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Diwali holiday schedule" className="rounded-none" data-testid="ann-title" />
            </div>
            <div>
              <Label className="overline">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger className="rounded-none" data-testid="ann-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info (blue)</SelectItem>
                  <SelectItem value="important">Important (amber)</SelectItem>
                  <SelectItem value="urgent">Urgent (red)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="overline">Body *</Label>
              <Textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Full message that will show on every dashboard until dismissed" className="rounded-none" data-testid="ann-body" />
            </div>
            <div>
              <Label className="overline">Expires at (optional)</Label>
              <Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} className="rounded-none" data-testid="ann-expires" />
              <div className="text-[10px] text-[var(--muted)] mt-1">Blank rahe toh forever active rahega jab tak manual delete na ho.</div>
            </div>
            <div className="flex items-end">
              <Button onClick={create} disabled={busy} className="brand-btn rounded-none gap-1" data-testid="ann-create">
                <Megaphone size={14} /> {busy ? "Broadcasting…" : "Broadcast Announcement"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="swiss-card p-0 overflow-hidden">
        <div className="px-4 pt-4 overline">Active announcements ({items.length})</div>
        {items.length === 0 ? (
          <div className="p-8 text-center overline text-sm">No active announcements</div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((a) => {
              const priCls = a.priority === "urgent" ? "bg-red-50 text-red-800 border-red-200"
                : a.priority === "important" ? "bg-amber-50 text-amber-800 border-amber-200"
                : "bg-blue-50 text-blue-800 border-blue-200";
              return (
              <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                <span className={`text-[10px] font-bold uppercase border px-1.5 py-0.5 ${priCls}`}>{a.priority}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-[var(--muted)] mt-0.5">{a.body}</div>
                  <div className="text-[10px] overline mt-1">
                    by {a.created_by_name} · {new Date(a.created_at).toLocaleString()}
                    {a.expires_at && <> · expires {new Date(a.expires_at).toLocaleDateString()}</>}
                    · <span className="text-emerald-700">{(a.read_by || []).length} read</span>
                  </div>
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => remove(a)} className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50" data-testid={`ann-delete-${a.id}`}><Trash2 size={14} /></Button>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}


import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
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
import {
  Plus, Trash2, Edit3, Eye, Download, Route as RouteIcon, MapPin,
  Camera, X, Users, Calendar,
} from "lucide-react";

/**
 * Daily Mobilization Report (Phase 4)
 * -------------------------------------
 * One report per (branch, mobilizer, date). Contains up to 5 locations, each
 * with GPS coordinates and optional photo (base64 for now — object storage
 * integration coming later).
 */

const num = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("en-IN");
const todayISO = () => new Date().toISOString().slice(0, 10);
const EMPTY_LOC = { area_name: "", distance_km: "", mobilisation: "", lat: null, lng: null, photo_data_url: null, notes: "" };
const EMPTY = {
  branch: "", project: "", report_date: todayISO(),
  mobilizer_name: "", mobilizer_emp_id: "", mobilizer_contact: "", remarks: "",
  locations: [{ ...EMPTY_LOC }],
};

async function fileToBase64(file, maxKB = 400) {
  if (!file) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error("Photo must be ≤ 5MB");
  // Downscale via canvas to keep payload small (base64 in Mongo is fine for MVP)
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const maxW = 1024;
    const scale = Math.min(1, maxW / img.width);
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    let q = 0.85;
    let dataUrl = canvas.toDataURL("image/jpeg", q);
    while (dataUrl.length / 1024 > maxKB && q > 0.3) {
      q -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", q);
    }
    return dataUrl;
  } finally { URL.revokeObjectURL(url); }
}

export default function MobilizationTab({ canWrite, onChange }) {
  const [rows, setRows] = useState([]);
  const [rollups, setRollups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [branchF, setBranchF] = useState("all");
  const [projectF, setProjectF] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState({ branches: [], projects: [], mobilizers: [] });

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (branchF && branchF !== "all") params.branch = branchF;
      if (projectF && projectF !== "all") params.project = projectF;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      const [rr, roll, ff] = await Promise.all([
        api.get("/mis/mobilization", { params }),
        api.get("/mis/mobilization/rollups"),
        api.get("/mis/mobilization/filter-options"),
      ]);
      setRows(rr.data || []);
      setRollups(roll.data);
      setFilters(ff.data || { branches: [], projects: [], mobilizers: [] });
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [branchF, projectF, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing({ ...EMPTY, locations: [{ ...EMPTY_LOC }] }); setOpenForm(true); };
  const openEdit = (r) => { setEditing({ ...EMPTY, ...r, locations: (r.locations && r.locations.length) ? r.locations : [{ ...EMPTY_LOC }] }); setOpenForm(true); };

  const setLoc = (i, patch) => {
    setEditing((p) => {
      const locs = [...(p.locations || [])];
      locs[i] = { ...locs[i], ...patch };
      return { ...p, locations: locs };
    });
  };
  const addLoc = () => {
    setEditing((p) => (p.locations || []).length >= 5
      ? (toast.error("Max 5 locations per daily report"), p)
      : { ...p, locations: [...(p.locations || []), { ...EMPTY_LOC }] });
  };
  const rmLoc = (i) => setEditing((p) => ({ ...p, locations: p.locations.filter((_, idx) => idx !== i) }));

  const captureGPS = (i) => {
    if (!navigator.geolocation) return toast.error("GPS not available in this browser");
    toast.loading("Getting GPS…", { id: `gps-${i}` });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc(i, { lat: pos.coords.latitude, lng: pos.coords.longitude });
        toast.success(`GPS captured: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`, { id: `gps-${i}` });
      },
      (err) => toast.error(`GPS failed: ${err.message}`, { id: `gps-${i}` }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
  const pickPhoto = async (i, file) => {
    if (!file) return;
    try {
      const dataUrl = await fileToBase64(file);
      setLoc(i, { photo_data_url: dataUrl });
      toast.success("Photo attached");
    } catch (e) { toast.error(e.message); }
  };

  const save = async () => {
    if (!editing.branch?.trim())         return toast.error("Branch required");
    if (!editing.report_date)            return toast.error("Report Date required");
    if (!editing.mobilizer_name?.trim()) return toast.error("Mobilizer Name required");
    if (!editing.locations?.length)      return toast.error("At least one location required");
    // Basic per-location validation
    for (const [i, l] of (editing.locations || []).entries()) {
      if (!l.area_name?.trim()) return toast.error(`Location #${i + 1}: Area Name required`);
    }
    setSaving(true);
    try {
      if (editing.id) await api.patch(`/mis/mobilization/${editing.id}`, editing);
      else            await api.post("/mis/mobilization", editing);
      toast.success(editing.id ? "Report updated" : "Report submitted");
      setOpenForm(false); setEditing(null);
      load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Delete mobilization report from ${r.report_date} by ${r.mobilizer_name}?`)) return;
    try { await api.delete(`/mis/mobilization/${r.id}`); toast.success("Deleted"); load(); onChange && onChange(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const exportExcel = async () => {
    try {
      const params = {};
      if (branchF && branchF !== "all") params.branch = branchF;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      const r = await api.get("/mis/mobilization/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = "mobilization_export.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };

  // Form live totals
  const formTotals = useMemo(() => {
    if (!editing?.locations) return { mob: 0, km: 0 };
    return editing.locations.reduce((a, l) => ({
      mob: a.mob + (Number(l.mobilisation) || 0),
      km:  a.km  + (Number(l.distance_km)  || 0),
    }), { mob: 0, km: 0 });
  }, [editing]);

  return (
    <div className="space-y-4" data-testid="mis-mob-tab">
      {/* KPI strip */}
      {rollups && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <KPI l="Today Mob"       v={rollups.today.mob}          tone="brand" />
          <KPI l="Today Distance"  v={`${rollups.today.km} km`}   tone="brand" />
          <KPI l="Today Reports"   v={rollups.today.reports}      tone="muted" />
          <KPI l="MTD Mob"         v={rollups.month_to_date.mob}  tone="green" />
          <KPI l="Avg/Day Mob"     v={rollups.avg_per_day.mob}    tone="green" />
          <KPI l="Avg/Day KM"      v={`${rollups.avg_per_day.km} km`} tone="green" />
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48">
          <Label className="overline">Branch</Label>
          <Select value={branchF} onValueChange={setBranchF}>
            <SelectTrigger className="rounded-none" data-testid="mob-branch"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {filters.branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="overline">Project</Label>
          <Select value={projectF} onValueChange={setProjectF}>
            <SelectTrigger className="rounded-none" data-testid="mob-project"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {filters.projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="overline">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-none" data-testid="mob-date-from" />
        </div>
        <div className="w-40">
          <Label className="overline">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-none" data-testid="mob-date-to" />
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" onClick={exportExcel} className="rounded-none gap-1" data-testid="mob-export"><Download size={13} /> Export</Button>
          {canWrite && <Button onClick={openAdd} className="brand-btn rounded-none gap-1" data-testid="mob-add-btn"><Plus size={13} /> New Daily Report</Button>}
        </div>
      </div>

      {/* Rollup cards: by mobilizer / by branch / by project */}
      {rollups && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RollupCard title="Top Mobilizers (30d)" rows={rollups.by_mobilizer.slice(0, 5)}
            columns={[{ k: "name", l: "Name" }, { k: "mobilisation", l: "Mob", align: "right", isNum: true },
                      { k: "distance_km", l: "KM", align: "right", isNum: true }]} />
          <RollupCard title="Branch-wise (30d)"   rows={rollups.by_branch.slice(0, 5)}
            columns={[{ k: "branch", l: "Branch" }, { k: "mobilisation", l: "Mob", align: "right", isNum: true },
                      { k: "distance_km", l: "KM", align: "right", isNum: true }]} />
          <RollupCard title="Project-wise (30d)"  rows={rollups.by_project.slice(0, 5)}
            columns={[{ k: "project", l: "Project" }, { k: "mobilisation", l: "Mob", align: "right", isNum: true },
                      { k: "distance_km", l: "KM", align: "right", isNum: true }]} />
        </div>
      )}

      {/* Reports table */}
      <div className="swiss-card overflow-x-auto" data-testid="mob-table">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 border-b border-[var(--border)]">
            <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px]">
              <th>Date</th><th>Branch</th><th>Project</th><th>Mobilizer</th>
              <th>Emp ID</th><th className="text-right">Locations</th>
              <th className="text-right">Total Mob</th><th className="text-right">Distance</th>
              <th>Submitted By</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-[var(--muted)]">No mobilization reports yet — click New Daily Report to submit one.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)] hover:bg-gray-50 [&>td]:p-2" data-testid={`mob-row-${r.id}`}>
                <td className="font-mono">{r.report_date}</td>
                <td className="font-semibold">{r.branch}</td>
                <td>{r.project || "—"}</td>
                <td>{r.mobilizer_name}</td>
                <td className="font-mono text-xs">{r.mobilizer_emp_id || "—"}</td>
                <td className="text-right">{(r.locations || []).length}</td>
                <td className="text-right text-emerald-700 font-bold">{num(r.total_mobilisation)}</td>
                <td className="text-right">{num(r.total_distance_km)} km</td>
                <td className="text-xs">{r.submitted_by_name || "—"}</td>
                <td className="whitespace-nowrap">
                  <Button size="icon" variant="ghost" onClick={() => setViewing(r)} className="h-7 w-7 rounded-none" title="View" data-testid={`mob-view-${r.id}`}><Eye size={13} /></Button>
                  {canWrite && <Button size="icon" variant="ghost" onClick={() => openEdit(r)} className="h-7 w-7 rounded-none" title="Edit" data-testid={`mob-edit-${r.id}`}><Edit3 size={13} /></Button>}
                  {canWrite && <Button size="icon" variant="ghost" onClick={() => remove(r)} className="h-7 w-7 rounded-none hover:text-red-700" title="Delete" data-testid={`mob-del-${r.id}`}><Trash2 size={13} /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={openForm} onOpenChange={(o) => !o && (setOpenForm(false), setEditing(null))}>
        <DialogContent className="rounded-none max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="mob-form">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><RouteIcon size={18} /> {editing?.id ? "Edit Daily Report" : "New Daily Mobilization Report"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              {/* Header meta */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field l="Branch *"    v={editing.branch}          on={(v) => setEditing({ ...editing, branch: v })} />
                <Field l="Project"     v={editing.project}         on={(v) => setEditing({ ...editing, project: v })} />
                <Field l="Report Date *" v={editing.report_date}   on={(v) => setEditing({ ...editing, report_date: v })} type="date" />
                <Field l="Mobilizer Name *" v={editing.mobilizer_name} on={(v) => setEditing({ ...editing, mobilizer_name: v })} />
                <Field l="Mobilizer Emp ID" v={editing.mobilizer_emp_id} on={(v) => setEditing({ ...editing, mobilizer_emp_id: v })} />
                <Field l="Contact"     v={editing.mobilizer_contact} on={(v) => setEditing({ ...editing, mobilizer_contact: v })} />
              </div>

              {/* Locations array */}
              <div>
                <div className="flex items-center justify-between border-b border-[var(--border)] pb-1 mb-2">
                  <div className="overline">Mobilization Locations ({editing.locations.length}/5)</div>
                  {editing.locations.length < 5 && (
                    <Button size="sm" variant="outline" onClick={addLoc} className="rounded-none gap-1" data-testid="mob-add-loc"><Plus size={11} /> Add Location</Button>
                  )}
                </div>
                <div className="space-y-3">
                  {editing.locations.map((loc, i) => (
                    <div key={i} className="border-l-4 border-[var(--brand)] bg-gray-50 p-3" data-testid={`mob-loc-${i}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="overline text-[10px] font-bold">Location #{i + 1}</div>
                        {editing.locations.length > 1 && (
                          <Button size="icon" variant="ghost" onClick={() => rmLoc(i)} className="h-6 w-6 hover:text-red-700" title="Remove"><X size={12} /></Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Field l="Area Name *"      v={loc.area_name}      on={(v) => setLoc(i, { area_name: v })} testid={`mob-loc-name-${i}`} />
                        <Field l="Distance (km)"    v={loc.distance_km}    on={(v) => setLoc(i, { distance_km: v })} type="number" testid={`mob-loc-km-${i}`} />
                        <Field l="Mobilisation"     v={loc.mobilisation}   on={(v) => setLoc(i, { mobilisation: v })} type="number" testid={`mob-loc-mob-${i}`} />
                        <div>
                          <Label className="overline text-[10px]">GPS</Label>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => captureGPS(i)} className="rounded-none gap-1 h-9 flex-1" data-testid={`mob-loc-gps-${i}`}>
                              <MapPin size={11} /> {loc.lat != null ? `${Number(loc.lat).toFixed(3)},${Number(loc.lng).toFixed(3)}` : "Capture GPS"}
                            </Button>
                            {loc.lat != null && (
                              <Button size="icon" variant="ghost" onClick={() => setLoc(i, { lat: null, lng: null })} className="h-9 w-9" title="Clear"><X size={11} /></Button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                        <div className="md:col-span-2">
                          <Label className="overline text-[10px]">Notes</Label>
                          <Input value={loc.notes || ""} onChange={(e) => setLoc(i, { notes: e.target.value })} className="rounded-none" />
                        </div>
                        <div>
                          <Label className="overline text-[10px]">Photo</Label>
                          <div className="flex items-center gap-2">
                            <label className="rounded-none border border-input px-2 py-1.5 text-xs flex items-center gap-1 cursor-pointer bg-white hover:bg-gray-50 flex-1" data-testid={`mob-loc-photo-${i}`}>
                              <Camera size={11} /> {loc.photo_data_url ? "Change photo" : "Upload"}
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => pickPhoto(i, e.target.files?.[0])} />
                            </label>
                            {loc.photo_data_url && (
                              <img src={loc.photo_data_url} alt={`loc-${i}`} className="h-8 w-8 object-cover border border-[var(--border)]" />
                            )}
                            {loc.photo_data_url && (
                              <Button size="icon" variant="ghost" onClick={() => setLoc(i, { photo_data_url: null })} className="h-6 w-6 hover:text-red-700" title="Remove photo"><X size={11} /></Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Live totals */}
                <div className="border-l-4 border-emerald-500 bg-emerald-50/40 p-2 mt-3 flex gap-6 text-sm" data-testid="mob-form-totals">
                  <div><span className="overline text-[10px]">Total Mobilisation</span> <div className="font-heading font-black text-emerald-700 text-lg">{formTotals.mob}</div></div>
                  <div><span className="overline text-[10px]">Total Distance</span> <div className="font-heading font-black text-emerald-700 text-lg">{formTotals.km.toFixed(2)} km</div></div>
                </div>
              </div>

              <div>
                <Label className="overline text-[10px]">Remarks</Label>
                <Textarea value={editing.remarks || ""} onChange={(e) => setEditing({ ...editing, remarks: e.target.value })} rows={2} className="rounded-none" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenForm(false); setEditing(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={save} disabled={saving} className="brand-btn rounded-none" data-testid="mob-save">{saving ? "Saving…" : (editing?.id ? "Save changes" : "Submit Report")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="rounded-none max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="mob-view-dlg">
          {viewing && (
            <>
              <DialogHeader><DialogTitle className="font-heading">{viewing.branch} · {viewing.report_date}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-sm">
                <Meta l="Branch" v={viewing.branch} />
                <Meta l="Project" v={viewing.project} />
                <Meta l="Mobilizer" v={viewing.mobilizer_name} />
                <Meta l="Emp ID" v={viewing.mobilizer_emp_id} />
                <Meta l="Contact" v={viewing.mobilizer_contact} />
                <Meta l="Total Mob" v={num(viewing.total_mobilisation)} tone="green" />
                <Meta l="Total Distance" v={`${num(viewing.total_distance_km)} km`} tone="green" />
                <Meta l="Submitted By" v={viewing.submitted_by_name} />
              </div>
              <div className="overline mb-2 border-b border-[var(--border)] pb-1">Locations</div>
              <div className="space-y-2">
                {(viewing.locations || []).map((loc, i) => (
                  <div key={i} className="border border-[var(--border)] p-2 flex gap-3">
                    {loc.photo_data_url && <img src={loc.photo_data_url} alt="" className="h-16 w-16 object-cover border border-[var(--border)]" />}
                    <div className="flex-1">
                      <div className="font-semibold">{loc.area_name}</div>
                      <div className="text-xs text-[var(--muted)]">
                        Distance: <b>{loc.distance_km || 0} km</b> · Mobilisation: <b>{loc.mobilisation || 0}</b>
                        {loc.lat != null && <> · GPS: <a href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] underline font-mono">{Number(loc.lat).toFixed(4)}, {Number(loc.lng).toFixed(4)}</a></>}
                      </div>
                      {loc.notes && <div className="text-xs mt-1">Notes: {loc.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
              {viewing.remarks && <div className="mt-3"><div className="overline text-[10px]">Remarks</div><div>{viewing.remarks}</div></div>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* --- helpers --- */
function KPI({ l, v, tone }) {
  const t = tone === "green" ? "text-emerald-700" : tone === "muted" ? "text-[var(--muted)]" : "text-[var(--brand)]";
  return (
    <div className="swiss-card p-3">
      <div className="overline text-[10px]">{l}</div>
      <div className={`font-heading font-black text-xl mt-0.5 ${t}`}>{typeof v === "number" ? v.toLocaleString("en-IN") : v}</div>
    </div>
  );
}
function Field({ l, v, on, type = "text", testid }) {
  return (
    <div>
      <Label className="overline text-[10px]">{l}</Label>
      <Input type={type} value={v ?? ""} onChange={(e) => on(e.target.value)} className="rounded-none" data-testid={testid} />
    </div>
  );
}
function Meta({ l, v, tone }) {
  const t = tone === "green" ? "text-emerald-700" : "";
  return <div><div className="overline text-[10px]">{l}</div><div className={`font-semibold ${t}`}>{v || "—"}</div></div>;
}
function RollupCard({ title, rows, columns }) {
  return (
    <div className="swiss-card p-3">
      <div className="overline mb-2">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-[var(--muted)]">No data in the last 30 days</div>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-[var(--border)]">
            {columns.map((c) => <th key={c.k} className={`p-1 ${c.align === "right" ? "text-right" : "text-left"} overline text-[9px]`}>{c.l}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--border)]/50">
                {columns.map((c) => (
                  <td key={c.k} className={`p-1 ${c.align === "right" ? "text-right font-mono" : ""}`}>
                    {c.isNum ? num(r[c.k]) : (r[c.k] || "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Trash2, Edit3, Eye, Upload, Download, FileSpreadsheet,
  X, CheckCircle2, XCircle, GraduationCap, Users, TrendingUp,
} from "lucide-react";

/**
 * JSDMS Project Tracker (Phase 3)
 * ---------------------------------
 * 20-column tracker + auto-calc: Total Achieved, Remaining Target,
 * Achievement %, Trainer Gap, Trainer Readiness %.
 */
const SECTIONS = [
  { title: "Basic", fields: [
    { k: "serial_no", l: "Sl. No.", type: "number" },
    { k: "bg_status", l: "BG Status" },
    { k: "centre_name", l: "Centre Name" },
    { k: "job_role", l: "Job Role" },
    { k: "target_received", l: "Target Received (Work Order)", type: "number" },
  ]},
  { title: "FY-wise Achievement", fields: [
    { k: "achieved_21_22", l: "Achieved 21-22", type: "number" },
    { k: "achieved_22_23", l: "Achieved 22-23", type: "number" },
    { k: "achieved_23_24", l: "Achieved 23-24", type: "number" },
    { k: "achieved_24_25", l: "Achieved 24-25 (Current)", type: "number" },
  ]},
  { title: "Training Delivery", fields: [
    { k: "num_batches", l: "No. of Batches", type: "number" },
    { k: "total_hours", l: "Total Hours", type: "number" },
    { k: "duration_months", l: "Duration (Months)", type: "number" },
    { k: "per_hour", l: "Training Per Hour", type: "number" },
    { k: "total_enrolled", l: "Total Enrolled", type: "number" },
    { k: "center_status", l: "Center Status" },
    { k: "job_role_status", l: "Job Role Status" },
    { k: "not_approved_reason", l: "If Not Approved — Reason" },
  ]},
  { title: "Trainer Roster", fields: [
    { k: "certified_trainers", l: "Certified Trainers at Center", type: "number" },
    { k: "tot_aligned", l: "TOT Aligned", type: "number" },
    { k: "tot_renew_aligned", l: "TOT Renew Aligned", type: "number" },
    { k: "trainers_required", l: "Trainers Required", type: "number" },
  ]},
];
const ALL = SECTIONS.flatMap((s) => s.fields);
const EMPTY = ALL.reduce((a, f) => ({ ...a, [f.k]: "" }), {});

const BG_TONES = {
  submitted: "bg-blue-100 text-blue-800 border-blue-300",
  approved:  "bg-emerald-100 text-emerald-800 border-emerald-300",
  pending:   "bg-amber-100 text-amber-800 border-amber-300",
  rejected:  "bg-red-100 text-red-800 border-red-300",
  expired:   "bg-red-100 text-red-800 border-red-300",
};
function bgChip(s) {
  const key = (s || "").trim().toLowerCase();
  const tone = BG_TONES[key] || "bg-gray-100 text-gray-700 border-gray-300";
  return <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold uppercase border ${tone}`}>{s || "—"}</span>;
}
const num = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("en-IN");
function pct(v, good = 60) {
  if (v == null) return <span className="text-[var(--muted)]">—</span>;
  return <span className={`font-bold ${v >= good ? "text-emerald-700" : v > 0 ? "text-amber-700" : "text-[var(--muted)]"}`}>{v}%</span>;
}

export default function JSDMSTab({ canWrite, onChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [centreF, setCentreF] = useState("all");
  const [roleF, setRoleF] = useState("all");
  const [bgF, setBgF] = useState("all");
  const [filters, setFilters] = useState({ centres: [], job_roles: [], bg_statuses: [] });

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkFileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (centreF && centreF !== "all") params.centre = centreF;
      if (roleF && roleF !== "all") params.job_role = roleF;
      if (bgF && bgF !== "all") params.bg_status = bgF;
      const [rr, ff] = await Promise.all([
        api.get("/mis/jsdms", { params }),
        api.get("/mis/jsdms/filter-options"),
      ]);
      setRows(rr.data || []);
      setFilters(ff.data || { centres: [], job_roles: [], bg_statuses: [] });
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [search, centreF, roleF, bgF]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing({ ...EMPTY }); setOpenForm(true); };
  const openEdit = (row) => { setEditing({ ...EMPTY, ...row }); setOpenForm(true); };

  const save = async () => {
    if (!editing?.centre_name?.trim() && !editing?.job_role?.trim())
      return toast.error("Centre Name or Job Role required");
    setSaving(true);
    try {
      if (editing.id) await api.patch(`/mis/jsdms/${editing.id}`, editing);
      else            await api.post("/mis/jsdms", editing);
      toast.success(editing.id ? "Updated" : "Added");
      setOpenForm(false); setEditing(null);
      load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Delete JSDMS row for "${r.centre_name || r.job_role}"?`)) return;
    try { await api.delete(`/mis/jsdms/${r.id}`); toast.success("Deleted"); load(); onChange && onChange(); }
    catch (e) { toast.error(formatError(e)); }
  };

  const downloadTemplate = async () => {
    try {
      const r = await api.get("/mis/jsdms/sample-excel", { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = "jsdms_project_template.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };
  const exportExcel = async () => {
    try {
      const r = await api.get("/mis/jsdms/export", { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = "jsdms_project_export.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };
  const runBulkPreview = async () => {
    if (!bulkFile) return toast.error("Choose an Excel file");
    setBulkBusy(true); setBulkPreview(null);
    try {
      const fd = new FormData(); fd.append("file", bulkFile);
      const r = await api.post("/mis/jsdms/bulk-preview", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setBulkPreview(r.data);
      if (r.data.valid === 0) toast.error("No valid rows in file");
      else toast.success(`${r.data.valid} valid · ${r.data.failed} failed`);
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };
  const confirmBulk = async () => {
    if (!bulkFile || !bulkPreview || bulkPreview.valid === 0) return;
    setBulkBusy(true);
    try {
      const fd = new FormData(); fd.append("file", bulkFile);
      const r = await api.post("/mis/jsdms/bulk-upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Uploaded ${r.data.uploaded}, skipped ${r.data.failed}`);
      closeBulk(); load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };
  const closeBulk = () => {
    setBulkOpen(false); setBulkFile(null); setBulkPreview(null);
    if (bulkFileRef.current) bulkFileRef.current.value = "";
  };

  // Summary
  const totals = useMemo(() => rows.reduce((a, r) => ({
    rows: a.rows + 1,
    target: a.target + (r.target_received || 0),
    achieved: a.achieved + (r.total_achieved || 0),
    enrolled: a.enrolled + (r.total_enrolled || 0),
    required: a.required + (r.trainers_required || 0),
    aligned: a.aligned + ((r.tot_aligned || 0) + (r.tot_renew_aligned || 0)),
  }), { rows: 0, target: 0, achieved: 0, enrolled: 0, required: 0, aligned: 0 }), [rows]);
  const ach_pct = totals.target ? Math.round((totals.achieved / totals.target) * 100) : 0;
  const gap = Math.max(0, totals.required - totals.aligned);

  // Live auto-calc in the form
  const editCalc = useMemo(() => {
    if (!editing) return { total: 0, remaining: 0, ach: 0, gap: 0, ready: 0 };
    const total = ["achieved_21_22","achieved_22_23","achieved_23_24","achieved_24_25"]
      .reduce((s, k) => s + (Number(editing[k]) || 0), 0);
    const tgt = Number(editing.target_received) || 0;
    const req = Number(editing.trainers_required) || 0;
    const al  = (Number(editing.tot_aligned) || 0) + (Number(editing.tot_renew_aligned) || 0);
    return {
      total,
      remaining: Math.max(0, tgt - total),
      ach: tgt ? Math.round(total / tgt * 100) : 0,
      gap: Math.max(0, req - al),
      ready: req ? Math.round(al / req * 100) : 0,
    };
  }, [editing]);

  return (
    <div className="space-y-4" data-testid="mis-jsdms-tab">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {[
          { l: "Rows", v: totals.rows },
          { l: "Target Received", v: totals.target },
          { l: "Total Achieved", v: totals.achieved, tone: "green" },
          { l: "Enrolled", v: totals.enrolled },
          { l: "Achievement %", v: `${ach_pct}%`, tone: "green" },
          { l: "Trainer Gap", v: gap, tone: gap > 0 ? "red" : "green" },
        ].map((k, i) => (
          <div key={i} className="swiss-card p-3">
            <div className="overline text-[10px]">{k.l}</div>
            <div className={`font-heading font-black text-xl mt-0.5 ${
              k.tone === "green" ? "text-emerald-700" : k.tone === "red" ? "text-red-700" : "text-[var(--brand)]"
            }`}>
              {typeof k.v === "number" ? k.v.toLocaleString("en-IN") : k.v}
            </div>
          </div>
        ))}
      </div>

      {/* Filters + actions */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <Label className="overline">Search</Label>
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Centre / Job Role / BG Status" className="rounded-none pl-7" data-testid="jsdms-search" />
          </div>
        </div>
        <div className="w-48">
          <Label className="overline">Centre</Label>
          <Select value={centreF} onValueChange={setCentreF}>
            <SelectTrigger className="rounded-none" data-testid="jsdms-centre"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Centres</SelectItem>
              {filters.centres.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Label className="overline">Job Role</Label>
          <Select value={roleF} onValueChange={setRoleF}>
            <SelectTrigger className="rounded-none" data-testid="jsdms-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {filters.job_roles.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="overline">BG Status</Label>
          <Select value={bgF} onValueChange={setBgF}>
            <SelectTrigger className="rounded-none" data-testid="jsdms-bg"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {filters.bg_statuses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" onClick={exportExcel} className="rounded-none gap-1" data-testid="jsdms-export"><Download size={13} /> Export</Button>
          {canWrite && <Button variant="outline" onClick={() => setBulkOpen(true)} className="rounded-none gap-1" data-testid="jsdms-bulk-btn"><Upload size={13} /> Bulk Upload</Button>}
          {canWrite && <Button onClick={openAdd} className="brand-btn rounded-none gap-1" data-testid="jsdms-add-btn"><Plus size={13} /> Add JSDMS Row</Button>}
        </div>
      </div>

      {/* Table */}
      <div className="swiss-card overflow-x-auto" data-testid="jsdms-table">
        <table className="text-xs min-w-max">
          <thead className="bg-gray-50 border-b border-[var(--border)]">
            <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px] [&>th]:whitespace-nowrap">
              <th>#</th><th>Centre</th><th>Job Role</th><th>BG</th>
              <th className="text-right">Target</th>
              <th className="text-right">21-22</th><th className="text-right">22-23</th><th className="text-right">23-24</th><th className="text-right">24-25</th>
              <th className="text-right">Total</th><th className="text-right">Remaining</th><th className="text-right">Ach %</th>
              <th className="text-right">Enrolled</th>
              <th className="text-right">TOT Aligned</th><th className="text-right">Required</th><th className="text-right">Gap</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={17} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={17} className="p-6 text-center text-[var(--muted)]">No JSDMS rows yet — bulk-upload from the reference sheet or add manually.</td></tr>
            )}
            {rows.map((r) => {
              const totAligned = (r.tot_aligned || 0) + (r.tot_renew_aligned || 0);
              return (
                <tr key={r.id} className="border-t border-[var(--border)] hover:bg-gray-50 [&>td]:p-2 [&>td]:whitespace-nowrap" data-testid={`jsdms-row-${r.id}`}>
                  <td>{r.serial_no || "—"}</td>
                  <td className="font-semibold">{r.centre_name || "—"}</td>
                  <td>{r.job_role || "—"}</td>
                  <td>{bgChip(r.bg_status)}</td>
                  <td className="text-right">{num(r.target_received)}</td>
                  <td className="text-right">{num(r.achieved_21_22)}</td>
                  <td className="text-right">{num(r.achieved_22_23)}</td>
                  <td className="text-right">{num(r.achieved_23_24)}</td>
                  <td className="text-right">{num(r.achieved_24_25)}</td>
                  <td className="text-right text-emerald-700 font-bold">{num(r.total_achieved)}</td>
                  <td className="text-right text-amber-700 font-bold">{num(r.remaining_target)}</td>
                  <td className="text-right">{pct(r.achievement_pct, 60)}</td>
                  <td className="text-right">{num(r.total_enrolled)}</td>
                  <td className="text-right">{totAligned}</td>
                  <td className="text-right">{num(r.trainers_required)}</td>
                  <td className={`text-right font-bold ${r.trainer_gap > 0 ? "text-red-700" : "text-emerald-700"}`}>{r.trainer_gap || 0}</td>
                  <td>
                    <Button size="icon" variant="ghost" onClick={() => setViewing(r)} className="h-7 w-7 rounded-none" title="View" data-testid={`jsdms-view-${r.id}`}><Eye size={12} /></Button>
                    {canWrite && <Button size="icon" variant="ghost" onClick={() => openEdit(r)} className="h-7 w-7 rounded-none" title="Edit" data-testid={`jsdms-edit-${r.id}`}><Edit3 size={12} /></Button>}
                    {canWrite && <Button size="icon" variant="ghost" onClick={() => remove(r)} className="h-7 w-7 rounded-none hover:text-red-700" title="Delete" data-testid={`jsdms-del-${r.id}`}><Trash2 size={12} /></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add/Edit */}
      <Dialog open={openForm} onOpenChange={(o) => !o && (setOpenForm(false), setEditing(null))}>
        <DialogContent className="rounded-none max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="jsdms-form">
          <DialogHeader><DialogTitle className="font-heading">{editing?.id ? "Edit JSDMS Row" : "Add JSDMS Row"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              {SECTIONS.map((sec) => (
                <div key={sec.title}>
                  <div className="overline mb-2 border-b border-[var(--border)] pb-1">{sec.title}</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {sec.fields.map((f) => (
                      <div key={f.k}>
                        <Label className="overline text-[10px]">{f.l}</Label>
                        <Input type={f.type || "text"} value={editing[f.k] ?? ""} onChange={(e) => setEditing({ ...editing, [f.k]: e.target.value })} className="rounded-none" data-testid={`jsdms-inp-${f.k}`} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="border-l-4 border-emerald-500 bg-emerald-50/40 p-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs" data-testid="jsdms-autocalc">
                {[
                  ["Total Achieved", editCalc.total],
                  ["Remaining Target", editCalc.remaining],
                  ["Achievement %", `${editCalc.ach}%`],
                  ["Trainer Gap", editCalc.gap],
                  ["Trainer Readiness %", `${editCalc.ready}%`],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="overline text-[9px]">{l}</div>
                    <div className="font-heading font-black text-emerald-700">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenForm(false); setEditing(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={save} disabled={saving} className="brand-btn rounded-none" data-testid="jsdms-save">{saving ? "Saving…" : (editing?.id ? "Save changes" : "Add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="rounded-none max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="jsdms-view-dlg">
          {viewing && (
            <>
              <DialogHeader><DialogTitle className="font-heading">{viewing.centre_name} — {viewing.job_role}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mb-3 text-xs">
                <div className="swiss-card p-2"><div className="overline text-[9px]">Total Achieved</div><div className="text-emerald-700 font-bold text-lg">{viewing.total_achieved}</div></div>
                <div className="swiss-card p-2"><div className="overline text-[9px]">Remaining</div><div className="text-amber-700 font-bold text-lg">{viewing.remaining_target}</div></div>
                <div className="swiss-card p-2"><div className="overline text-[9px]">Achievement %</div><div className="text-[var(--brand)] font-bold text-lg">{viewing.achievement_pct}%</div></div>
                <div className="swiss-card p-2"><div className="overline text-[9px]">Trainer Gap</div><div className={`font-bold text-lg ${viewing.trainer_gap > 0 ? "text-red-700" : "text-emerald-700"}`}>{viewing.trainer_gap}</div></div>
                <div className="swiss-card p-2"><div className="overline text-[9px]">Readiness %</div><div className="text-emerald-700 font-bold text-lg">{viewing.trainer_readiness_pct}%</div></div>
              </div>
              {SECTIONS.map((sec) => (
                <div key={sec.title} className="mb-4">
                  <div className="overline border-b border-[var(--border)] pb-1 mb-2">{sec.title}</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                    {sec.fields.map((f) => (
                      <div key={f.k}>
                        <div className="overline text-[10px]">{f.l}</div>
                        <div className="mt-0.5">{viewing[f.k] ?? "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Upload */}
      <Dialog open={bulkOpen} onOpenChange={(o) => !o && closeBulk()}>
        <DialogContent className="rounded-none max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="jsdms-bulk-dlg">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><Upload size={16} /> Bulk Upload — JSDMS Project</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="border-l-4 border-[var(--brand)] bg-blue-50/40 p-3">
              <div className="font-bold flex items-center gap-2"><FileSpreadsheet size={14} /> Step 1 · Download template</div>
              <p className="text-xs text-[var(--muted)] mt-1">21-column template with FY 21-22 to 24-25 achievement + TOT + trainer requirement.</p>
              <Button variant="outline" onClick={downloadTemplate} className="rounded-none gap-1 mt-2" data-testid="jsdms-tmpl-btn"><Download size={12} /> Download Sample Excel</Button>
            </div>
            <div className="border-l-4 border-gray-300 bg-gray-50 p-3">
              <div className="font-bold flex items-center gap-2"><Upload size={14} /> Step 2 · Upload Excel</div>
              <input ref={bulkFileRef} type="file" accept=".xlsx,.xls" className="mt-2 text-xs block" onChange={(e) => { setBulkFile(e.target.files?.[0] || null); setBulkPreview(null); }} data-testid="jsdms-bulk-file" />
              {bulkFile && <div className="text-xs text-[var(--muted)] mt-1">Selected: <span className="font-mono">{bulkFile.name}</span> ({Math.round(bulkFile.size / 1024)} KB)</div>}
              <div className="flex gap-2 mt-2">
                <Button onClick={runBulkPreview} disabled={!bulkFile || bulkBusy} className="brand-btn rounded-none" data-testid="jsdms-bulk-preview">{bulkBusy && !bulkPreview ? "Validating…" : "Preview"}</Button>
                {bulkFile && <Button variant="outline" onClick={() => { setBulkFile(null); setBulkPreview(null); if (bulkFileRef.current) bulkFileRef.current.value = ""; }} className="rounded-none gap-1"><X size={12} /> Clear</Button>}
              </div>
            </div>
            {bulkPreview && (
              <div className="border-l-4 border-emerald-500 bg-emerald-50/40 p-3 space-y-2">
                <div className="font-bold flex items-center gap-2 flex-wrap">
                  <CheckCircle2 size={14} className="text-emerald-600" /> Step 3 · Preview
                  <span className="text-xs font-normal ml-2">
                    Total: <b>{bulkPreview.total_rows}</b> · <span className="text-emerald-700">Valid: <b>{bulkPreview.valid}</b></span> · <span className="text-red-700">Failed: <b>{bulkPreview.failed}</b></span>
                  </span>
                </div>
                {bulkPreview.errors?.length > 0 && (
                  <div className="border border-red-200 max-h-32 overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-red-100 sticky top-0"><tr><th className="p-1.5 text-left">Row</th><th className="p-1.5 text-left">Reason</th></tr></thead>
                      <tbody>{bulkPreview.errors.map((er, i) => (
                        <tr key={i} className="border-t border-red-100">
                          <td className="p-1.5 font-mono">{er.row}</td>
                          <td className="p-1.5 text-red-800"><XCircle size={11} className="inline mr-1" />{er.reason}</td>
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bulkPreview.valid_rows?.length > 0 && (
                  <div className="border border-emerald-200 max-h-64 overflow-y-auto">
                    <table className="w-max min-w-full text-[11px]">
                      <thead className="bg-emerald-100 sticky top-0"><tr>
                        <th className="p-1.5 text-left">Row</th><th className="p-1.5 text-left">Centre</th><th className="p-1.5 text-left">Job Role</th>
                        <th className="p-1.5 text-left">BG</th><th className="p-1.5 text-right">Target</th>
                        <th className="p-1.5 text-right">21-22</th><th className="p-1.5 text-right">22-23</th>
                        <th className="p-1.5 text-right">23-24</th><th className="p-1.5 text-right">24-25</th>
                      </tr></thead>
                      <tbody>
                        {bulkPreview.valid_rows.map((v) => (
                          <tr key={v.row} className="border-t border-emerald-100">
                            <td className="p-1.5 font-mono">{v.row}</td>
                            <td className="p-1.5">{v.data.centre_name}</td>
                            <td className="p-1.5">{v.data.job_role}</td>
                            <td className="p-1.5">{bgChip(v.data.bg_status)}</td>
                            <td className="p-1.5 text-right">{num(v.data.target_received)}</td>
                            <td className="p-1.5 text-right">{num(v.data.achieved_21_22)}</td>
                            <td className="p-1.5 text-right">{num(v.data.achieved_22_23)}</td>
                            <td className="p-1.5 text-right">{num(v.data.achieved_23_24)}</td>
                            <td className="p-1.5 text-right">{num(v.data.achieved_24_25)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={closeBulk} className="rounded-none">Cancel</Button>
            <Button onClick={confirmBulk} disabled={!bulkPreview || bulkPreview.valid === 0 || bulkBusy} className="brand-btn rounded-none gap-2" data-testid="jsdms-bulk-confirm">
              <Upload size={13} /> {bulkBusy && bulkPreview ? "Uploading…" : `Upload ${bulkPreview?.valid || 0} Row${(bulkPreview?.valid || 0) === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

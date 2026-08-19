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
  X, CheckCircle2, XCircle, TrendingUp, Users, GraduationCap, BadgeCheck,
} from "lucide-react";

/**
 * Project Wise Summary (Phase 2)
 * -------------------------------
 * Batch-level tracker matching the 38-column reference Excel. Auto-calc badges:
 *   Certification % = certified / enrolled × 100
 *   Placement %     = placement / certified × 100
 *   Achievement %   = certified / total_target × 100
 *   Dropout %       = dropout / enrolled × 100
 *   Remaining Target = max(0, target - enrolled)   [computed if not entered]
 */

const SECTIONS = [
  {
    title: "Basic Information",
    fields: [
      { k: "serial_no", l: "S.No.", type: "number" },
      { k: "state", l: "State" },
      { k: "territory", l: "Territory / District" },
      { k: "name_of_company", l: "Name Of Company" },
      { k: "center_name", l: "Center Name" },
      { k: "center_manager", l: "Center Manager" },
      { k: "project", l: "Project" },
      { k: "target_year", l: "Target Year" },
      { k: "training_type", l: "Training Type (STT/RPL)" },
      { k: "total_target", l: "Total Target", type: "number" },
      { k: "remaining_target", l: "Remaining Target (manual)", type: "number" },
      { k: "total_target_fy", l: "Total Target FY-wise", type: "number" },
      { k: "remaining_target_fy", l: "Remaining Target FY-wise", type: "number" },
    ],
  },
  {
    title: "Batch Information",
    fields: [
      { k: "batch_id", l: "Batch ID" },
      { k: "job_role", l: "Job Role" },
      { k: "total_enrolled", l: "Total Enrolled", type: "number" },
      { k: "start_date", l: "Start Date", type: "date" },
      { k: "end_date", l: "End Date", type: "date" },
      { k: "status", l: "Status" },
      { k: "sdms_batch_id", l: "SDMS Batch ID" },
      { k: "attendance_pct", l: "Attendance %", type: "number" },
      { k: "total_dropout", l: "Total Drop-out", type: "number" },
    ],
  },
  {
    title: "Assessment Information",
    fields: [
      { k: "assessment_date", l: "Assessment Date", type: "date" },
      { k: "billing_status", l: "Billing Status" },
      { k: "total_certified", l: "Total Certified", type: "number" },
      { k: "assessment_status", l: "Assessment Status" },
      { k: "assessment_agency", l: "Assessment Agency" },
      { k: "assessor_name", l: "Assessor Name" },
      { k: "assessor_contact", l: "Assessor Contact" },
      { k: "actual_present", l: "Actual Present", type: "number" },
      { k: "pass_count", l: "Pass", type: "number" },
      { k: "fail_count", l: "Fail", type: "number" },
      { k: "absent_count", l: "Absent", type: "number" },
    ],
  },
  {
    title: "Placement Information",
    fields: [
      { k: "num_placement", l: "No. of Placement", type: "number" },
      { k: "offer_letter_status", l: "Offer Letter Status" },
      { k: "placement_month_1", l: "1st Month Status" },
      { k: "placement_month_2", l: "2nd Month Status" },
      { k: "placement_month_3", l: "3rd Month Status" },
    ],
  },
];
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
const EMPTY = ALL_FIELDS.reduce((a, f) => ({ ...a, [f.k]: "" }), {});

const STATUS_TONES = {
  active:  "bg-emerald-100 text-emerald-800 border-emerald-300",
  running: "bg-emerald-100 text-emerald-800 border-emerald-300",
  ongoing: "bg-emerald-100 text-emerald-800 border-emerald-300",
  closed:  "bg-gray-200 text-gray-700 border-gray-300",
  close:   "bg-gray-200 text-gray-700 border-gray-300",
  completed:"bg-blue-100 text-blue-800 border-blue-300",
};
function statusChip(status) {
  const s = (status || "").trim().toLowerCase();
  const tone = STATUS_TONES[s] || "bg-gray-100 text-gray-600 border-gray-300";
  return <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border ${tone}`}>{status || "—"}</span>;
}
function pctBadge(v, threshold = 60) {
  if (v == null || Number.isNaN(v)) return <span className="text-[var(--muted)]">—</span>;
  const good = v >= threshold;
  return <span className={`font-bold ${good ? "text-emerald-700" : v > 0 ? "text-amber-700" : "text-[var(--muted)]"}`}>{v}%</span>;
}
const num = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("en-IN");

export default function ProjectSummaryTab({ canWrite, onChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [projectF, setProjectF] = useState("all");
  const [centerF, setCenterF] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [targetYearF, setTargetYearF] = useState("all");
  const [filters, setFilters] = useState({ projects: [], centers: [], territories: [], target_years: [] });

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
      if (projectF && projectF !== "all") params.project = projectF;
      if (centerF && centerF !== "all")   params.center = centerF;
      if (statusF && statusF !== "all")   params.status = statusF;
      if (targetYearF && targetYearF !== "all") params.target_year = targetYearF;
      const [rowsRes, optsRes] = await Promise.all([
        api.get("/mis/projects", { params }),
        api.get("/mis/projects/filter-options"),
      ]);
      setRows(rowsRes.data || []);
      setFilters(optsRes.data || { projects: [], centers: [], territories: [], target_years: [] });
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [search, projectF, centerF, statusF, targetYearF]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing({ ...EMPTY }); setOpenForm(true); };
  const openEdit = (row) => { setEditing({ ...EMPTY, ...row }); setOpenForm(true); };

  const save = async () => {
    if (!editing?.batch_id?.trim() && !editing?.center_name?.trim())
      return toast.error("Batch ID or Center Name required");
    setSaving(true);
    try {
      if (editing.id) await api.patch(`/mis/projects/${editing.id}`, editing);
      else            await api.post("/mis/projects", editing);
      toast.success(editing.id ? "Batch updated" : "Batch added");
      setOpenForm(false); setEditing(null);
      load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Delete batch "${r.batch_id || r.center_name}"?`)) return;
    try { await api.delete(`/mis/projects/${r.id}`); toast.success("Deleted"); load(); onChange && onChange(); }
    catch (e) { toast.error(formatError(e)); }
  };

  // Bulk
  const downloadTemplate = async () => {
    try {
      const r = await api.get("/mis/projects/sample-excel", { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = "project_summary_template.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };
  const exportExcel = async () => {
    try {
      const params = {};
      if (projectF && projectF !== "all") params.project = projectF;
      if (centerF && centerF !== "all")   params.center = centerF;
      const r = await api.get("/mis/projects/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = "project_summary_export.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };
  const runBulkPreview = async () => {
    if (!bulkFile) return toast.error("Choose an Excel file");
    setBulkBusy(true); setBulkPreview(null);
    try {
      const fd = new FormData(); fd.append("file", bulkFile);
      const r = await api.post("/mis/projects/bulk-preview", fd, { headers: { "Content-Type": "multipart/form-data" } });
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
      const r = await api.post("/mis/projects/bulk-upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Uploaded ${r.data.uploaded}, skipped ${r.data.failed}`);
      closeBulk(); load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };
  const closeBulk = () => {
    setBulkOpen(false); setBulkFile(null); setBulkPreview(null);
    if (bulkFileRef.current) bulkFileRef.current.value = "";
  };

  // Summary totals across displayed rows (respects current filters)
  const totals = useMemo(() => rows.reduce((a, r) => ({
    batches: a.batches + 1,
    target: a.target + (r.total_target || 0),
    enrolled: a.enrolled + (r.total_enrolled || 0),
    certified: a.certified + (r.total_certified || 0),
    dropout: a.dropout + (r.total_dropout || 0),
    placement: a.placement + (r.num_placement || 0),
  }), { batches: 0, target: 0, enrolled: 0, certified: 0, dropout: 0, placement: 0 }), [rows]);
  const cert_pct  = totals.enrolled  ? Math.round(totals.certified / totals.enrolled * 100) : 0;
  const place_pct = totals.certified ? Math.round(totals.placement / totals.certified * 100) : 0;

  return (
    <div className="space-y-4" data-testid="mis-projects-tab">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2" data-testid="pjt-summary">
        {[
          { l: "Batches",   v: totals.batches,   icon: null },
          { l: "Target",    v: totals.target,    icon: null },
          { l: "Enrolled",  v: totals.enrolled,  icon: Users },
          { l: "Certified", v: totals.certified, icon: GraduationCap, tone: "green" },
          { l: "Placement", v: totals.placement, icon: BadgeCheck, tone: "green" },
          { l: "Certif %",  v: `${cert_pct}%`,   tone: "green" },
        ].map((k, i) => (
          <div key={i} className="swiss-card p-3">
            <div className="overline text-[10px]">{k.l}</div>
            <div className={`font-heading font-black text-xl mt-0.5 ${k.tone === "green" ? "text-emerald-700" : "text-[var(--brand)]"}`}>
              {typeof k.v === "number" ? k.v.toLocaleString("en-IN") : k.v}
            </div>
          </div>
        ))}
      </div>

      {/* Filters + actions */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <Label className="overline">Search</Label>
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Batch / Center / Job Role / SDMS ID" className="rounded-none pl-7" data-testid="pjt-search" />
          </div>
        </div>
        <div className="w-40">
          <Label className="overline">Project</Label>
          <Select value={projectF} onValueChange={setProjectF}>
            <SelectTrigger className="rounded-none" data-testid="pjt-project"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {filters.projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Label className="overline">Center</Label>
          <Select value={centerF} onValueChange={setCenterF}>
            <SelectTrigger className="rounded-none" data-testid="pjt-center"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Centers</SelectItem>
              {filters.centers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="overline">FY</Label>
          <Select value={targetYearF} onValueChange={setTargetYearF}>
            <SelectTrigger className="rounded-none" data-testid="pjt-fy"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FY</SelectItem>
              {filters.target_years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <Label className="overline">Status</Label>
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="rounded-none" data-testid="pjt-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Closed">Closed</SelectItem>
              <SelectItem value="Ongoing">Ongoing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" onClick={exportExcel} className="rounded-none gap-1" data-testid="pjt-export"><Download size={13} /> Export</Button>
          {canWrite && <Button variant="outline" onClick={() => setBulkOpen(true)} className="rounded-none gap-1" data-testid="pjt-bulk-btn"><Upload size={13} /> Bulk Upload</Button>}
          {canWrite && <Button onClick={openAdd} className="brand-btn rounded-none gap-1" data-testid="pjt-add-btn"><Plus size={13} /> Add Batch</Button>}
        </div>
      </div>

      {/* Table */}
      <div className="swiss-card overflow-x-auto" data-testid="pjt-table">
        <table className="text-xs min-w-max">
          <thead className="bg-gray-50 border-b border-[var(--border)]">
            <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px] [&>th]:whitespace-nowrap">
              <th>#</th><th>Center</th><th>Project</th><th>FY</th><th>Batch ID</th><th>Job Role</th>
              <th className="text-right">Target</th><th className="text-right">Enrolled</th>
              <th className="text-right">Certified</th><th className="text-right">Placement</th>
              <th className="text-right">Certif %</th><th className="text-right">Place %</th>
              <th className="text-right">Ach %</th><th className="text-right">Drop %</th>
              <th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={16} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={16} className="p-6 text-center text-[var(--muted)]">No batches yet — add one or bulk-upload the reference Excel.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)] hover:bg-gray-50 [&>td]:p-2 [&>td]:whitespace-nowrap" data-testid={`pjt-row-${r.id}`}>
                <td>{r.serial_no || "—"}</td>
                <td className="font-semibold">{r.center_name}</td>
                <td>{r.project}</td>
                <td className="font-mono">{r.target_year || "—"}</td>
                <td className="font-mono">{r.batch_id || "—"}</td>
                <td>{r.job_role || "—"}</td>
                <td className="text-right">{num(r.total_target)}</td>
                <td className="text-right">{num(r.total_enrolled)}</td>
                <td className="text-right text-emerald-700 font-bold">{num(r.total_certified)}</td>
                <td className="text-right">{num(r.num_placement)}</td>
                <td className="text-right">{pctBadge(r.certification_pct)}</td>
                <td className="text-right">{pctBadge(r.placement_pct, 50)}</td>
                <td className="text-right">{pctBadge(r.achievement_pct, 80)}</td>
                <td className="text-right">
                  {r.dropout_pct != null ? (
                    <span className={`font-bold ${r.dropout_pct > 15 ? "text-red-700" : r.dropout_pct > 5 ? "text-amber-700" : "text-emerald-700"}`}>{r.dropout_pct}%</span>
                  ) : "—"}
                </td>
                <td>{statusChip(r.status)}</td>
                <td>
                  <Button size="icon" variant="ghost" onClick={() => setViewing(r)} className="h-7 w-7 rounded-none" title="View" data-testid={`pjt-view-${r.id}`}><Eye size={12} /></Button>
                  {canWrite && <Button size="icon" variant="ghost" onClick={() => openEdit(r)} className="h-7 w-7 rounded-none" title="Edit" data-testid={`pjt-edit-${r.id}`}><Edit3 size={12} /></Button>}
                  {canWrite && <Button size="icon" variant="ghost" onClick={() => remove(r)} className="h-7 w-7 rounded-none hover:text-red-700" title="Delete" data-testid={`pjt-del-${r.id}`}><Trash2 size={12} /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit — grouped sections */}
      <Dialog open={openForm} onOpenChange={(o) => !o && (setOpenForm(false), setEditing(null))}>
        <DialogContent className="rounded-none max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="pjt-form">
          <DialogHeader><DialogTitle className="font-heading">{editing?.id ? "Edit Batch" : "Add New Batch"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              {SECTIONS.map((sec) => (
                <div key={sec.title}>
                  <div className="overline mb-2 border-b border-[var(--border)] pb-1">{sec.title}</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {sec.fields.map((f) => (
                      <div key={f.k}>
                        <Label className="overline text-[10px]">{f.l}</Label>
                        <Input type={f.type || "text"} value={editing[f.k] ?? ""} onChange={(e) => setEditing({ ...editing, [f.k]: e.target.value })} className="rounded-none" data-testid={`pjt-inp-${f.k}`} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {/* Live auto-calc preview */}
              <div className="border-l-4 border-emerald-500 bg-emerald-50/40 p-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs" data-testid="pjt-autocalc-preview">
                {[
                  ["Certification %", editing.total_enrolled ? Math.round(((editing.total_certified || 0) / editing.total_enrolled) * 100) : 0],
                  ["Placement %", editing.total_certified ? Math.round(((editing.num_placement || 0) / editing.total_certified) * 100) : 0],
                  ["Achievement %", editing.total_target ? Math.round(((editing.total_certified || 0) / editing.total_target) * 100) : 0],
                  ["Dropout %", editing.total_enrolled ? Math.round(((editing.total_dropout || 0) / editing.total_enrolled) * 100) : 0],
                  ["Remaining Target", Math.max(0, (Number(editing.total_target) || 0) - (Number(editing.total_enrolled) || 0))],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="overline text-[9px]">{l}</div>
                    <div className="font-heading font-black text-emerald-700">{typeof v === "number" ? (String(l).includes("%") ? `${v}%` : v) : v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenForm(false); setEditing(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={save} disabled={saving} className="brand-btn rounded-none" data-testid="pjt-save">{saving ? "Saving…" : (editing?.id ? "Save changes" : "Add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="rounded-none max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="pjt-view-dlg">
          {viewing && (
            <>
              <DialogHeader><DialogTitle className="font-heading">{viewing.batch_id || viewing.center_name}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                <div className="swiss-card p-2"><div className="overline text-[9px]">Certif %</div><div className="text-emerald-700 font-bold text-lg">{viewing.certification_pct}%</div></div>
                <div className="swiss-card p-2"><div className="overline text-[9px]">Place %</div><div className="text-blue-700 font-bold text-lg">{viewing.placement_pct}%</div></div>
                <div className="swiss-card p-2"><div className="overline text-[9px]">Achievement %</div><div className="text-[var(--brand)] font-bold text-lg">{viewing.achievement_pct}%</div></div>
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

      {/* Bulk upload */}
      <Dialog open={bulkOpen} onOpenChange={(o) => !o && closeBulk()}>
        <DialogContent className="rounded-none max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="pjt-bulk-dlg">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><Upload size={16} /> Bulk Upload — Project Summary</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="border-l-4 border-[var(--brand)] bg-blue-50/40 p-3">
              <div className="font-bold flex items-center gap-2"><FileSpreadsheet size={14} /> Step 1 · Download template</div>
              <p className="text-xs text-[var(--muted)] mt-1">38-column template (Bharno / Satgawan / Kairo Excel format). Duplicate Batch IDs skip.</p>
              <Button variant="outline" onClick={downloadTemplate} className="rounded-none gap-1 mt-2" data-testid="pjt-tmpl-btn"><Download size={12} /> Download Sample Excel</Button>
            </div>
            <div className="border-l-4 border-gray-300 bg-gray-50 p-3">
              <div className="font-bold flex items-center gap-2"><Upload size={14} /> Step 2 · Upload Excel</div>
              <input ref={bulkFileRef} type="file" accept=".xlsx,.xls" className="mt-2 text-xs block" onChange={(e) => { setBulkFile(e.target.files?.[0] || null); setBulkPreview(null); }} data-testid="pjt-bulk-file" />
              {bulkFile && <div className="text-xs text-[var(--muted)] mt-1">Selected: <span className="font-mono">{bulkFile.name}</span> ({Math.round(bulkFile.size / 1024)} KB)</div>}
              <div className="flex gap-2 mt-2">
                <Button onClick={runBulkPreview} disabled={!bulkFile || bulkBusy} className="brand-btn rounded-none" data-testid="pjt-bulk-preview">{bulkBusy && !bulkPreview ? "Validating…" : "Preview"}</Button>
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
                      <thead className="bg-red-100 sticky top-0"><tr>
                        <th className="p-1.5 text-left">Row</th><th className="p-1.5 text-left">Reason</th><th className="p-1.5 text-left">Batch ID</th>
                      </tr></thead>
                      <tbody>
                        {bulkPreview.errors.map((er, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="p-1.5 font-mono">{er.row}</td>
                            <td className="p-1.5 text-red-800"><XCircle size={11} className="inline mr-1" />{er.reason}</td>
                            <td className="p-1.5 font-mono">{er.data?.batch_id || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bulkPreview.valid_rows?.length > 0 && (
                  <div className="border border-emerald-200 max-h-64 overflow-y-auto">
                    <table className="w-max min-w-full text-[11px]">
                      <thead className="bg-emerald-100 sticky top-0"><tr>
                        <th className="p-1.5 text-left">Row</th>
                        <th className="p-1.5 text-left">Batch ID</th>
                        <th className="p-1.5 text-left">Center</th>
                        <th className="p-1.5 text-left">Project</th>
                        <th className="p-1.5 text-left">FY</th>
                        <th className="p-1.5 text-left">Job Role</th>
                        <th className="p-1.5 text-right">Target</th>
                        <th className="p-1.5 text-right">Enrolled</th>
                        <th className="p-1.5 text-right">Certified</th>
                        <th className="p-1.5 text-left">Status</th>
                      </tr></thead>
                      <tbody>
                        {bulkPreview.valid_rows.map((v) => (
                          <tr key={v.row} className="border-t border-emerald-100">
                            <td className="p-1.5 font-mono">{v.row}</td>
                            <td className="p-1.5 font-mono font-bold">{v.data.batch_id || "—"}</td>
                            <td className="p-1.5">{v.data.center_name}</td>
                            <td className="p-1.5">{v.data.project}</td>
                            <td className="p-1.5">{v.data.target_year || "—"}</td>
                            <td className="p-1.5">{v.data.job_role || "—"}</td>
                            <td className="p-1.5 text-right">{num(v.data.total_target)}</td>
                            <td className="p-1.5 text-right">{num(v.data.total_enrolled)}</td>
                            <td className="p-1.5 text-right">{num(v.data.total_certified)}</td>
                            <td className="p-1.5">{statusChip(v.data.status)}</td>
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
            <Button onClick={confirmBulk} disabled={!bulkPreview || bulkPreview.valid === 0 || bulkBusy} className="brand-btn rounded-none gap-2" data-testid="pjt-bulk-confirm">
              <Upload size={13} /> {bulkBusy && bulkPreview ? "Uploading…" : `Upload ${bulkPreview?.valid || 0} Batch${(bulkPreview?.valid || 0) === 1 ? "" : "es"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

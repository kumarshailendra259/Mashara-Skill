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
 * Project Wise Summary (Phase 2 + Phase 36C — Lifecycle & Locks)
 * ---------------------------------------------------------------
 * Batch-level tracker matching the 38-column reference Excel. Auto-calc badges:
 *   Certification % = certified / enrolled × 100
 *   Placement %     = placement / certified × 100
 *   Achievement %   = certified / total_target × 100
 *   Dropout %       = dropout / enrolled × 100
 *   Remaining Target = max(0, target - enrolled)
 *
 * Phase 36C additions:
 *   • Project / Center / Company / Job Role now dropdowns (from Core ERP)
 *   • Batch Status = 10-state lifecycle (Draft → Closed)
 *   • Per-phase locks (basic / attendance / assessment / placement) auto-set
 *     on server side; UI dims + 🔒 badges corresponding fields.
 */

// Lifecycle states must mirror BATCH_LIFECYCLE_STATES on the backend.
const LIFECYCLE_STATES = [
  "Draft", "Upcoming", "Active", "Training Completed", "Assessment Pending",
  "Assessment Completed", "Certification Pending", "Certified",
  "Placement in Progress", "Closed",
];
const LIFECYCLE_TONES = {
  "Draft":                 "bg-gray-100 text-gray-700 border-gray-300",
  "Upcoming":              "bg-blue-100 text-blue-800 border-blue-300",
  "Active":                "bg-emerald-100 text-emerald-800 border-emerald-300",
  "Training Completed":    "bg-teal-100 text-teal-800 border-teal-300",
  "Assessment Pending":    "bg-amber-100 text-amber-800 border-amber-300",
  "Assessment Completed":  "bg-indigo-100 text-indigo-800 border-indigo-300",
  "Certification Pending": "bg-purple-100 text-purple-800 border-purple-300",
  "Certified":             "bg-emerald-100 text-emerald-900 border-emerald-400",
  "Placement in Progress": "bg-orange-100 text-orange-800 border-orange-300",
  "Closed":                "bg-gray-200 text-gray-700 border-gray-300",
};
// Which phase-lock each field belongs to. Empty/undefined = always editable
// (except explicit read-only). Server enforces this — UI only dims for clarity.
const FIELD_PHASE = {
  // Basic info — locks when batch reaches Active
  serial_no: "basic", state: "basic", territory: "basic", name_of_company: "basic",
  center_name: "basic", center_manager: "basic", project: "basic", target_year: "basic",
  training_type: "basic", total_target: "basic", total_target_fy: "basic",
  remaining_target: "basic", remaining_target_fy: "basic", batch_id: "basic",
  job_role: "basic", start_date: "basic", end_date: "basic",
  sdms_batch_id: "basic", total_enrolled: "basic",
  // Attendance — locks when Training Completed
  attendance_pct: "attendance", total_dropout: "attendance",
  // Assessment — locks when Certification Pending
  assessment_date: "assessment", billing_status: "assessment", total_certified: "assessment",
  assessment_status: "assessment", assessment_agency: "assessment", assessor_name: "assessment",
  assessor_contact: "assessment", actual_present: "assessment", pass_count: "assessment",
  fail_count: "assessment", absent_count: "assessment",
  // Placement — locks only when Closed
  num_placement: "placement", offer_letter_status: "placement",
  placement_month_1: "placement", placement_month_2: "placement",
  placement_month_3: "placement",
};

const SECTIONS = [
  {
    title: "Basic Information", phase: "basic",
    fields: [
      { k: "serial_no", l: "S.No.", type: "number" },
      { k: "project", l: "Project *", type: "select-project" },
      { k: "center_name", l: "Center Name *", type: "select-center" },
      { k: "name_of_company", l: "Name Of Company", type: "select-company" },
      { k: "state", l: "State" },
      { k: "territory", l: "Territory / District" },
      { k: "center_manager", l: "Center Manager" },
      { k: "target_year", l: "Target Year (e.g. 2025-26)" },
      { k: "training_type", l: "Training Type", type: "select", options: ["STT", "RPL"] },
      { k: "total_target", l: "Total Target", type: "number" },
      { k: "remaining_target", l: "Remaining Target (manual)", type: "number" },
      { k: "total_target_fy", l: "Total Target FY-wise", type: "number" },
      { k: "remaining_target_fy", l: "Remaining Target FY-wise", type: "number" },
    ],
  },
  {
    title: "Batch Information", phase: "basic",
    fields: [
      { k: "batch_id", l: "Batch ID *" },
      { k: "job_role", l: "Job Role" },
      { k: "total_enrolled", l: "Total Enrolled", type: "number" },
      { k: "start_date", l: "Start Date", type: "date" },
      { k: "end_date", l: "End Date", type: "date" },
      { k: "lifecycle_status", l: "Batch Status", type: "select-lifecycle" },
      { k: "sdms_batch_id", l: "SDMS Batch ID" },
    ],
  },
  {
    title: "Attendance Monitoring", phase: "attendance",
    hint: "Editable when lifecycle is between Active and Training Completed.",
    fields: [
      { k: "attendance_pct", l: "Attendance %", type: "number" },
      { k: "total_dropout", l: "Total Drop-out", type: "number" },
    ],
  },
  {
    title: "Assessment Information", phase: "assessment",
    hint: "Locks once lifecycle advances to Certification Pending.",
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
    title: "Placement Information", phase: "placement",
    hint: "Editable while lifecycle is Certified → Placement in Progress. Locks on Closed.",
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
const EMPTY = ALL_FIELDS.reduce((a, f) => ({ ...a, [f.k]: "" }), { lifecycle_status: "Draft" });

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
  const [filters, setFilters] = useState({ projects: [], centers: [], territories: [], target_years: [], states: [], statuses: [] });
  // Single Source of Truth: 'live' pulls from Core ERP (Batches/Projects/Centers/Candidates)
  // via /mis/live/* endpoints. 'manual' uses the legacy mis_project_summary overlay.
  const [dataSource, setDataSource] = useState("live");
  const liveMode = dataSource === "live";
  const canWriteEffective = canWrite && !liveMode;

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkFileRef = useRef(null);

  // Phase 36C: Core ERP entity dropdowns (Projects / Centers / Companies) so
  // the operator picks from existing records instead of typing free text.
  const [entProjects, setEntProjects] = useState([]);
  const [entCenters, setEntCenters] = useState([]);
  const [entCompanies, setEntCompanies] = useState([]);
  useEffect(() => {
    // Best-effort: silently ignore role-based 403s (partner/staff can't read entities).
    Promise.all([
      api.get("/entities/project").then((r) => r.data).catch(() => []),
      api.get("/entities/center").then((r) => r.data).catch(() => []),
      api.get("/entities/company").then((r) => r.data).catch(() => []),
    ]).then(([p, c, co]) => {
      setEntProjects(p || []); setEntCenters(c || []); setEntCompanies(co || []);
    });
  }, []);

  // Lifecycle helpers
  const advanceLifecycle = async (row, to) => {
    try {
      await api.patch(`/mis/projects/${row.id}/lifecycle`, null, { params: { to } });
      toast.success(`Batch moved to "${to}"`);
      load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (projectF && projectF !== "all") params.project = projectF;
      if (centerF && centerF !== "all")   params.center = centerF;
      if (statusF && statusF !== "all")   params.status = statusF;
      if (liveMode) {
        // Single Source of Truth: Core ERP-driven aggregation.
        const [rowsRes, optsRes] = await Promise.all([
          api.get("/mis/live/project-summary", { params }),
          api.get("/mis/live/project-summary/filter-options"),
        ]);
        setRows(rowsRes.data || []);
        const o = optsRes.data || {};
        setFilters({
          projects: o.projects || [], centers: o.centers || [],
          territories: o.states || [], states: o.states || [],
          target_years: [], statuses: o.statuses || [],
        });
      } else {
        if (targetYearF && targetYearF !== "all") params.target_year = targetYearF;
        const [rowsRes, optsRes] = await Promise.all([
          api.get("/mis/projects", { params }),
          api.get("/mis/projects/filter-options"),
        ]);
        setRows(rowsRes.data || []);
        setFilters(optsRes.data || { projects: [], centers: [], territories: [], target_years: [] });
      }
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [search, projectF, centerF, statusF, targetYearF, liveMode]);

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
      {/* Data source toggle — Single Source of Truth */}
      <div className="flex items-center gap-3 border-l-4 border-[var(--brand)] bg-indigo-50/50 px-3 py-2" data-testid="pjt-source-strip">
        <div className="overline text-[10px] font-bold">Data Source</div>
        <div className="inline-flex border border-[var(--border)] bg-white">
          <button
            type="button"
            onClick={() => setDataSource("live")}
            className={`px-3 py-1 text-[11px] font-bold uppercase transition-colors ${liveMode ? "bg-emerald-600 text-white" : "text-[var(--muted)] hover:bg-gray-50"}`}
            data-testid="pjt-src-live"
          >● Live · Core ERP</button>
          <button
            type="button"
            onClick={() => setDataSource("manual")}
            className={`px-3 py-1 text-[11px] font-bold uppercase transition-colors ${!liveMode ? "bg-indigo-600 text-white" : "text-[var(--muted)] hover:bg-gray-50"}`}
            data-testid="pjt-src-manual"
          >📝 Manual · MIS Overlay</button>
        </div>
        <div className="text-[11px] text-[var(--muted)] ml-2">
          {liveMode
            ? "Numbers auto-fetch from Batches / Candidates modules — no duplicate entry. Add batches on Programs page."
            : "Legacy MIS overlay — data entered directly here. Only used when Core ERP is not the source of truth."}
        </div>
      </div>

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
        <div className="w-36" style={{ display: liveMode ? "none" : undefined }}>
          <Label className="overline">FY</Label>
          <Select value={targetYearF} onValueChange={setTargetYearF}>
            <SelectTrigger className="rounded-none" data-testid="pjt-fy"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FY</SelectItem>
              {filters.target_years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label className="overline">Status</Label>
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="rounded-none" data-testid="pjt-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {LIFECYCLE_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" onClick={exportExcel} className="rounded-none gap-1" data-testid="pjt-export" disabled={liveMode} title={liveMode ? "Export available only in Manual mode" : ""}><Download size={13} /> Export</Button>
          {canWriteEffective && <Button variant="outline" onClick={() => setBulkOpen(true)} className="rounded-none gap-1" data-testid="pjt-bulk-btn"><Upload size={13} /> Bulk Upload</Button>}
          {canWriteEffective && (
            <a href="/batch-management" className="brand-btn rounded-none gap-1 inline-flex items-center px-3 text-sm" data-testid="pjt-goto-batch-management" title="Batch creation is centralised in Batch Management (Phase 37).">
              <Plus size={13} /> Add Batch →
            </a>
          )}
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
                <td>
                  {(() => {
                    const lc = r.lifecycle_status || r.status || "—";
                    const tone = LIFECYCLE_TONES[lc] || "bg-gray-100 text-gray-600 border-gray-300";
                    return (
                      <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border ${tone}`} data-testid={`pjt-lc-${r.id}`}>{lc}</span>
                    );
                  })()}
                </td>
                <td>
                  <Button size="icon" variant="ghost" onClick={() => setViewing(r)} className="h-7 w-7 rounded-none" title="View" data-testid={`pjt-view-${r.id}`}><Eye size={12} /></Button>
                  {canWriteEffective && <Button size="icon" variant="ghost" onClick={() => openEdit(r)} className="h-7 w-7 rounded-none" title="Edit & lifecycle" data-testid={`pjt-edit-${r.id}`}><Edit3 size={12} /></Button>}
                  {canWriteEffective && <Button size="icon" variant="ghost" onClick={() => remove(r)} className="h-7 w-7 rounded-none hover:text-red-700" title="Delete" data-testid={`pjt-del-${r.id}`}><Trash2 size={12} /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit — grouped sections with phase locks */}
      <Dialog open={openForm} onOpenChange={(o) => !o && (setOpenForm(false), setEditing(null))}>
        <DialogContent className="rounded-none max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="pjt-form">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-3">
              {editing?.id ? "Edit Batch" : "Add New Batch"}
              {editing?.lifecycle_status && (
                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border ${LIFECYCLE_TONES[editing.lifecycle_status] || "bg-gray-100 border-gray-300"}`} data-testid="pjt-form-lifecycle">
                  {editing.lifecycle_status}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              {SECTIONS.map((sec) => {
                const phaseLockKey = sec.phase ? `${sec.phase}_locked` : null;
                const isLocked = !!(phaseLockKey && editing[phaseLockKey]);
                return (
                  <div key={sec.title} className={isLocked ? "opacity-70" : ""}>
                    <div className="overline mb-2 border-b border-[var(--border)] pb-1 flex items-center gap-2">
                      <span>{sec.title}</span>
                      {isLocked && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-bold uppercase" data-testid={`pjt-lock-${sec.phase}`}>
                          🔒 Locked
                        </span>
                      )}
                      {sec.hint && <span className="text-[10px] font-normal text-[var(--muted)] normal-case ml-1">{sec.hint}</span>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {sec.fields.map((f) => {
                        const commonInputProps = {
                          "data-testid": `pjt-inp-${f.k}`,
                          disabled: isLocked,
                          className: "rounded-none",
                        };
                        const setVal = (v) => setEditing({ ...editing, [f.k]: v });
                        // Center dropdown: on change auto-fill state/territory/center_manager from entity meta
                        const onCenterChange = (name) => {
                          const c = entCenters.find((x) => x.name === name);
                          setEditing({
                            ...editing,
                            center_name: name,
                            state: c?.state || editing.state,
                            territory: c?.city || editing.territory,
                            center_manager: c?.manager_name || editing.center_manager,
                          });
                        };
                        return (
                          <div key={f.k}>
                            <Label className="overline text-[10px]">{f.l}</Label>
                            {f.type === "select-project" && (
                              <Select value={editing[f.k] || undefined} onValueChange={setVal} disabled={isLocked}>
                                <SelectTrigger className="rounded-none" data-testid={`pjt-inp-${f.k}`}><SelectValue placeholder="Select project…" /></SelectTrigger>
                                <SelectContent>
                                  {entProjects.length === 0 && <SelectItem value="__none__" disabled>No projects — create in Projects module</SelectItem>}
                                  {entProjects.filter((p) => p.name).map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                            {f.type === "select-center" && (
                              <Select value={editing[f.k] || undefined} onValueChange={onCenterChange} disabled={isLocked}>
                                <SelectTrigger className="rounded-none" data-testid={`pjt-inp-${f.k}`}><SelectValue placeholder="Select center…" /></SelectTrigger>
                                <SelectContent>
                                  {entCenters.length === 0 && <SelectItem value="__none__" disabled>No centers — create in Centers module</SelectItem>}
                                  {entCenters.filter((c) => c.name).map((c) => <SelectItem key={c.id} value={c.name}>{c.name}{c.city ? ` · ${c.city}` : ""}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                            {f.type === "select-company" && (
                              <Select value={editing[f.k] || undefined} onValueChange={setVal} disabled={isLocked}>
                                <SelectTrigger className="rounded-none" data-testid={`pjt-inp-${f.k}`}><SelectValue placeholder="Select company…" /></SelectTrigger>
                                <SelectContent>
                                  {entCompanies.length === 0 && <SelectItem value="__none__" disabled>No companies — create in Companies module</SelectItem>}
                                  {entCompanies.filter((co) => co.name).map((co) => <SelectItem key={co.id} value={co.name}>{co.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                            {f.type === "select-lifecycle" && (
                              <Select value={editing[f.k] || "Draft"} onValueChange={setVal} disabled={isLocked || !editing.id}>
                                <SelectTrigger className="rounded-none" data-testid={`pjt-inp-${f.k}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {LIFECYCLE_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                            {f.type === "select" && (
                              <Select value={editing[f.k] || undefined} onValueChange={setVal} disabled={isLocked}>
                                <SelectTrigger className="rounded-none" data-testid={`pjt-inp-${f.k}`}><SelectValue placeholder="Select…" /></SelectTrigger>
                                <SelectContent>
                                  {(f.options || []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                            {(!f.type || f.type === "text" || f.type === "number" || f.type === "date") && (
                              <Input type={f.type || "text"} value={editing[f.k] ?? ""} onChange={(e) => setVal(e.target.value)} {...commonInputProps} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Lifecycle advance action bar (edit mode only) */}
              {editing?.id && (
                <div className="border-l-4 border-blue-500 bg-blue-50/40 p-3" data-testid="pjt-lifecycle-actions">
                  <div className="overline text-[10px] mb-1">Lifecycle actions</div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {LIFECYCLE_STATES.map((s) => {
                      const isCurrent = s === (editing.lifecycle_status || "Draft");
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={isCurrent || saving}
                          onClick={() => advanceLifecycle({ id: editing.id }, s)}
                          className={`px-2 py-1 border text-[10px] font-bold uppercase transition-colors ${isCurrent ? `${LIFECYCLE_TONES[s]} cursor-default` : "hover:bg-blue-100 border-blue-300 text-blue-800 bg-white"}`}
                          data-testid={`pjt-lc-btn-${s.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          {s}{isCurrent && " ●"}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-[var(--muted)] mt-2">
                    Advancing changes lock flags on the server. Only Admin can roll back.
                  </div>
                </div>
              )}

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

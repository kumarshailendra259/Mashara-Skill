import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Upload, Download, Trash2, Edit3, Eye, RotateCcw, FileSpreadsheet, Users2, X, ArchiveRestore,
} from "lucide-react";

/* ------------------------------------------------------------------
   Column specs — MUST match backend BOCWW_COLUMNS / JSDMS_COLUMNS.
   Adding required=true flag drives the * marker + client-side check.
   ------------------------------------------------------------------ */
const BOCWW_FIELDS = [
  { key: "s_no", label: "S.No.", required: true },
  { key: "batch_id", label: "Batch ID", required: true },
  { key: "candidate_id", label: "Candidate ID", required: true },
  { key: "name", label: "Candidate Name", required: true },
  { key: "father_or_husband_name", label: "Father's / Husband Name", required: true },
  { key: "mother_name", label: "Mother's Name", required: true },
  { key: "aadhaar", label: "Candidate Aadhaar No.", required: true, digits: true, len: 12 },
  { key: "registered_labour_name", label: "Registered Labour Name", required: true },
  { key: "registered_labour_aadhaar", label: "Registered Labour Aadhaar No.", required: true, digits: true, len: 12 },
  { key: "relation_with_labour", label: "Relation with Registered Labour", required: true },
  { key: "labour_reg_no", label: "Labour Registration No.", required: true },
  { key: "id_card_valid_upto", label: "ID Card Valid Upto", required: true, type: "date" },
  { key: "labour_card_issue_date", label: "Labour Card Issue Date", required: true, type: "date" },
  { key: "date_of_birth", label: "Date of Birth", required: true, type: "date" },
  { key: "gender", label: "Gender", required: true, type: "select", options: [
    { v: "M", label: "Male" }, { v: "F", label: "Female" }, { v: "T", label: "Transgender" },
  ] },
  { key: "category", label: "Category", required: true },
  { key: "address", label: "Full Address", required: true, multi: true },
  { key: "mobile", label: "Mobile No.", required: true, digits: true, len: 10 },
  { key: "education", label: "Education", required: true },
  { key: "physically_handicapped", label: "Physically Handicapped", required: true, type: "select", options: [
    { v: "No", label: "No" }, { v: "Yes", label: "Yes" },
  ] },
  { key: "course_code", label: "Course Code", required: true, section: "course" },
  { key: "course_duration_hours", label: "Course Duration (Hours)", required: true, section: "course" },
  { key: "end_time", label: "End Time", required: true, section: "course" },
  { key: "state", label: "State", required: true, section: "course" },
  { key: "district", label: "District", required: true, section: "course" },
  { key: "batch", label: "Batch", required: true, section: "course" },
  { key: "course", label: "Course", required: true, section: "course" },
];

const JSDMS_FIELDS = [
  { key: "name", label: "Candidate Name", required: true },
  { key: "father_name", label: "Father's Name", required: true },
  { key: "aadhaar", label: "Aadhaar Number", required: true, digits: true, len: 12 },
  { key: "mobile", label: "Mobile Number", required: true, digits: true, len: 10 },
  { key: "aadhaar_linked_mobile", label: "Aadhaar Linked Mobile Number", required: true, digits: true, len: 10 },
  { key: "date_of_birth", label: "Date of Birth", required: true, type: "date" },
  { key: "course_name", label: "Course Name", required: true },
  { key: "education", label: "Education", required: true },
  { key: "address", label: "Full Address", required: true, multi: true },
  { key: "batch", label: "Batch", required: true },
  { key: "district", label: "District", required: true },
];

const PROJECT_FIELDS = { BOCWW: BOCWW_FIELDS, JSDMS: JSDMS_FIELDS };

/* Utility: file download from a blob response */
const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove(); window.URL.revokeObjectURL(url);
};

export default function Candidates() {
  const { user } = useAuth();
  const canManage = ["admin", "hr", "manager", "center_manager", "partner"].includes(user?.role);

  // Filters + list state
  const [project, setProject] = useState("BOCWW");
  const [batch, setBatch] = useState("all");
  const [district, setDistrict] = useState("all");
  const [course, setCourse] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState({ batches: [], districts: [], courses: [] });

  // Dialog state
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);   // record when editing; null = new
  const [viewing, setViewing] = useState(null);   // read-only viewer
  const [openBulk, setOpenBulk] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const bulkFileRef = useRef(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        project,
        page: String(page),
        page_size: String(pageSize),
        include_deleted: String(includeDeleted),
      });
      if (batch !== "all") params.set("batch", batch);
      if (district !== "all") params.set("district", district);
      if (course !== "all") params.set("course", course);
      if (search) params.set("search", search);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const { data } = await api.get(`/candidates?${params.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [project, batch, district, course, search, dateFrom, dateTo, includeDeleted, page, pageSize]);

  const loadOptions = useCallback(async () => {
    try {
      const { data } = await api.get(`/candidates/filter-options?project=${project}`);
      setOptions({ batches: data.batches || [], districts: data.districts || [], courses: data.courses || [] });
    } catch { /* soft-fail */ }
  }, [project]);

  useEffect(() => { setPage(1); }, [project, batch, district, course, dateFrom, dateTo, includeDeleted]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  const activeFields = PROJECT_FIELDS[project];

  /* ---------- Add / Edit ---------- */
  const openAdd = () => { setEditing({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing({ ...row }); setOpenForm(true); };

  const saveCandidate = async () => {
    // Client-side validation
    const missing = activeFields.filter((f) => f.required && !String(editing?.[f.key] || "").trim());
    if (missing.length) {
      toast.error(`Please fill: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    // Aadhaar / mobile length checks (warn only if provided)
    for (const f of activeFields) {
      const v = String(editing?.[f.key] || "").trim();
      if (v && f.digits && !/^\d+$/.test(v)) {
        toast.error(`${f.label} must contain digits only`); return;
      }
      if (v && f.len && v.length !== f.len) {
        toast.error(`${f.label} must be exactly ${f.len} digits`); return;
      }
    }
    try {
      const payload = { project, ...editing };
      if (editing?.id) {
        await api.patch(`/candidates/${editing.id}`, payload);
        toast.success("Candidate updated");
      } else {
        await api.post("/candidates", payload);
        toast.success("Candidate added");
      }
      setOpenForm(false); setEditing(null);
      loadList(); loadOptions();
    } catch (e) { toast.error(formatError(e)); }
  };

  const removeCandidate = async (row) => {
    if (!window.confirm(`Delete candidate "${row.name}"? This can be restored later.`)) return;
    try {
      await api.delete(`/candidates/${row.id}`);
      toast.success("Deleted (soft) — enable 'Include archived' to restore");
      loadList();
    } catch (e) { toast.error(formatError(e)); }
  };

  const restoreCandidate = async (row) => {
    try {
      await api.patch(`/candidates/${row.id}/restore`);
      toast.success("Restored");
      loadList();
    } catch (e) { toast.error(formatError(e)); }
  };

  /* ---------- Export ---------- */
  const exportExcel = async () => {
    try {
      const params = new URLSearchParams({ project });
      if (batch !== "all") params.set("batch", batch);
      if (district !== "all") params.set("district", district);
      if (course !== "all") params.set("course", course);
      if (search) params.set("search", search);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await api.get(`/candidates/export?${params.toString()}`, { responseType: "blob" });
      downloadBlob(res.data, `candidates_${project.toLowerCase()}_${Date.now()}.xlsx`);
      toast.success("Export ready");
    } catch (e) { toast.error(formatError(e)); }
  };

  /* ---------- Sample download ---------- */
  const downloadSample = async () => {
    try {
      const res = await api.get(`/candidates/sample-excel?project=${project}`, { responseType: "blob" });
      downloadBlob(res.data, `${project}_candidate_sample.xlsx`);
    } catch (e) { toast.error(formatError(e)); }
  };

  /* ---------- Bulk upload ---------- */
  const doBulkUpload = async () => {
    if (!bulkFile) { toast.error("Please choose an Excel file first"); return; }
    setBulkBusy(true); setBulkResult(null);
    try {
      const fd = new FormData(); fd.append("file", bulkFile);
      const { data } = await api.post(`/candidates/bulk-upload?project=${project}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setBulkResult(data);
      toast.success(`Uploaded ${data.uploaded} of ${data.total_rows} rows`);
      loadList(); loadOptions();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };

  const resetFilters = () => {
    setBatch("all"); setDistrict("all"); setCourse("all"); setSearch(""); setDateFrom(""); setDateTo("");
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4" data-testid="candidates-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">Programs · Candidates</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">Candidate Data Management</h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            Project-wise candidate roster with bulk Excel upload / download and duplicate detection.
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadSample} className="rounded-none gap-2" data-testid="btn-sample-excel">
              <FileSpreadsheet size={14} /> Sample Format
            </Button>
            <Button variant="outline" onClick={exportExcel} className="rounded-none gap-2" data-testid="btn-export-excel">
              <Download size={14} /> Export Excel
            </Button>
            <Button variant="outline" onClick={() => { setBulkResult(null); setBulkFile(null); setOpenBulk(true); }} className="rounded-none gap-2" data-testid="btn-bulk-upload">
              <Upload size={14} /> Bulk Upload
            </Button>
            <Button onClick={openAdd} className="brand-btn rounded-none gap-2" data-testid="btn-add-candidate">
              <Plus size={16} /> Add Candidate
            </Button>
          </div>
        )}
      </div>

      {/* Project switcher */}
      <div className="swiss-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="overline">Project</div>
          <div className="text-[10px] text-[var(--muted)]">Different projects, different field configurations.</div>
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          {["BOCWW", "JSDMS"].map((p) => (
            <button
              key={p}
              onClick={() => setProject(p)}
              className={`border p-3 text-left transition-colors ${project === p ? "border-[var(--brand)] bg-blue-50" : "border-[var(--border)] bg-white hover:bg-gray-50"}`}
              data-testid={`project-${p}`}
            >
              <div className="font-heading font-bold text-lg">{p}</div>
              <div className="text-xs text-[var(--muted)]">
                {p === "BOCWW" ? "27 fields · labour/registration-heavy roster" : "11 fields · lean candidate roster"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="swiss-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <Label className="overline">Batch</Label>
            <Select value={batch} onValueChange={setBatch}>
              <SelectTrigger className="rounded-none" data-testid="filter-batch"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batches</SelectItem>
                {options.batches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">District</Label>
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger className="rounded-none" data-testid="filter-district"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {options.districts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">Course</Label>
            <Select value={course} onValueChange={setCourse}>
              <SelectTrigger className="rounded-none" data-testid="filter-course"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Courses</SelectItem>
                {options.courses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="lg:col-span-2">
            <Label className="overline">Search</Label>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name / Aadhaar / Mobile / ID" className="rounded-none pl-7" data-testid="filter-search" />
            </div>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={resetFilters} className="rounded-none w-full gap-1" data-testid="filter-reset"><X size={12} /> Reset</Button>
          </div>
          <div>
            <Label className="overline">Created From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-none" />
          </div>
          <div>
            <Label className="overline">Created To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-none" />
          </div>
          <div className="flex items-end col-span-1 md:col-span-2 lg:col-span-4">
            <label className="text-xs flex items-center gap-2 text-[var(--muted)]">
              <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} data-testid="filter-include-deleted" />
              Include archived (soft-deleted)
            </label>
          </div>
        </div>
      </div>

      {/* Results table */}
      <div className="swiss-card overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
          <div className="overline flex items-center gap-2">
            <Users2 size={12} /> {project} Candidates
          </div>
          <div className="text-xs text-[var(--muted)] num">
            {loading ? "Loading…" : `${total} record${total === 1 ? "" : "s"}`}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-[var(--border)] overline">
              {project === "BOCWW" ? (
                <>
                  <th className="text-left p-3">Candidate ID</th>
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3">Aadhaar</th>
                  <th className="text-left p-3">Mobile</th>
                  <th className="text-left p-3">Batch</th>
                  <th className="text-left p-3">District</th>
                  <th className="text-left p-3">Course</th>
                </>
              ) : (
                <>
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3">Aadhaar</th>
                  <th className="text-left p-3">Mobile</th>
                  <th className="text-left p-3">Course</th>
                  <th className="text-left p-3">Batch</th>
                  <th className="text-left p-3">District</th>
                </>
              )}
              <th className="text-right p-3 w-52 no-print">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-[var(--muted)] text-xs">
                {loading ? "Loading candidates…" : "No candidates found — try clearing filters or add a new one."}
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className={`border-b border-[var(--border)] hover:bg-gray-50 ${r.is_deleted ? "opacity-60 italic" : ""}`} data-testid={`row-${r.id}`}>
                {project === "BOCWW" ? (
                  <>
                    <td className="p-3 font-mono text-xs">{r.candidate_id || "—"}</td>
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3 font-mono text-xs">{r.aadhaar || "—"}</td>
                    <td className="p-3 num">{r.mobile || "—"}</td>
                    <td className="p-3">{r.batch || "—"}</td>
                    <td className="p-3">{r.district || "—"}</td>
                    <td className="p-3">{r.course || r.course_name || "—"}</td>
                  </>
                ) : (
                  <>
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3 font-mono text-xs">{r.aadhaar || "—"}</td>
                    <td className="p-3 num">{r.mobile || "—"}</td>
                    <td className="p-3">{r.course_name || "—"}</td>
                    <td className="p-3">{r.batch || "—"}</td>
                    <td className="p-3">{r.district || "—"}</td>
                  </>
                )}
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" onClick={() => setViewing(r)} className="h-8 w-8 rounded-none" title="View" data-testid={`view-${r.id}`}><Eye size={14} /></Button>
                    {canManage && !r.is_deleted && (
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)} className="h-8 w-8 rounded-none" title="Edit" data-testid={`edit-${r.id}`}><Edit3 size={14} /></Button>
                    )}
                    {canManage && r.is_deleted && (
                      <Button size="icon" variant="ghost" onClick={() => restoreCandidate(r)} className="h-8 w-8 rounded-none text-emerald-600" title="Restore" data-testid={`restore-${r.id}`}><ArchiveRestore size={14} /></Button>
                    )}
                    {canManage && !r.is_deleted && (
                      <Button size="icon" variant="ghost" onClick={() => removeCandidate(r)} className="h-8 w-8 rounded-none hover:text-[var(--danger)]" title="Delete" data-testid={`del-${r.id}`}><Trash2 size={14} /></Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] text-xs">
            <div className="text-[var(--muted)]">Page {page} of {totalPages}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-none h-7 px-2">Previous</Button>
              <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-none h-7 px-2">Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- Add / Edit dialog ---------------- */}
      <Dialog open={openForm} onOpenChange={(o) => { if (!o) { setOpenForm(false); setEditing(null); } }}>
        <DialogContent className="rounded-none max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="candidate-form">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editing?.id ? "Edit" : "New"} {project} Candidate
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              {project === "BOCWW" && (
                <div className="border border-blue-200 bg-blue-50/50 p-3">
                  <div className="overline mb-2">Batch / Course Meta</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {activeFields.filter((f) => f.section === "course").map((f) => (
                      <FieldRenderer key={f.key} f={f} value={editing[f.key] || ""} onChange={(v) => setEditing((e) => ({ ...e, [f.key]: v }))} />
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeFields.filter((f) => f.section !== "course").map((f) => (
                  <FieldRenderer key={f.key} f={f} value={editing[f.key] || ""} onChange={(v) => setEditing((e) => ({ ...e, [f.key]: v }))} />
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenForm(false); setEditing(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={saveCandidate} className="brand-btn rounded-none" data-testid="candidate-save">{editing?.id ? "Save changes" : "Add candidate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- View dialog ---------------- */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="rounded-none max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="candidate-view">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {viewing?.name} <span className="text-xs text-[var(--muted)] font-normal">({viewing?.project})</span>
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {PROJECT_FIELDS[viewing.project || project].map((f) => (
                <div key={f.key}>
                  <div className="overline text-[10px]">{f.label}</div>
                  <div className={`mt-0.5 ${f.digits ? "font-mono text-xs" : ""}`}>{viewing[f.key] || "—"}</div>
                </div>
              ))}
              <div className="md:col-span-2 border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted)] flex flex-wrap gap-3">
                <span>Added: {viewing.created_at ? new Date(viewing.created_at).toLocaleString() : "—"}</span>
                {viewing.updated_at && <span>Updated: {new Date(viewing.updated_at).toLocaleString()}</span>}
                {viewing.is_deleted && <span className="text-red-600 font-medium">Archived</span>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------------- Bulk upload dialog ---------------- */}
      <Dialog open={openBulk} onOpenChange={setOpenBulk}>
        <DialogContent className="rounded-none max-w-lg" data-testid="bulk-upload-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Bulk Upload — {project}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="border border-blue-200 bg-blue-50 p-3 text-xs">
              <div className="font-medium">Strict header format required.</div>
              <div className="text-[var(--muted)] mt-0.5">Download the sample Excel below → fill your rows → upload. Duplicates on Aadhaar / Candidate ID inside the same project will be skipped.</div>
              <Button variant="outline" size="sm" onClick={downloadSample} className="rounded-none mt-2 gap-2" data-testid="btn-bulk-sample">
                <Download size={12} /> Download {project} Sample
              </Button>
            </div>
            <div>
              <Label className="overline">Excel File (.xlsx, max 20 MB)</Label>
              <input
                ref={bulkFileRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(e) => { setBulkFile(e.target.files?.[0] || null); setBulkResult(null); }}
                className="block w-full text-sm mt-1"
                data-testid="bulk-file-input"
              />
              {bulkFile && <div className="text-xs text-[var(--brand)] mt-1">{bulkFile.name} · {(bulkFile.size / 1024).toFixed(0)} KB</div>}
            </div>

            {bulkResult && (
              <div className="border border-[var(--border)] p-3 text-xs space-y-2" data-testid="bulk-result">
                <div className="grid grid-cols-4 gap-2">
                  <SummaryBlock label="Rows" value={bulkResult.total_rows} />
                  <SummaryBlock label="Uploaded" value={bulkResult.uploaded} color="text-emerald-700" />
                  <SummaryBlock label="Duplicate" value={bulkResult.duplicate} color="text-amber-700" />
                  <SummaryBlock label="Failed" value={bulkResult.failed} color="text-red-700" />
                </div>
                {(bulkResult.errors || []).length > 0 && (
                  <div>
                    <div className="overline text-[10px]">Row-level issues (first 200)</div>
                    <ul className="max-h-40 overflow-y-auto mt-1 space-y-0.5">
                      {bulkResult.errors.map((e, idx) => (
                        <li key={idx} className="border-l-2 border-red-300 pl-2 text-red-700 leading-tight">
                          <span className="font-mono">Row {e.row}:</span> {e.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenBulk(false)} className="rounded-none">{bulkResult ? "Close" : "Cancel"}</Button>
            {!bulkResult && (
              <Button onClick={doBulkUpload} disabled={bulkBusy || !bulkFile} className="brand-btn rounded-none gap-2" data-testid="btn-bulk-upload-submit">
                {bulkBusy ? "Uploading…" : (<><Upload size={14} /> Upload</>)}
              </Button>
            )}
            {bulkResult && (
              <Button variant="outline" onClick={() => { setBulkFile(null); setBulkResult(null); if (bulkFileRef.current) bulkFileRef.current.value = ""; }} className="rounded-none gap-2">
                <RotateCcw size={12} /> Upload another
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Field renderer for form ---------------- */
function FieldRenderer({ f, value, onChange }) {
  if (f.type === "select") {
    return (
      <div>
        <Label className="overline">{f.label}{f.required && <span className="text-[var(--danger)]">*</span>}</Label>
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className="rounded-none" data-testid={`field-${f.key}`}><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {f.options.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (f.multi) {
    return (
      <div className="md:col-span-2">
        <Label className="overline">{f.label}{f.required && <span className="text-[var(--danger)]">*</span>}</Label>
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} className="rounded-none" rows={2} data-testid={`field-${f.key}`} />
      </div>
    );
  }
  if (f.type === "date") {
    return (
      <div>
        <Label className="overline">{f.label}{f.required && <span className="text-[var(--danger)]">*</span>}</Label>
        <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="rounded-none" data-testid={`field-${f.key}`} />
      </div>
    );
  }
  return (
    <div>
      <Label className="overline">{f.label}{f.required && <span className="text-[var(--danger)]">*</span>}</Label>
      <Input
        value={value}
        onChange={(e) => {
          let v = e.target.value;
          if (f.digits) v = v.replace(/\D+/g, "");
          if (f.len && v.length > f.len) v = v.slice(0, f.len);
          onChange(v);
        }}
        className={`rounded-none ${f.digits ? "font-mono" : ""}`}
        maxLength={f.len ? f.len + 2 : undefined}
        data-testid={`field-${f.key}`}
      />
    </div>
  );
}

function SummaryBlock({ label, value, color = "" }) {
  return (
    <div className="border border-[var(--border)] p-2 text-center">
      <div className={`text-lg font-heading font-black leading-none ${color}`}>{value ?? 0}</div>
      <div className="text-[9px] overline mt-0.5">{label}</div>
    </div>
  );
}

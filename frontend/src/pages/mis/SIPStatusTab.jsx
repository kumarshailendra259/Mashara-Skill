import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Plus, Search, Trash2, Edit3, Eye, Upload, Download, FileSpreadsheet,
  X, CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";

const FIELDS = [
  { key: "serial_no",            label: "S.No.",                 type: "number" },
  { key: "center_name",          label: "Center Name",            required: true },
  { key: "center_id_code",       label: "Center ID",              required: true },
  { key: "state",                label: "State" },
  { key: "accreditation_date",   label: "Accreditation Date",     type: "date" },
  { key: "status",               label: "Status" },
  { key: "last_inspection_date", label: "Last Inspection Date",   type: "date" },
  { key: "center_rating",        label: "Center Rating" },
  { key: "work_order_value",     label: "Value of Work Order",    type: "number" },
  { key: "bg_submitted_amount",  label: "BG Submitted Amount",    type: "number" },
  { key: "bg_validity_date",     label: "BG Validity Date",       type: "date" },
  { key: "branch_start_date",    label: "Date of Branch Start",   type: "date" },
  { key: "job_role_on_caaf",     label: "Job Role on CAAF",       long: true },
  { key: "job_role_to_be_added", label: "Job Role to be added",   long: true },
];
const EMPTY = FIELDS.reduce((a, f) => ({ ...a, [f.key]: "" }), {});

const STATUS_TONES = {
  accredited: "bg-emerald-100 text-emerald-800 border-emerald-300",
  active:     "bg-emerald-100 text-emerald-800 border-emerald-300",
  pending:    "bg-amber-100  text-amber-800  border-amber-300",
  expired:    "bg-red-100    text-red-800    border-red-300",
  inactive:   "bg-gray-100   text-gray-700   border-gray-300",
};
const inr = (n) => n == null ? "—" : Number(n).toLocaleString("en-IN");

function statusChip(status) {
  const s = (status || "").trim().toLowerCase();
  const tone = STATUS_TONES[s] || "bg-gray-100 text-gray-700 border-gray-300";
  return <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border ${tone}`}>{status || "—"}</span>;
}

function daysLeft(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso) - new Date()) / (1000 * 60 * 60 * 24));
}

export default function SIPStatusTab({ canWrite, onChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);

  // Bulk
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
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      const { data } = await api.get("/mis/sip-centers", { params });
      setRows(data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing({ ...EMPTY }); setOpenForm(true); };
  const openEdit = (row) => { setEditing({ ...EMPTY, ...row }); setOpenForm(true); };

  const save = async () => {
    if (!editing?.center_name?.trim()) return toast.error("Center Name required");
    if (!editing?.center_id_code?.trim()) return toast.error("Center ID required");
    setSaving(true);
    try {
      const payload = { ...editing };
      if (editing.id) await api.patch(`/mis/sip-centers/${editing.id}`, payload);
      else            await api.post("/mis/sip-centers", payload);
      toast.success(editing.id ? "SIP center updated" : "SIP center added");
      setOpenForm(false); setEditing(null);
      load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete SIP center "${row.center_name}"?`)) return;
    try {
      await api.delete(`/mis/sip-centers/${row.id}`);
      toast.success("Deleted");
      load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
  };

  // --- Bulk helpers ---
  const downloadTemplate = async () => {
    try {
      const r = await api.get("/mis/sip-centers/sample-excel", { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = "sip_status_template.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };
  const exportExcel = async () => {
    try {
      const r = await api.get("/mis/sip-centers/export", { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = "sip_status_export.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };
  const runBulkPreview = async () => {
    if (!bulkFile) return toast.error("Choose an Excel file");
    setBulkBusy(true); setBulkPreview(null);
    try {
      const fd = new FormData(); fd.append("file", bulkFile);
      const r = await api.post("/mis/sip-centers/bulk-preview", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setBulkPreview(r.data);
      if (r.data.valid === 0) toast.error("No valid rows in file");
      else toast.success(`${r.data.valid} valid · ${r.data.failed} failed — review before upload`);
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };
  const confirmBulk = async () => {
    if (!bulkFile || !bulkPreview || bulkPreview.valid === 0) return;
    setBulkBusy(true);
    try {
      const fd = new FormData(); fd.append("file", bulkFile);
      const r = await api.post("/mis/sip-centers/bulk-upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Uploaded ${r.data.uploaded}, skipped ${r.data.failed}`);
      closeBulk(); load(); onChange && onChange();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };
  const closeBulk = () => {
    setBulkOpen(false); setBulkFile(null); setBulkPreview(null);
    if (bulkFileRef.current) bulkFileRef.current.value = "";
  };

  const alertCount = useMemo(() => rows.filter((r) => {
    const d = daysLeft(r.bg_validity_date);
    return d !== null && d <= 30;
  }).length, [rows]);

  return (
    <div className="space-y-4" data-testid="mis-sip-tab">
      {/* Action bar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2 max-w-2xl">
          <div className="md:col-span-2">
            <Label className="overline">Search</Label>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Center name / ID / job role" className="rounded-none pl-7" data-testid="sip-search" />
            </div>
          </div>
          <div>
            <Label className="overline">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="rounded-none" data-testid="sip-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Accredited">Accredited</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Expired">Expired</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportExcel} className="rounded-none gap-1" data-testid="sip-export">
            <Download size={13} /> Export
          </Button>
          {canWrite && <Button variant="outline" onClick={() => setBulkOpen(true)} className="rounded-none gap-1" data-testid="sip-bulk-btn">
            <Upload size={13} /> Bulk Upload
          </Button>}
          {canWrite && <Button onClick={openAdd} className="brand-btn rounded-none gap-1" data-testid="sip-add-btn">
            <Plus size={13} /> Add SIP Center
          </Button>}
        </div>
      </div>

      {/* BG expiry alert banner */}
      {alertCount > 0 && (
        <div className="border-l-4 border-red-500 bg-red-50 p-3 flex items-center gap-2 text-sm" data-testid="sip-bg-alert">
          <AlertTriangle size={16} className="text-red-600" />
          <span><b>{alertCount}</b> SIP center{alertCount > 1 ? "s have" : " has"} BG expiring within 30 days or already expired — highlighted below.</span>
        </div>
      )}

      {/* Table */}
      <div className="swiss-card overflow-x-auto" data-testid="sip-table">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-gray-50 border-b border-[var(--border)]">
            <tr>
              <th className="p-2 text-left overline text-[10px]">Center</th>
              <th className="p-2 text-left overline text-[10px]">Center ID</th>
              <th className="p-2 text-left overline text-[10px]">State</th>
              <th className="p-2 text-left overline text-[10px]">Status</th>
              <th className="p-2 text-left overline text-[10px]">Rating</th>
              <th className="p-2 text-right overline text-[10px]">WO Value</th>
              <th className="p-2 text-right overline text-[10px]">BG Amount</th>
              <th className="p-2 text-left overline text-[10px]">BG Validity</th>
              <th className="p-2 text-left overline text-[10px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-[var(--muted)]">No SIP centers yet — add one or bulk-upload an Excel.</td></tr>}
            {rows.map((r) => {
              const dl = daysLeft(r.bg_validity_date);
              const bgTone = dl == null ? "" : dl < 0 ? "text-red-700 font-bold" : dl <= 30 ? "text-amber-700 font-bold" : "";
              return (
                <tr key={r.id} className="border-t border-[var(--border)] hover:bg-gray-50" data-testid={`sip-row-${r.id}`}>
                  <td className="p-2 font-semibold">{r.center_name}</td>
                  <td className="p-2 font-mono text-xs">{r.center_id_code}</td>
                  <td className="p-2">{r.state || "—"}</td>
                  <td className="p-2">{statusChip(r.status)}</td>
                  <td className="p-2 text-xs">{r.center_rating || "—"}</td>
                  <td className="p-2 text-right">{inr(r.work_order_value)}</td>
                  <td className="p-2 text-right">{inr(r.bg_submitted_amount)}</td>
                  <td className={`p-2 ${bgTone}`}>
                    {r.bg_validity_date || "—"}
                    {dl != null && dl >= 0 && dl <= 30 && <span className="ml-1 text-[10px]">({dl}d)</span>}
                    {dl != null && dl < 0 && <span className="ml-1 text-[10px]">(EXPIRED)</span>}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <Button size="icon" variant="ghost" onClick={() => setViewing(r)} className="h-7 w-7 rounded-none" title="View" data-testid={`sip-view-${r.id}`}><Eye size={13} /></Button>
                    {canWrite && <Button size="icon" variant="ghost" onClick={() => openEdit(r)} className="h-7 w-7 rounded-none" title="Edit" data-testid={`sip-edit-${r.id}`}><Edit3 size={13} /></Button>}
                    {canWrite && <Button size="icon" variant="ghost" onClick={() => remove(r)} className="h-7 w-7 rounded-none hover:text-red-700" title="Delete" data-testid={`sip-del-${r.id}`}><Trash2 size={13} /></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={openForm} onOpenChange={(o) => !o && (setOpenForm(false), setEditing(null))}>
        <DialogContent className="rounded-none max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="sip-form">
          <DialogHeader><DialogTitle className="font-heading">{editing?.id ? "Edit SIP Center" : "Add SIP Center"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.long ? "md:col-span-2" : ""}>
                  <Label className="overline text-[10px]">{f.label}{f.required && " *"}</Label>
                  {f.long ? (
                    <Textarea value={editing[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} rows={2} className="rounded-none" data-testid={`sip-inp-${f.key}`} />
                  ) : (
                    <Input type={f.type || "text"} value={editing[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} className="rounded-none" data-testid={`sip-inp-${f.key}`} />
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenForm(false); setEditing(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={save} disabled={saving} className="brand-btn rounded-none" data-testid="sip-save">{saving ? "Saving…" : (editing?.id ? "Save changes" : "Add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="rounded-none max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="sip-view-dlg">
          {viewing && (
            <>
              <DialogHeader><DialogTitle className="font-heading">{viewing.center_name}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {FIELDS.map((f) => (
                  <div key={f.key} className={f.long ? "md:col-span-2" : ""}>
                    <div className="overline text-[10px]">{f.label}</div>
                    <div className="mt-0.5 whitespace-pre-wrap">
                      {f.key === "status" ? statusChip(viewing[f.key])
                        : f.type === "number" ? inr(viewing[f.key])
                        : (viewing[f.key] || "—")}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Upload dialog */}
      <Dialog open={bulkOpen} onOpenChange={(o) => !o && closeBulk()}>
        <DialogContent className="rounded-none max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="sip-bulk-dlg">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><Upload size={16} /> Bulk Upload — SIP Centers</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="border-l-4 border-[var(--brand)] bg-blue-50/40 p-3">
              <div className="font-bold flex items-center gap-2"><FileSpreadsheet size={14} /> Step 1 · Download template</div>
              <p className="text-xs text-[var(--muted)] mt-1">14 columns match aapke SIP Status sheet ke — headers exact rakhein.</p>
              <Button variant="outline" onClick={downloadTemplate} className="rounded-none gap-1 mt-2" data-testid="sip-tmpl-btn"><Download size={12} /> Download Sample Excel</Button>
            </div>
            <div className="border-l-4 border-gray-300 bg-gray-50 p-3">
              <div className="font-bold flex items-center gap-2"><Upload size={14} /> Step 2 · Upload Excel</div>
              <input ref={bulkFileRef} type="file" accept=".xlsx,.xls" className="mt-2 text-xs block" onChange={(e) => { setBulkFile(e.target.files?.[0] || null); setBulkPreview(null); }} data-testid="sip-bulk-file" />
              {bulkFile && <div className="text-xs text-[var(--muted)] mt-1">Selected: <span className="font-mono">{bulkFile.name}</span> ({Math.round(bulkFile.size / 1024)} KB)</div>}
              <div className="flex gap-2 mt-2">
                <Button onClick={runBulkPreview} disabled={!bulkFile || bulkBusy} className="brand-btn rounded-none" data-testid="sip-bulk-preview">{bulkBusy && !bulkPreview ? "Validating…" : "Preview"}</Button>
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
                        <th className="p-1.5 text-left">Row</th><th className="p-1.5 text-left">Reason</th><th className="p-1.5 text-left">Center ID</th>
                      </tr></thead>
                      <tbody>
                        {bulkPreview.errors.map((er, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="p-1.5 font-mono">{er.row}</td>
                            <td className="p-1.5 text-red-800"><XCircle size={11} className="inline mr-1" />{er.reason}</td>
                            <td className="p-1.5 font-mono">{er.data?.center_id_code || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bulkPreview.valid_rows?.length > 0 && (
                  <div className="border border-emerald-200 max-h-56 overflow-y-auto">
                    <table className="w-max min-w-full text-[11px]">
                      <thead className="bg-emerald-100 sticky top-0"><tr>
                        <th className="p-1.5 text-left">Row</th><th className="p-1.5 text-left">Center</th><th className="p-1.5 text-left">Center ID</th>
                        <th className="p-1.5 text-left">State</th><th className="p-1.5 text-left">Status</th>
                        <th className="p-1.5 text-left">Rating</th><th className="p-1.5 text-left">BG Validity</th>
                      </tr></thead>
                      <tbody>
                        {bulkPreview.valid_rows.map((v) => (
                          <tr key={v.row} className="border-t border-emerald-100">
                            <td className="p-1.5 font-mono">{v.row}</td>
                            <td className="p-1.5">{v.data.center_name}</td>
                            <td className="p-1.5 font-mono font-bold">{v.data.center_id_code}</td>
                            <td className="p-1.5">{v.data.state || "—"}</td>
                            <td className="p-1.5">{statusChip(v.data.status)}</td>
                            <td className="p-1.5">{v.data.center_rating || "—"}</td>
                            <td className="p-1.5">{v.data.bg_validity_date || "—"}</td>
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
            <Button onClick={confirmBulk} disabled={!bulkPreview || bulkPreview.valid === 0 || bulkBusy} className="brand-btn rounded-none gap-2" data-testid="sip-bulk-confirm">
              <Upload size={13} /> {bulkBusy && bulkPreview ? "Uploading…" : `Upload ${bulkPreview?.valid || 0} Center${(bulkPreview?.valid || 0) === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

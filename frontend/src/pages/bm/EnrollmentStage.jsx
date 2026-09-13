import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Upload, Plus, Trash2, Users, AlertTriangle, Download, CheckCircle2, Pencil } from "lucide-react";

/**
 * Stage 3 — Candidate Enrollment
 * ------------------------------
 * User picks a batch → sees capacity meter → uploads CSV/XLSX (preview →
 * commit) OR adds a candidate manually. All operations are gated by batch
 * capacity on the server side; the UI simply pre-clamps to prevent obvious
 * errors and shows inline validation.
 */

const CSV_HEADERS = ["name", "mobile", "email", "gender", "dob", "aadhaar", "father_name", "address", "job_role"];

export default function EnrollmentStage({ batches, canWrite }) {
  const [batchId, setBatchId] = useState("");
  const [state, setState] = useState(null); // {capacity, enrolled, available, rows}
  const [loading, setLoading] = useState(false);
  // Upload state
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // {valid, errors, counts, capacity_state}
  const [busy, setBusy] = useState(false);
  // Manual add / edit dialog
  const [manualOpen, setManualOpen] = useState(false);
  const [editId, setEditId] = useState(null); // null = add mode; id = edit mode
  const [manual, setManual] = useState({ name: "", mobile: "", email: "", gender: "", dob: "", aadhaar: "", father_name: "", address: "", job_role: "" });

  const activeBatch = useMemo(() => batches.find((b) => b.id === batchId), [batches, batchId]);
  const eligibleBatches = useMemo(() => batches.filter((b) => (b.total_beneficiaries || 0) > 0), [batches]);

  const load = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const r = await api.get(`/batches/${batchId}/candidates`);
      setState(r.data);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [batchId]);
  useEffect(() => { load(); setPreview(null); setFile(null); }, [load]);

  const downloadTemplate = () => {
    const csv = [CSV_HEADERS.join(","), "Ramesh Kumar,9876543210,ramesh@example.com,M,2000-05-15,111122223333,Suresh Kumar,\"Ranchi, Jharkhand\",Electrician"].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "batch_candidates_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const doUpload = async () => {
    if (!file) return toast.error("Pick a CSV / XLSX file first");
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post(`/batches/${batchId}/candidates/bulk-upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPreview(r.data);
      toast.success(`Parsed ${r.data.counts.total_parsed} rows · ${r.data.counts.valid} valid · ${r.data.counts.errors} error(s)`);
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };
  const doCommit = async () => {
    if (!preview?.valid?.length) return;
    setBusy(true);
    try {
      const r = await api.post(`/batches/${batchId}/candidates/bulk-commit`, { rows: preview.valid });
      toast.success(`Enrolled ${r.data.inserted} candidates. Available seats: ${r.data.capacity_state.available}.`);
      setPreview(null); setFile(null); load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };
  const doManual = async () => {
    if (!manual.name.trim()) return toast.error("Name is required");
    try {
      if (editId) {
        await api.patch(`/batches/${batchId}/candidates/${editId}`, manual);
        toast.success("Candidate updated");
      } else {
        await api.post(`/batches/${batchId}/candidates`, manual);
        toast.success("Candidate enrolled");
      }
      setManualOpen(false); setEditId(null);
      setManual({ name: "", mobile: "", email: "", gender: "", dob: "", aadhaar: "", father_name: "", address: "", job_role: "" });
      load();
    } catch (e) { toast.error(formatError(e)); }
  };
  const openAdd = () => {
    setEditId(null);
    setManual({ name: "", mobile: "", email: "", gender: "", dob: "", aadhaar: "", father_name: "", address: "", job_role: "" });
    setManualOpen(true);
  };
  const openEdit = (c) => {
    setEditId(c.id);
    setManual({
      name: c.name || "", mobile: c.mobile || "", email: c.email || "", gender: c.gender || "",
      dob: c.dob || "", aadhaar: c.aadhaar || "", father_name: c.father_name || "",
      address: c.address || "", job_role: c.job_role || "",
    });
    setManualOpen(true);
  };
  const removeCandidate = async (cid) => {
    if (!window.confirm("Remove this candidate from the batch?")) return;
    try { await api.delete(`/batches/${batchId}/candidates/${cid}`); toast.success("Candidate removed"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };

  const utilization = state?.capacity ? Math.round((state.enrolled / state.capacity) * 100) : 0;

  return (
    <div className="space-y-4" data-testid="bm-enroll-stage">
      {/* Batch picker + capacity meter */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <Label className="overline">Select Batch *</Label>
          <Select value={batchId || undefined} onValueChange={setBatchId}>
            <SelectTrigger className="rounded-none" data-testid="bm-enroll-batch"><SelectValue placeholder="Pick a batch to enroll into" /></SelectTrigger>
            <SelectContent>
              {eligibleBatches.length === 0 && <SelectItem value="__none__" disabled>Create a batch in Stage 2 first</SelectItem>}
              {eligibleBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} · cap {b.total_beneficiaries}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {activeBatch && state && (
          <div className="md:col-span-2 border-l-4 border-emerald-500 bg-emerald-50/40 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="overline text-[10px]">Capacity</div>
                <div className="text-xs mt-0.5"><b>{state.enrolled}</b> enrolled of <b>{state.capacity}</b> · <b className="text-amber-700">{state.available}</b> seats available</div>
              </div>
              <div className="font-heading font-black text-2xl text-emerald-700">{utilization}%</div>
            </div>
            <div className="h-1.5 bg-gray-100 mt-2"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${Math.min(100, utilization)}%` }} /></div>
          </div>
        )}
      </div>

      {!batchId ? (
        <div className="p-8 text-center text-[var(--muted)]">Select a batch above to start enrolling candidates.</div>
      ) : (
        <>
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate} className="rounded-none gap-1 text-xs" data-testid="bm-enroll-template">
              <Download size={13} /> CSV Template
            </Button>
            <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs" data-testid="bm-enroll-file" />
            {canWrite && <Button onClick={doUpload} disabled={!file || busy} className="brand-btn rounded-none gap-1 text-xs" data-testid="bm-enroll-upload"><Upload size={13} /> {busy ? "Parsing…" : "Preview"}</Button>}
            <div className="ml-auto">
              {canWrite && state?.available > 0 && <Button onClick={openAdd} className="brand-btn rounded-none gap-1 text-xs" data-testid="bm-enroll-manual-btn"><Plus size={13} /> Add Manually</Button>}
              {canWrite && state?.available === 0 && <span className="text-[11px] text-red-700 italic">Batch full</span>}
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div className="swiss-card p-3 space-y-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 border border-emerald-300 text-emerald-800 text-[10px] font-bold uppercase"><CheckCircle2 size={11} /> {preview.counts.valid} valid</span>
                {preview.counts.errors > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 border border-red-300 text-red-800 text-[10px] font-bold uppercase"><AlertTriangle size={11} /> {preview.counts.errors} error(s)</span>}
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" onClick={() => { setPreview(null); setFile(null); }} className="rounded-none text-xs">Cancel</Button>
                  <Button onClick={doCommit} disabled={busy || !preview.valid.length} className="brand-btn rounded-none text-xs" data-testid="bm-enroll-commit">
                    Commit {preview.valid.length} candidates
                  </Button>
                </div>
              </div>
              {preview.errors.length > 0 && (
                <div className="text-[11px] border border-red-200 bg-red-50 p-2 max-h-40 overflow-y-auto">
                  <div className="font-bold text-red-800 mb-1">Errors — please fix and re-upload:</div>
                  {preview.errors.slice(0, 20).map((e, i) => (
                    <div key={i}>Row {e.row}: {e.reason}{e.data?.name ? ` (${e.data.name})` : ""}</div>
                  ))}
                  {preview.errors.length > 20 && <div className="italic mt-1">… and {preview.errors.length - 20} more</div>}
                </div>
              )}
              <div className="overflow-x-auto border border-[var(--border)]">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50"><tr className="[&>th]:p-1.5 [&>th]:text-left [&>th]:overline [&>th]:text-[9px]">
                    <th>#</th><th>Name</th><th>Mobile</th><th>Aadhaar</th><th>Job Role</th>
                  </tr></thead>
                  <tbody>
                    {preview.valid.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-[var(--border)]/50 [&>td]:p-1.5">
                        <td className="font-mono">{r.row}</td>
                        <td>{r.name}</td>
                        <td>{r.mobile || "—"}</td>
                        <td className="font-mono">{r.aadhaar || "—"}</td>
                        <td>{r.job_role || "—"}</td>
                      </tr>
                    ))}
                    {preview.valid.length > 50 && <tr><td colSpan={5} className="p-1.5 italic text-[var(--muted)] text-center">… and {preview.valid.length - 50} more</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Enrolled candidates list */}
          <div className="swiss-card overflow-x-auto">
            <table className="w-full text-xs min-w-max">
              <thead className="bg-gray-50 border-b border-[var(--border)]">
                <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px]">
                  <th>Candidate ID</th><th>Name</th><th>Mobile</th><th>Aadhaar</th><th>Job Role</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
                {!loading && (state?.rows || []).length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-[var(--muted)]"><Users size={20} className="mx-auto mb-2" /> No candidates yet. Upload a CSV or add manually.</td></tr>
                )}
                {(state?.rows || []).map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border)] [&>td]:p-2 hover:bg-gray-50">
                    <td className="font-mono text-[10px]">{c.candidate_id || c.id.slice(0, 8)}</td>
                    <td className="font-semibold">{c.name}</td>
                    <td>{c.mobile || "—"}</td>
                    <td className="font-mono">{c.aadhaar || "—"}</td>
                    <td>{c.job_role || "—"}</td>
                    <td><span className="inline-flex items-center px-1.5 py-0.5 bg-emerald-100 border border-emerald-300 text-emerald-800 text-[9px] font-bold uppercase">{c.status || "enrolled"}</span></td>
                    <td>{canWrite && (
                      <div className="flex items-center gap-1 justify-end">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(c)} className="h-7 w-7 rounded-none hover:text-[var(--brand)]" data-testid={`bm-enroll-edit-${c.id}`}><Pencil size={12} /></Button>
                        <Button size="icon" variant="ghost" onClick={() => removeCandidate(c.id)} className="h-7 w-7 rounded-none hover:text-red-700" data-testid={`bm-enroll-del-${c.id}`}><Trash2 size={12} /></Button>
                      </div>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Manual add / edit dialog */}
      <Dialog open={manualOpen} onOpenChange={(o) => { setManualOpen(o); if (!o) setEditId(null); }}>
        <DialogContent className="rounded-none max-w-2xl" data-testid="bm-enroll-manual-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">{editId ? "Edit Candidate" : "Add Candidate"} — {activeBatch?.name}</DialogTitle>
            <DialogDescription className="text-xs">{editId ? "Update candidate details. Aadhaar must stay unique within the batch." : "Single candidate manual enrollment. Aadhaar dedupe is enforced per batch."}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: "name", l: "Name *" }, { k: "mobile", l: "Mobile" }, { k: "email", l: "Email" },
              { k: "gender", l: "Gender (M/F/O)" }, { k: "dob", l: "DOB (YYYY-MM-DD)", type: "date" },
              { k: "aadhaar", l: "Aadhaar" }, { k: "father_name", l: "Father's Name" },
              { k: "address", l: "Address" }, { k: "job_role", l: "Job Role" },
            ].map((f) => (
              <div key={f.k}>
                <Label className="overline text-[10px]">{f.l}</Label>
                <Input type={f.type || "text"} value={manual[f.k]} onChange={(e) => setManual({ ...manual, [f.k]: e.target.value })} className="rounded-none" data-testid={`bm-enroll-inp-${f.k}`} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setManualOpen(false); setEditId(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={doManual} className="brand-btn rounded-none" data-testid="bm-enroll-manual-save">{editId ? "Save Changes" : "Enroll"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

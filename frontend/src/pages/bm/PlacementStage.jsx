import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, IndianRupee, TrendingUp, Award, Edit3 } from "lucide-react";

/**
 * Stage 6 — Placement Management
 * ------------------------------
 * Per-certified-candidate placement record (employer / location / CTC / joining +
 * 3-month retention chips). Live placement % on the batch.
 */

const PLACE_STATUSES = [
  { k: "pending", label: "Pending", tone: "bg-amber-100 text-amber-800 border-amber-300" },
  { k: "placed", label: "Placed", tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { k: "self-employed", label: "Self-Employed", tone: "bg-indigo-100 text-indigo-800 border-indigo-300" },
  { k: "declined", label: "Declined", tone: "bg-gray-200 text-gray-700 border-gray-300" },
];
const RETENTION = [
  { k: "retained", label: "Retained", tone: "bg-emerald-500 text-white" },
  { k: "not-retained", label: "Not Retained", tone: "bg-red-500 text-white" },
  { k: "pending", label: "Pending", tone: "bg-amber-400 text-white" },
];

const EMPTY_FORM = {
  placement_status: "placed", employer: "", job_location: "", designation: "",
  joining_date: "", ctc: 0, retention_month_1: "", retention_month_2: "",
  retention_month_3: "", remarks: "",
};

export default function PlacementStage({ batches, canWrite }) {
  const [batchId, setBatchId] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // candidate object with placement fields
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const [candRes, sumRes] = await Promise.all([
        api.get(`/batches/${batchId}/candidates`),
        api.get(`/batches/${batchId}/placement/summary`),
      ]);
      setCandidates(candRes.data.rows || []);
      setSummary(sumRes.data);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [batchId]);
  useEffect(() => { load(); }, [load]);

  const certifiedCands = useMemo(() => candidates.filter((c) => c.certified), [candidates]);

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      placement_status: c.placement_status || "placed",
      employer: c.employer || "", job_location: c.job_location || "",
      designation: c.designation || "", joining_date: c.joining_date || "",
      ctc: c.ctc || 0,
      retention_month_1: c.retention_month_1 || "",
      retention_month_2: c.retention_month_2 || "",
      retention_month_3: c.retention_month_3 || "",
      remarks: c.remarks || "",
    });
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/batches/${batchId}/candidates/${editing.id}/placement`, {
        ...form, ctc: Number(form.ctc) || 0,
      });
      toast.success("Placement updated");
      setEditing(null); setForm(EMPTY_FORM); load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4" data-testid="bm-place-stage">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <Label className="overline">Select Batch *</Label>
          <Select value={batchId || undefined} onValueChange={setBatchId}>
            <SelectTrigger className="rounded-none" data-testid="bm-place-batch"><SelectValue placeholder="Pick a batch" /></SelectTrigger>
            <SelectContent>
              {batches.filter((b) => b.total_beneficiaries).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!batchId ? (
        <div className="p-8 text-center text-[var(--muted)]"><Briefcase size={24} className="mx-auto mb-2" /> Select a batch to record placements.</div>
      ) : (
        <>
          {/* KPI strip */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              <div className="swiss-card p-2"><div className="overline text-[9px]">Enrolled</div><div className="font-heading font-black text-xl">{summary.total_enrolled}</div></div>
              <div className="swiss-card p-2"><div className="overline text-[9px]">Certified</div><div className="font-heading font-black text-xl text-emerald-800">{summary.certified}</div></div>
              <div className="swiss-card p-2"><div className="overline text-[9px]">Placed</div><div className="font-heading font-black text-xl text-emerald-700">{summary.placed}</div></div>
              <div className="swiss-card p-2 border-l-4 border-emerald-500"><div className="overline text-[9px]">Placement %</div><div className="font-heading font-black text-2xl text-emerald-700">{summary.placement_pct}%</div></div>
              <div className="swiss-card p-2"><div className="overline text-[9px]">Pending</div><div className="font-heading font-black text-xl text-amber-700">{summary.pending_placement}</div></div>
              <div className="swiss-card p-2"><div className="overline text-[9px]">Avg CTC</div><div className="font-heading font-black text-xl">₹{Number(summary.ctc.avg).toLocaleString("en-IN")}</div></div>
            </div>
          )}

          {/* Retention snapshot */}
          {summary && summary.placed > 0 && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              {["month_1", "month_2", "month_3"].map((m, i) => (
                <div key={m} className="swiss-card p-2 border-l-4 border-blue-500">
                  <div className="overline text-[9px]">{`Retention · Month ${i + 1}`}</div>
                  <div className="flex items-baseline gap-2">
                    <div className="font-heading font-black text-xl text-blue-700">{summary.retention[m]}</div>
                    <div className="text-[10px] text-[var(--muted)]">of {summary.placed} placed · {summary.retention[m + "_pct"]}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Certified candidates list */}
          <div className="text-[11px] text-[var(--muted)]">Only certified candidates are eligible for placement.</div>
          {loading ? (
            <div className="p-4 text-center text-[var(--muted)]">Loading…</div>
          ) : (
            <div className="swiss-card overflow-x-auto">
              <table className="w-full text-xs min-w-max">
                <thead className="bg-gray-50 border-b border-[var(--border)]">
                  <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px]">
                    <th>Candidate</th><th>Job Role</th><th>Placement</th><th>Employer</th>
                    <th>CTC</th><th>Retention M1/M2/M3</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {certifiedCands.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-[var(--muted)]">No certified candidates yet. Complete Stage 5 first.</td></tr>}
                  {certifiedCands.map((c) => {
                    const st = PLACE_STATUSES.find((s) => s.k === (c.placement_status || "pending"));
                    return (
                      <tr key={c.id} className="border-t border-[var(--border)] [&>td]:p-2 hover:bg-gray-50" data-testid={`bm-place-row-${c.id}`}>
                        <td>
                          <div className="font-semibold">{c.name}</div>
                          <div className="text-[9px] font-mono text-[var(--muted)]">{c.candidate_id || c.id.slice(0, 8)}</div>
                        </td>
                        <td>{c.job_role || "—"}</td>
                        <td><span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase border ${st?.tone || "bg-gray-100"}`}>{st?.label || "Pending"}</span></td>
                        <td>{c.employer || "—"}</td>
                        <td className="font-mono">{c.ctc ? `₹${Number(c.ctc).toLocaleString("en-IN")}` : "—"}</td>
                        <td>
                          <div className="flex gap-1">
                            {["retention_month_1", "retention_month_2", "retention_month_3"].map((k, i) => {
                              const v = c[k]; const r = RETENTION.find((x) => x.k === v);
                              return (
                                <span key={k} className={`inline-flex items-center justify-center w-6 h-6 text-[9px] font-bold ${r?.tone || "bg-gray-100 text-gray-400"}`} title={`Month ${i + 1}: ${v || "unmarked"}`}>{v ? v[0].toUpperCase() : "—"}</span>
                              );
                            })}
                          </div>
                        </td>
                        <td>{canWrite && <Button size="icon" variant="ghost" onClick={() => openEdit(c)} className="h-7 w-7 rounded-none" data-testid={`bm-place-edit-${c.id}`}><Edit3 size={12} /></Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Placement edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="rounded-none max-w-2xl" data-testid="bm-place-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Placement — {editing?.name}</DialogTitle>
            <DialogDescription className="text-xs">Certified candidate only. Placed status requires certified=true (enforced server-side).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="overline text-[10px]">Placement Status *</Label>
              <Select value={form.placement_status || undefined} onValueChange={(v) => setForm({ ...form, placement_status: v })}>
                <SelectTrigger className="rounded-none" data-testid="bm-place-inp-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLACE_STATUSES.map((s) => <SelectItem key={s.k} value={s.k}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="overline text-[10px]">Employer</Label><Input value={form.employer} onChange={(e) => setForm({ ...form, employer: e.target.value })} className="rounded-none" data-testid="bm-place-inp-employer" /></div>
            <div><Label className="overline text-[10px]">Job Location</Label><Input value={form.job_location} onChange={(e) => setForm({ ...form, job_location: e.target.value })} className="rounded-none" data-testid="bm-place-inp-location" /></div>
            <div><Label className="overline text-[10px]">Designation</Label><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="rounded-none" data-testid="bm-place-inp-designation" /></div>
            <div><Label className="overline text-[10px]">Joining Date</Label><Input type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} className="rounded-none" data-testid="bm-place-inp-joining" /></div>
            <div><Label className="overline text-[10px]">CTC (₹ / year)</Label><Input type="number" min={0} value={form.ctc} onChange={(e) => setForm({ ...form, ctc: e.target.value })} className="rounded-none" data-testid="bm-place-inp-ctc" /></div>
            {[1, 2, 3].map((m) => (
              <div key={m}>
                <Label className="overline text-[10px]">Retention · Month {m}</Label>
                <Select value={form[`retention_month_${m}`] || undefined} onValueChange={(v) => setForm({ ...form, [`retention_month_${m}`]: v })}>
                  <SelectTrigger className="rounded-none" data-testid={`bm-place-inp-ret${m}`}><SelectValue placeholder="Not tracked" /></SelectTrigger>
                  <SelectContent>
                    {RETENTION.map((r) => <SelectItem key={r.k} value={r.k}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="col-span-2"><Label className="overline text-[10px]">Remarks</Label><Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="rounded-none" data-testid="bm-place-inp-remarks" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} className="rounded-none">Cancel</Button>
            <Button onClick={save} disabled={saving} className="brand-btn rounded-none" data-testid="bm-place-save">{saving ? "Saving…" : "Save Placement"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

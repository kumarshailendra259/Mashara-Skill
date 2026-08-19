import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, CheckCircle2, XCircle, UserX, Save, Award } from "lucide-react";

/**
 * Stage 5 — Assessment & Certification
 * ------------------------------------
 * Batch-level metadata (SDMS id, agency, date, status) + per-candidate outcome
 * chips (Absent / Present / Passed / Failed) with live certification %.
 */

const BATCH_STATUSES = [
  "SDMS Not Received", "More Than 20%", "Assessment Done Result Pending",
  "SDMS Done Assessment not Done", "Bill Generated", "Completed But Bill Not Generated",
];
const OUTCOMES = [
  { k: "absent", label: "Absent", icon: UserX, tone: "bg-gray-200 text-gray-700 border-gray-300" },
  { k: "present", label: "Present", icon: CheckCircle2, tone: "bg-blue-100 text-blue-800 border-blue-300" },
  { k: "passed", label: "Passed", icon: Award, tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { k: "failed", label: "Failed", icon: XCircle, tone: "bg-red-100 text-red-800 border-red-300" },
];

export default function AssessmentStage({ batches, canWrite }) {
  const [batchId, setBatchId] = useState("");
  const [meta, setMeta] = useState({
    sdms_batch_id: "", assessment_agency: "", assessor_name: "",
    assessor_contact: "", assessment_date: "", assessment_status: "",
  });
  const [candidates, setCandidates] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeBatch = useMemo(() => batches.find((b) => b.id === batchId), [batches, batchId]);

  const load = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const [candRes, sumRes] = await Promise.all([
        api.get(`/batches/${batchId}/candidates`),
        api.get(`/batches/${batchId}/assessment/summary`),
      ]);
      setCandidates(candRes.data.rows || []);
      setSummary(sumRes.data);
      const b = sumRes.data.batch || {};
      setMeta({
        sdms_batch_id: b.sdms_batch_id || "",
        assessment_agency: b.assessment_agency || "",
        assessor_name: b.assessor_name || "",
        assessor_contact: b.assessor_contact || "",
        assessment_date: b.assessment_date || "",
        assessment_status: b.assessment_status || "",
      });
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [batchId]);
  useEffect(() => { load(); }, [load]);

  const saveMeta = async () => {
    setSaving(true);
    try {
      await api.patch(`/batches/${batchId}/assessment`, meta);
      toast.success("Batch assessment info saved");
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  const setOutcome = async (cid, status) => {
    try {
      await api.post(`/batches/${batchId}/candidates/${cid}/assessment`, { status, certified: status === "passed" });
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const markAll = async (status) => {
    if (!candidates.length) return;
    if (!window.confirm(`Mark ALL ${candidates.length} candidates as ${status.toUpperCase()}?`)) return;
    try {
      const rows = candidates.map((c) => ({ candidate_id: c.id, status, certified: status === "passed" }));
      const r = await api.post(`/batches/${batchId}/candidates/assessment/bulk`, { rows });
      toast.success(`Updated ${r.data.updated} candidates`);
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-4" data-testid="bm-assess-stage">
      {/* Batch picker */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <Label className="overline">Select Batch *</Label>
          <Select value={batchId || undefined} onValueChange={setBatchId}>
            <SelectTrigger className="rounded-none" data-testid="bm-assess-batch"><SelectValue placeholder="Pick a batch" /></SelectTrigger>
            <SelectContent>
              {batches.filter((b) => b.total_beneficiaries).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!batchId ? (
        <div className="p-8 text-center text-[var(--muted)]"><GraduationCap size={24} className="mx-auto mb-2" /> Select a batch to record assessment.</div>
      ) : (
        <>
          {/* Batch metadata */}
          <div className="swiss-card p-4 space-y-3">
            <div className="overline text-[10px] border-b border-[var(--border)] pb-1">Batch Assessment Details</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label className="overline text-[10px]">SDMS Batch ID</Label><Input value={meta.sdms_batch_id} onChange={(e) => setMeta({ ...meta, sdms_batch_id: e.target.value })} className="rounded-none" data-testid="bm-assess-sdms" disabled={!canWrite} /></div>
              <div><Label className="overline text-[10px]">Assessment Agency</Label><Input value={meta.assessment_agency} onChange={(e) => setMeta({ ...meta, assessment_agency: e.target.value })} className="rounded-none" data-testid="bm-assess-agency" disabled={!canWrite} /></div>
              <div><Label className="overline text-[10px]">Assessment Date</Label><Input type="date" value={meta.assessment_date} onChange={(e) => setMeta({ ...meta, assessment_date: e.target.value })} className="rounded-none" data-testid="bm-assess-date" disabled={!canWrite} /></div>
              <div><Label className="overline text-[10px]">Assessor Name</Label><Input value={meta.assessor_name} onChange={(e) => setMeta({ ...meta, assessor_name: e.target.value })} className="rounded-none" data-testid="bm-assess-assessor" disabled={!canWrite} /></div>
              <div><Label className="overline text-[10px]">Assessor Contact</Label><Input value={meta.assessor_contact} onChange={(e) => setMeta({ ...meta, assessor_contact: e.target.value })} className="rounded-none" data-testid="bm-assess-contact" disabled={!canWrite} /></div>
              <div><Label className="overline text-[10px]">Batch Status</Label>
                <Select value={meta.assessment_status || undefined} onValueChange={(v) => setMeta({ ...meta, assessment_status: v })} disabled={!canWrite}>
                  <SelectTrigger className="rounded-none" data-testid="bm-assess-status"><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>
                    {BATCH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {canWrite && (
              <div className="flex justify-end">
                <Button onClick={saveMeta} disabled={saving} className="brand-btn rounded-none gap-1 text-xs" data-testid="bm-assess-save-meta"><Save size={13} /> {saving ? "Saving…" : "Save Batch Info"}</Button>
              </div>
            )}
          </div>

          {/* Summary chips */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              <div className="swiss-card p-2"><div className="overline text-[9px]">Enrolled</div><div className="font-heading font-black text-xl">{summary.total_enrolled}</div></div>
              <div className="swiss-card p-2"><div className="overline text-[9px]">Present</div><div className="font-heading font-black text-xl text-blue-700">{summary.present}</div></div>
              <div className="swiss-card p-2"><div className="overline text-[9px]">Passed</div><div className="font-heading font-black text-xl text-emerald-700">{summary.passed}</div></div>
              <div className="swiss-card p-2"><div className="overline text-[9px]">Failed</div><div className="font-heading font-black text-xl text-red-700">{summary.failed}</div></div>
              <div className="swiss-card p-2"><div className="overline text-[9px]">Certified</div><div className="font-heading font-black text-xl text-emerald-800">{summary.certified}</div></div>
              <div className="swiss-card p-2 border-l-4 border-emerald-500"><div className="overline text-[9px]">Certification %</div><div className="font-heading font-black text-2xl text-emerald-700">{summary.certification_pct}%</div></div>
            </div>
          )}

          {/* Bulk action bar */}
          {canWrite && candidates.length > 0 && (
            <div className="border-l-4 border-blue-500 bg-blue-50/30 p-2 flex items-center gap-2 flex-wrap">
              <span className="overline text-[10px]">Bulk mark:</span>
              {OUTCOMES.map((o) => (
                <Button key={o.k} onClick={() => markAll(o.k)} size="sm" variant="outline" className={`rounded-none h-6 text-[10px] gap-1 ${o.tone}`} data-testid={`bm-assess-bulk-${o.k}`}>
                  <o.icon size={11} /> All {o.label}
                </Button>
              ))}
            </div>
          )}

          {/* Candidate outcome grid */}
          {loading ? (
            <div className="p-4 text-center text-[var(--muted)]">Loading…</div>
          ) : (
            <div className="swiss-card overflow-x-auto">
              <table className="w-full text-xs min-w-max">
                <thead className="bg-gray-50 border-b border-[var(--border)]">
                  <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px]">
                    <th>Candidate</th><th>Aadhaar</th><th>Job Role</th><th>Outcome</th><th>Certified?</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-[var(--muted)]">No candidates. Enroll first in Stage 3.</td></tr>}
                  {candidates.map((c) => {
                    const cur = c.assessment_status || "";
                    return (
                      <tr key={c.id} className="border-t border-[var(--border)] [&>td]:p-2 hover:bg-gray-50" data-testid={`bm-assess-row-${c.id}`}>
                        <td>
                          <div className="font-semibold">{c.name}</div>
                          <div className="text-[9px] font-mono text-[var(--muted)]">{c.candidate_id || c.id.slice(0, 8)}</div>
                        </td>
                        <td className="font-mono">{c.aadhaar || "—"}</td>
                        <td>{c.job_role || "—"}</td>
                        <td>
                          <div className="flex gap-1">
                            {OUTCOMES.map((o) => (
                              <button
                                type="button"
                                key={o.k}
                                disabled={!canWrite}
                                onClick={() => setOutcome(c.id, o.k)}
                                className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border transition-all ${cur === o.k ? o.tone + " ring-2 ring-offset-1" : "bg-white border-gray-300 text-gray-500 hover:bg-gray-50"} ${canWrite ? "cursor-pointer" : "cursor-default opacity-70"}`}
                                data-testid={`bm-assess-chip-${c.id}-${o.k}`}
                              >{o.label}</button>
                            ))}
                          </div>
                        </td>
                        <td>
                          {c.certified ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 border border-emerald-300 text-emerald-800 text-[9px] font-bold uppercase" data-testid={`bm-assess-cert-${c.id}`}><Award size={10} /> Certified</span>
                          ) : (
                            <span className="text-[10px] text-[var(--muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

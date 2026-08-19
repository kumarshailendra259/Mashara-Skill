import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Check, X, CalendarDays, Users, ListChecks, Download } from "lucide-react";

/**
 * Stage 4 — Attendance Grid
 * -------------------------
 * Grid of candidates × dates. Cells cycle P (present) / A (absent) / H (holiday)
 * on click. "Mark All Present" bulk-marks every candidate for every visible date.
 * Server blocks dates outside [start_date, end_date] — the UI mirrors this by
 * disabling out-of-window date pickers.
 */

const STATUS_TONE = {
  P: "bg-emerald-500 text-white",
  A: "bg-red-500 text-white",
  H: "bg-amber-400 text-white",
  "": "bg-gray-100 text-gray-400",
};
const NEXT = { "": "P", P: "A", A: "H", H: "" };

export default function AttendanceStage({ batches, canWrite }) {
  const [batchId, setBatchId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);

  const activeBatch = useMemo(() => batches.find((b) => b.id === batchId), [batches, batchId]);
  useEffect(() => {
    if (activeBatch) {
      setFrom(activeBatch.start_date || "");
      setTo(activeBatch.end_date || "");
    }
  }, [activeBatch]);

  const load = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const params = {};
      if (from) params.from_date = from;
      if (to) params.to_date = to;
      const [r1, r2] = await Promise.all([
        api.get(`/batches/${batchId}/attendance`, { params }),
        api.get(`/batches/${batchId}/attendance/summary`),
      ]);
      setData(r1.data); setSummary(r2.data);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [batchId, from, to]);
  useEffect(() => { load(); }, [load]);

  const markCell = async (cid, date, status) => {
    if (!canWrite) return;
    setBusy(true);
    try {
      await api.post(`/batches/${batchId}/attendance/mark`, {
        dates: [date], status: status || "P", candidate_ids: [cid], overwrite: true,
      });
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const markAllPresent = async () => {
    if (!data?.dates?.length) return;
    if (!window.confirm(`Mark ALL ${data.candidates.length} candidates as PRESENT across ${data.dates.length} date(s)? Existing entries will NOT be overwritten.`)) return;
    setBusy(true);
    try {
      const r = await api.post(`/batches/${batchId}/attendance/mark`, {
        dates: data.dates, status: "P", candidate_ids: "all", overwrite: false,
      });
      toast.success(`Marked ${r.data.inserted} entries · ${r.data.candidates_affected} candidates × ${r.data.dates_affected} dates`);
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };
  const markAllForDate = async (date, status) => {
    if (!window.confirm(`Mark ALL candidates as ${status} on ${date}?`)) return;
    setBusy(true);
    try {
      await api.post(`/batches/${batchId}/attendance/mark`, {
        dates: [date], status, candidate_ids: "all", overwrite: true,
      });
      toast.success(`Column ${date} updated`);
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const eligibleBatches = useMemo(() => batches.filter((b) => b.start_date && b.end_date), [batches]);

  const exportCsv = async () => {
    if (!batchId) return;
    try {
      const params = new URLSearchParams();
      if (from) params.set("from_date", from);
      if (to) params.set("to_date", to);
      // Use fetch with credentials so it can stream the CSV directly.
      const url = `${process.env.REACT_APP_BACKEND_URL}/api/batches/${batchId}/attendance/export.csv?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const dl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dl;
      const safe = (activeBatch?.name || batchId).replace(/[^a-zA-Z0-9-_]/g, "_");
      a.download = `attendance_${safe}_${from}_to_${to}.csv`;
      a.click();
      URL.revokeObjectURL(dl);
      toast.success("Attendance CSV exported");
    } catch (e) { toast.error(e.message || "Export failed"); }
  };

  return (
    <div className="space-y-4" data-testid="bm-att-stage">
      {/* Batch + date range picker */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-2">
          <Label className="overline">Select Batch *</Label>
          <Select value={batchId || undefined} onValueChange={setBatchId}>
            <SelectTrigger className="rounded-none" data-testid="bm-att-batch"><SelectValue placeholder="Pick a batch" /></SelectTrigger>
            <SelectContent>
              {eligibleBatches.length === 0 && <SelectItem value="__none__" disabled>No batches with start/end dates</SelectItem>}
              {eligibleBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} · {b.start_date} → {b.end_date}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="overline">From</Label>
          <Input type="date" value={from} min={activeBatch?.start_date} max={activeBatch?.end_date} onChange={(e) => setFrom(e.target.value)} className="rounded-none" data-testid="bm-att-from" />
        </div>
        <div>
          <Label className="overline">To</Label>
          <Input type="date" value={to} min={activeBatch?.start_date} max={activeBatch?.end_date} onChange={(e) => setTo(e.target.value)} className="rounded-none" data-testid="bm-att-to" />
        </div>
        <div>
          {canWrite && batchId && (
            <Button onClick={markAllPresent} disabled={busy || !data?.dates?.length} className="brand-btn rounded-none w-full gap-1 text-xs" data-testid="bm-att-mark-all">
              <ListChecks size={13} /> Mark All Present
            </Button>
          )}
        </div>
      </div>

      {/* Export button */}
      {batchId && (
        <div className="flex justify-end">
          <Button onClick={exportCsv} variant="outline" className="rounded-none gap-1 text-xs" data-testid="bm-att-export">
            <Download size={13} /> Export CSV
          </Button>
        </div>
      )}

      {/* Summary chips */}
      {summary && batchId && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          <div className="swiss-card p-2"><div className="overline text-[9px]">Overall %</div><div className="font-heading font-black text-2xl text-emerald-700">{summary.overall_pct}%</div></div>
          <div className="swiss-card p-2"><div className="overline text-[9px]">Presents</div><div className="font-heading font-black text-xl">{summary.presents}</div></div>
          <div className="swiss-card p-2"><div className="overline text-[9px]">Absents</div><div className="font-heading font-black text-xl text-red-700">{summary.absents}</div></div>
          <div className="swiss-card p-2"><div className="overline text-[9px]">Holidays</div><div className="font-heading font-black text-xl text-amber-700">{summary.holidays}</div></div>
          <div className="swiss-card p-2"><div className="overline text-[9px]">Training Days</div><div className="font-heading font-black text-xl">{summary.total_days}</div></div>
          <div className="swiss-card p-2"><div className="overline text-[9px]">Total Records</div><div className="font-heading font-black text-xl">{summary.total_records}</div></div>
        </div>
      )}

      {/* Grid */}
      {!batchId ? (
        <div className="p-8 text-center text-[var(--muted)]"><CalendarDays size={24} className="mx-auto mb-2" /> Select a batch to view its attendance grid.</div>
      ) : loading ? (
        <div className="p-8 text-center text-[var(--muted)]">Loading grid…</div>
      ) : !data?.candidates?.length ? (
        <div className="p-8 text-center text-[var(--muted)]"><Users size={24} className="mx-auto mb-2" /> No candidates enrolled. Enroll candidates first (Stage 3).</div>
      ) : (
        <div className="swiss-card overflow-auto max-h-[70vh]">
          <table className="text-xs min-w-max">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="p-2 text-left overline text-[10px] sticky left-0 bg-gray-50 z-20 min-w-[220px] border-b border-r border-[var(--border)]">Candidate</th>
                {data.dates.map((d) => {
                  const dayOfWeek = new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
                  return (
                    <th key={d} className="p-1 text-center overline text-[9px] border-b border-r border-[var(--border)] min-w-[52px]" title={d}>
                      <div className="font-bold">{d.slice(5)}</div>
                      <div className="text-[8px] text-[var(--muted)] font-normal">{dayOfWeek}</div>
                      {canWrite && (
                        <div className="flex gap-0.5 justify-center mt-0.5">
                          <button type="button" title="Mark column P" onClick={() => markAllForDate(d, "P")} className="w-3 h-3 bg-emerald-500 hover:opacity-80" aria-label="mark all present"></button>
                          <button type="button" title="Mark column A" onClick={() => markAllForDate(d, "A")} className="w-3 h-3 bg-red-500 hover:opacity-80" aria-label="mark all absent"></button>
                          <button type="button" title="Mark column H" onClick={() => markAllForDate(d, "H")} className="w-3 h-3 bg-amber-400 hover:opacity-80" aria-label="mark all holiday"></button>
                        </div>
                      )}
                    </th>
                  );
                })}
                <th className="p-2 overline text-[10px] border-b border-[var(--border)] min-w-[70px]">Pct</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((c) => {
                const row = data.matrix?.[c.id] || {};
                const per = summary?.per_candidate?.[c.id] || { P: 0, A: 0 };
                const pct = (per.P + per.A) ? Math.round(per.P / (per.P + per.A) * 100) : 0;
                return (
                  <tr key={c.id} className="border-b border-[var(--border)]/50 hover:bg-gray-50/50">
                    <td className="p-2 sticky left-0 bg-white z-10 border-r border-[var(--border)]" data-testid={`bm-att-row-${c.id}`}>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-[9px] font-mono text-[var(--muted)]">{c.candidate_id || c.id.slice(0, 8)}</div>
                    </td>
                    {data.dates.map((d) => {
                      const st = row[d] || "";
                      return (
                        <td key={d} className="p-1 border-r border-[var(--border)]/30 text-center">
                          <button
                            type="button"
                            disabled={!canWrite || busy}
                            onClick={() => markCell(c.id, d, NEXT[st])}
                            className={`w-8 h-8 text-[10px] font-black uppercase transition-colors ${STATUS_TONE[st]} ${canWrite ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
                            data-testid={`bm-att-cell-${c.id}-${d}`}
                            title={`Click to cycle · currently ${st || "unmarked"}`}
                          >
                            {st || "—"}
                          </button>
                        </td>
                      );
                    })}
                    <td className="p-2 text-center font-black">
                      <span className={pct >= 75 ? "text-emerald-700" : pct >= 50 ? "text-amber-700" : "text-red-700"}>{pct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {batchId && (
        <div className="flex gap-3 text-[11px] items-center">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-emerald-500"></span> P Present</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-red-500"></span> A Absent</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-amber-400"></span> H Holiday</span>
          <span className="text-[var(--muted)]">Click a cell to cycle · click column icons to bulk-mark that date</span>
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, ShieldCheck, ClipboardList, Users, GraduationCap,
  Calendar, ChevronRight, RefreshCw, XCircle, TrendingDown, UserX,
} from "lucide-react";

/**
 * MIS Alerts & Exceptions Panel (Phase 6)
 * -----------------------------------------
 * Consolidated feed powered by `GET /mis/alerts`. Each card is a click-target:
 * clicking opens a preview dialog listing the top 5 offending items and a
 * "Jump to <tab>" button that switches the parent MIS tab and (best-effort)
 * seeds a search string.
 */

const SEVERITY_STYLES = {
  red:   { bg: "bg-red-50/60",     border: "border-red-500",     text: "text-red-800",     iconBg: "bg-red-100",     iconText: "text-red-700" },
  amber: { bg: "bg-amber-50/60",   border: "border-amber-500",   text: "text-amber-800",   iconBg: "bg-amber-100",   iconText: "text-amber-700" },
  blue:  { bg: "bg-blue-50/60",    border: "border-blue-500",    text: "text-blue-800",    iconBg: "bg-blue-100",    iconText: "text-blue-700" },
  green: { bg: "bg-emerald-50/60", border: "border-emerald-500", text: "text-emerald-800", iconBg: "bg-emerald-100", iconText: "text-emerald-700" },
};

const ICONS = {
  bg_expiring:           AlertTriangle,
  bg_expired:            XCircle,
  accreditation_pending: ShieldCheck,
  assessment_pending:    ClipboardList,
  low_attendance:        TrendingDown,
  placement_pending:     UserX,
  batches_ending:        Calendar,
  trainer_gap:           Users,
};

export default function AlertsPanel({ onJumpToTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // active alert object being previewed

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/mis/alerts");
      setData(r.data);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="text-xs text-[var(--muted)]">Loading alerts…</div>;
  if (!data) return null;

  const totalOpen = data.alerts.reduce((a, c) => a + (c.count || 0), 0);

  return (
    <div className="space-y-3" data-testid="mis-alerts-panel">
      <div className="flex items-center justify-between">
        <div>
          <div className="overline">Alerts & Exceptions</div>
          <div className="font-heading font-black text-xl mt-0.5">
            {totalOpen === 0 ? (
              <span className="text-emerald-700 flex items-center gap-2"><ShieldCheck size={20} /> All clear · no open exceptions</span>
            ) : (
              <span className="text-red-700 flex items-center gap-2"><AlertTriangle size={20} /> {totalOpen.toLocaleString("en-IN")} open exception{totalOpen === 1 ? "" : "s"}</span>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={load} className="rounded-none gap-1" data-testid="mis-alerts-refresh">
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3" data-testid="mis-alerts-grid">
        {data.alerts.map((a) => {
          const s = SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.blue;
          const Icon = ICONS[a.key] || AlertTriangle;
          const isEmpty = (a.count || 0) === 0;
          return (
            <button
              key={a.key}
              onClick={() => !isEmpty && setActive(a)}
              disabled={isEmpty}
              className={`swiss-card p-3 border-l-4 text-left transition-all ${isEmpty ? "opacity-50 cursor-default" : "hover:shadow-md hover:-translate-y-0.5 cursor-pointer"} ${isEmpty ? "border-gray-300" : s.border} ${!isEmpty ? s.bg : ""}`}
              data-testid={`alert-card-${a.key}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`p-1.5 ${isEmpty ? "bg-gray-100 text-gray-500" : `${s.iconBg} ${s.iconText}`}`}>
                  <Icon size={16} />
                </div>
                {!isEmpty && <ChevronRight size={14} className={s.iconText} />}
              </div>
              <div className="mt-2 overline text-[10px]">{a.label}</div>
              <div className={`font-heading font-black text-3xl mt-0.5 ${isEmpty ? "text-gray-400" : s.text}`}>
                {(a.count || 0).toLocaleString("en-IN")}
              </div>
              {!isEmpty && a.top?.length > 0 && (
                <div className={`text-[10px] mt-1 ${s.text} opacity-70 truncate`}>
                  {a.top[0].center_name || a.top[0].centre_name || a.top[0].batch_id || a.top[0].center_id_code || "—"}
                  {a.count > 1 && ` +${a.count - 1} more`}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Drill-down dialog */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="rounded-none max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="mis-alert-drill">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading flex items-center gap-2">
                  {(() => {
                    const Icon = ICONS[active.key] || AlertTriangle;
                    return <Icon size={18} />;
                  })()}
                  {active.label}
                  <span className="ml-auto text-sm font-normal">
                    <span className={SEVERITY_STYLES[active.severity]?.text || ""}>{active.count} record{active.count === 1 ? "" : "s"}</span>
                  </span>
                </DialogTitle>
              </DialogHeader>
              {active.top?.length ? (
                <div className="border border-[var(--border)]" data-testid="alert-drill-table">
                  <AlertItemTable rows={active.top} alertKey={active.key} />
                  {active.count > active.top.length && (
                    <div className="p-2 text-xs text-[var(--muted)] bg-gray-50 border-t border-[var(--border)]">
                      Showing top {active.top.length} of {active.count} — open the module tab to see all.
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-[var(--muted)] p-3">No preview items available.</div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setActive(null)} className="rounded-none">Close</Button>
                {active.target_tab && (
                  <Button
                    className="brand-btn rounded-none gap-1"
                    onClick={() => { setActive(null); onJumpToTab && onJumpToTab(active.target_tab); }}
                    data-testid="alert-jump-btn"
                  >
                    Jump to {active.target_tab.toUpperCase()} tab <ChevronRight size={13} />
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Renders the appropriate table shape based on alert key */
function AlertItemTable({ rows, alertKey }) {
  const cfg = {
    bg_expiring:           [["Center", "center_name"], ["Center ID", "center_id_code"], ["State", "state"], ["Expiry", "bg_validity_date"]],
    bg_expired:            [["Center", "center_name"], ["Center ID", "center_id_code"], ["Expired On", "bg_validity_date"]],
    accreditation_pending: [["Center", "center_name"], ["Center ID", "center_id_code"], ["Status", "status"]],
    assessment_pending:    [["Batch ID", "batch_id"], ["Center", "center_name"], ["Project", "project"], ["Enrolled", "total_enrolled"], ["End", "end_date"]],
    low_attendance:        [["Batch ID", "batch_id"], ["Center", "center_name"], ["Job Role", "job_role"], ["Attendance %", "attendance_pct"]],
    placement_pending:     [["Batch ID", "batch_id"], ["Center", "center_name"], ["Job Role", "job_role"], ["Certified", "total_certified"]],
    batches_ending:        [["Batch ID", "batch_id"], ["Center", "center_name"], ["Job Role", "job_role"], ["Ends On", "end_date"]],
    trainer_gap:           [["Centre", "centre_name"], ["Job Role", "job_role"], ["Required", "trainers_required"], ["Gap", "trainer_gap"]],
  }[alertKey] || [["Center", "center_name"]];

  return (
    <table className="w-full text-xs">
      <thead className="bg-gray-50 border-b border-[var(--border)]">
        <tr>
          {cfg.map(([l]) => <th key={l} className="p-2 text-left overline text-[10px]">{l}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-gray-50">
            {cfg.map(([l, key]) => {
              const val = r[key];
              const isPct = key === "attendance_pct";
              const isGap = key === "trainer_gap";
              const color = isPct && val < 60 ? "text-red-700 font-bold"
                          : isPct ? "text-amber-700 font-bold"
                          : isGap ? "text-red-700 font-bold"
                          : "";
              return (
                <td key={l} className={`p-2 ${color}`}>
                  {val == null || val === "" ? "—" : (isPct ? `${val}%` : String(val))}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

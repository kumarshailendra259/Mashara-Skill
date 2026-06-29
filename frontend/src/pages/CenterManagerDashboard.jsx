import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Users, UserCheck, UserX, AlertCircle, Plane, Layers, ShieldCheck, RefreshCw,
  Calendar, Inbox, ChevronRight, MapPin, Activity,
} from "lucide-react";

// Operations Dashboard — landing for center_manager (and other ops-only roles).
// Intentionally NO financial data (income/expense/profit) — those are gated by
// require_finance_visible. Shows: per-center attendance %, staff count, pending
// HR/regularisation queues, active batches/assets count, upcoming holidays, and
// "my pending approvals" inbox count.

export default function CenterManagerDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/dashboard/center-ops");
      setData(r.data || {});
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="overline text-center py-16" data-testid="cm-loading">Loading operations…</div>;
  }

  const kpi = data?.kpi || {};
  const centers = data?.my_centers || [];

  return (
    <div className="space-y-6" data-testid="center-manager-dashboard">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="overline">Operations Overview</div>
          <h1 className="font-heading font-black tracking-tight text-3xl flex items-center gap-2">
            <Activity size={28} className="text-[var(--brand)]" />
            Welcome back, {user?.name?.split(" ")[0] || "Manager"}
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            {centers.length === 0
              ? "No centers assigned yet — ask admin to assign one in Users."
              : <>Managing {centers.length} center{centers.length > 1 ? "s" : ""}: {centers.slice(0, 3).map((c) => c.name).join(", ")}{centers.length > 3 ? ` +${centers.length - 3} more` : ""}</>}
          </div>
        </div>
        <Button variant="outline" onClick={load} className="rounded-none gap-1" data-testid="btn-refresh">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Users}      label="Total Staff"            value={kpi.staff_total ?? 0} testid="kpi-staff-total" />
        <Kpi icon={UserCheck}  label="Present Today"          value={`${kpi.attendance_present ?? 0} (${kpi.attendance_pct ?? 0}%)`} accent="value-positive" testid="kpi-present" />
        <Kpi icon={UserX}      label="Absent Today"           value={kpi.attendance_absent ?? 0} accent="value-negative" testid="kpi-absent" />
        <Kpi icon={Inbox}      label="My Pending Approvals"   value={data?.my_pending_approvals ?? 0} accent={data?.my_pending_approvals ? "text-amber-700" : ""} testid="kpi-my-pending" onClick={() => nav("/pending-approvals")} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Plane}        label="Pending Leaves"          value={kpi.leaves_pending ?? 0} accent={kpi.leaves_pending ? "text-amber-700" : ""} testid="kpi-leaves" onClick={() => nav("/hrms")} />
        <Kpi icon={AlertCircle}  label="Pending Regularisations" value={kpi.regularisations_pending ?? 0} accent={kpi.regularisations_pending ? "text-amber-700" : ""} testid="kpi-regs" onClick={() => nav("/pending-approvals")} />
        <Kpi icon={Layers}       label="Active Batches"          value={kpi.batches_active ?? 0} testid="kpi-batches" onClick={() => nav("/programs")} />
        <Kpi icon={ShieldCheck}  label="Assets in Centers"       value={kpi.asset_total ?? 0} testid="kpi-assets" onClick={() => nav("/assets")} />
      </div>

      {/* Two-column: Centers list + Upcoming holidays */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="swiss-card p-4">
          <div className="overline text-[var(--brand)] flex items-center gap-2"><MapPin size={12} /> My Centers</div>
          {centers.length === 0 ? (
            <div className="text-sm text-[var(--muted)] mt-2">No center assignments. Contact admin.</div>
          ) : (
            <ul className="mt-3 space-y-2" data-testid="my-centers-list">
              {centers.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    {c.city && <div className="text-xs text-[var(--muted)]">{c.city}</div>}
                  </div>
                  <button type="button" onClick={() => nav("/hrms")} className="text-xs text-[var(--brand)] hover:underline font-bold flex items-center gap-1">
                    HRMS <ChevronRight size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="swiss-card p-4">
          <div className="overline text-[var(--brand)] flex items-center gap-2"><Calendar size={12} /> Upcoming Holidays</div>
          {(data?.upcoming_holidays || []).length === 0 ? (
            <div className="text-sm text-[var(--muted)] mt-2">No holidays in the near future.</div>
          ) : (
            <ul className="mt-3 space-y-2" data-testid="upcoming-holidays-list">
              {data.upcoming_holidays.map((h) => {
                const d = new Date(h.date);
                return (
                  <li key={h.id} className="flex items-start gap-3 text-sm">
                    <div className="bg-[var(--brand)] text-white text-[10px] font-bold uppercase px-2 py-1 leading-tight text-center min-w-[44px]">
                      <div>{d.toLocaleDateString(undefined, { month: "short" })}</div>
                      <div className="text-base leading-none mt-0.5">{d.getDate()}</div>
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{h.name}</div>
                      <div className="text-xs text-[var(--muted)] capitalize">{h.type || "holiday"}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Recent leaves */}
      {(data?.recent_leaves || []).length > 0 && (
        <div className="swiss-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="overline text-[var(--brand)] flex items-center gap-2"><Plane size={12} /> Recent Leave Activity</div>
            <button type="button" onClick={() => nav("/hrms")} className="text-xs text-[var(--brand)] hover:underline font-bold">All →</button>
          </div>
          <table className="min-w-full text-sm" data-testid="recent-leaves-table">
            <thead className="bg-gray-50">
              <tr>
                <Th>Staff</Th><Th>From → To</Th><Th>Status</Th><Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {data.recent_leaves.map((l) => (
                <tr key={l.id} className="border-t border-[var(--border)]">
                  <Td className="font-medium">{l.staff_name || l.staff_id?.slice(0, 8)}</Td>
                  <Td className="num text-xs">{l.start_date} → {l.end_date}</Td>
                  <Td><StatusPill s={l.status} /></Td>
                  <Td className="text-xs max-w-[300px] truncate">{l.reason || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const Kpi = ({ icon: Icon, label, value, accent, testid, onClick }) => (
  <div
    className={`swiss-card p-3 ${onClick ? "cursor-pointer hover:border-[var(--brand)] transition-colors" : ""}`}
    onClick={onClick}
    data-testid={testid}
  >
    <div className="flex items-center justify-between">
      <div className="overline">{label}</div>
      <Icon size={14} className="text-[var(--muted)]" />
    </div>
    <div className={`num font-bold text-2xl mt-1 ${accent || ""}`}>{value}</div>
  </div>
);

const StatusPill = ({ s }) => {
  const cls = s === "approved" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : s === "rejected" ? "bg-rose-50 text-rose-700 border-rose-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
  return <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border ${cls}`}>{(s || "").toUpperCase()}</span>;
};

const Th = ({ children }) => <th className="text-left px-3 py-2 overline text-xs whitespace-nowrap">{children}</th>;
const Td = ({ children, className }) => <td className={`px-3 py-2 ${className || ""}`}>{children}</td>;

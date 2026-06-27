import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { useAuth } from "@/context/AuthContext";
import {
  Users, Package, CalendarCheck, AlertTriangle, Receipt, TrendingUp, Wallet,
  ClipboardList, BadgeCheck, Building2, ArrowUpRight, Clock,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// Role-specific dashboard. Renders only when the backend role-widgets endpoint
// returns role-relevant fields. Admins still see the full standard dashboard
// below (this component renders ABOVE that).
export default function RoleWidgets() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/dashboard/role-widgets").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);

  const role = user?.role;
  if (!data || role === "admin" || role === "viewer") return null;

  // --- CENTER MANAGER / CENTER STAFF ---
  if (role === "center_manager" || role === "center_staff") {
    return (
      <div className="space-y-3" data-testid="role-widgets-center">
        <h2 className="font-heading font-black tracking-tight text-2xl flex items-center gap-2">
          <Building2 size={26} className="text-[var(--brand)]" /> My Center
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={CalendarCheck} label="Present Today" value={data.attendance_today_present || 0} color="value-positive" />
          <KPI icon={AlertTriangle} label="Absent Today" value={data.attendance_today_absent || 0} color="value-negative" />
          <KPI icon={Users} label="Total Staff" value={data.staff_total || 0} />
          <KPI icon={Package} label="Stock Value" value={inr(data.stock_value || 0)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KPI icon={Receipt} label="Pending Expense Reqs" value={data.pending_expense_requests || 0} link="/transactions" />
          <KPI icon={ClipboardList} label="Active Batches" value={data.batches_active || 0} link="/programs" />
          <KPI icon={Clock} label="Pending Leaves" value={(data.pending_leaves || []).length} link="/hrms" />
        </div>
      </div>
    );
  }

  // --- ACCOUNTANT ---
  if (role === "accountant") {
    return (
      <div className="space-y-3" data-testid="role-widgets-accountant">
        <h2 className="font-heading font-black tracking-tight text-2xl flex items-center gap-2">
          <Wallet size={26} className="text-[var(--brand)]" /> Accountant Console
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={Receipt} label="Pending Payments" value={data.pending_payments || 0} link="/transactions" />
          <KPI icon={BadgeCheck} label="Payroll Unpaid" value={data.payroll_unpaid || 0} link="/hrms" />
          <KPI icon={ClipboardList} label="Reimb To Pay" value={data.reimb_to_pay || 0} link="/hrms" />
          <KPI icon={ClipboardList} label="Reimb L1 Done" value={data.reimb_l1_approved || 0} link="/hrms" />
        </div>
        {(data.cash_flow_monthly || []).length > 0 && (
          <div className="swiss-card p-4">
            <div className="overline mb-2">Cash Flow — Last 6 Months</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.cash_flow_monthly}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 4" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 0, border: "1px solid #0a0a0a" }} />
                  <Bar dataKey="income" fill="#00A859" name="Income" />
                  <Bar dataKey="expense" fill="#FF2A2A" name="Expense" />
                  <Bar dataKey="investment" fill="#002FA7" name="Investment" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- HR ---
  if (role === "hr") {
    const pct = data.attendance_compliance_pct || 0;
    return (
      <div className="space-y-3" data-testid="role-widgets-hr">
        <h2 className="font-heading font-black tracking-tight text-2xl flex items-center gap-2">
          <Users size={26} className="text-[var(--brand)]" /> HR Console
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={Users} label="Total Staff" value={data.staff_total || 0} />
          <KPI icon={BadgeCheck} label="Active" value={data.staff_active || 0} color="value-positive" />
          <KPI icon={ArrowUpRight} label="New Joiners (30d)" value={data.new_joiners_30d || 0} />
          <KPI icon={CalendarCheck} label="Attendance Today" value={`${pct}%`} color={pct > 80 ? "value-positive" : "value-negative"} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
          <KPI icon={Clock} label="Pending Leaves" value={data.pending_leaves || 0} link="/hrms" />
          <KPI icon={ClipboardList} label="Reimb HR Step" value={data.pending_reimb_hr || 0} link="/hrms" />
        </div>
      </div>
    );
  }

  // --- SENIOR MANAGER / MANAGER ---
  if (role === "senior_manager" || role === "manager") {
    return (
      <div className="space-y-3" data-testid="role-widgets-manager">
        <h2 className="font-heading font-black tracking-tight text-2xl flex items-center gap-2">
          <TrendingUp size={26} className="text-[var(--brand)]" />
          {role === "senior_manager" ? "Regional Overview" : "Team Overview"}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
          <KPI icon={Receipt} label="Pending Approvals" value={data.pending_approvals_count || 0} link="/pending-approvals" />
          <KPI icon={TrendingUp} label="Top Centers" value={(data.center_ranking_30d || []).length} />
        </div>
        {(data.center_ranking_30d || []).length > 0 && (
          <div className="swiss-card p-4 overflow-x-auto" data-testid="center-ranking">
            <div className="overline mb-2">Center Income Ranking — Last 30 Days</div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] overline">
                <th className="text-left py-2">#</th>
                <th className="text-left py-2">Center</th>
                <th className="text-right py-2">Income</th>
                <th className="text-right py-2">Txns</th>
              </tr></thead>
              <tbody>
                {data.center_ranking_30d.map((c, idx) => (
                  <tr key={c.center_id} className="border-b border-[var(--border)]">
                    <td className="py-2 font-bold">{idx + 1}</td>
                    <td className="py-2 font-medium">{c.center_name}</td>
                    <td className="py-2 num value-positive">{inr(c.income)}</td>
                    <td className="py-2 num text-[var(--muted)]">{c.txn_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // --- REPORTING AUTHORITY ---
  if (role === "reporting_authority") {
    return (
      <div className="space-y-3" data-testid="role-widgets-ra">
        <h2 className="font-heading font-black tracking-tight text-2xl flex items-center gap-2">
          <BadgeCheck size={26} className="text-[var(--brand)]" /> Verification Console
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
          <KPI icon={ClipboardList} label="Pending Verifications" value={data.pending_verifications || 0} link="/pending-approvals" />
          <KPI icon={AlertTriangle} label="Escalations (>3d)" value={data.escalations_3d || 0} color="value-negative" />
        </div>
      </div>
    );
  }

  // --- CENTER PARTNER ---
  if (role === "center_partner") {
    return (
      <div className="space-y-3" data-testid="role-widgets-center-partner">
        <h2 className="font-heading font-black tracking-tight text-2xl flex items-center gap-2">
          <Wallet size={26} className="text-[var(--brand)]" /> Partner Financial Overview
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={TrendingUp} label="Income" value={inr(data.income_total || 0)} color="value-positive" />
          <KPI icon={Receipt} label="Expense" value={inr(data.expense_total || 0)} color="value-negative" />
          <KPI icon={Wallet} label="Profit" value={inr(data.profit || 0)} color={data.profit > 0 ? "value-positive" : "value-negative"} />
          <KPI icon={ClipboardList} label="Pending Expense Reqs" value={data.pending_expense_requests || 0} link="/pending-approvals" />
        </div>
      </div>
    );
  }

  return null;
}

function KPI({ icon: Icon, label, value, color = "", link = null }) {
  const body = (
    <div className={`swiss-card p-4 ${link ? "hover:shadow-md transition cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="overline">{label}</div>
        {Icon && <Icon size={16} className="text-[var(--brand)]" />}
      </div>
      <div className={`num font-bold text-2xl ${color}`}>{value}</div>
    </div>
  );
  return link ? <Link to={link} className="block">{body}</Link> : body;
}

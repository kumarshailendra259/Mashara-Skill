import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { useFY } from "@/context/FYContext";
import { inr } from "@/lib/i18n";
import PrintButton from "@/components/PrintButton";
import FYSwitcher from "@/components/FYSwitcher";
import { BGExpiryAlert } from "@/pages/BankGuarantees";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import RoleWidgets from "@/components/RoleWidgets";
import UpcomingWidget from "@/components/UpcomingWidget";
import TodayLiveWidget from "@/components/TodayLiveWidget";
import {
  Wallet, TrendingUp, TrendingDown, Percent, ArrowLeftRight, ClipboardCheck,
  IndianRupee, CreditCard, ArrowUpRight, ArrowDownRight, ArrowRight, ChevronRight,
  Building2, Users, Boxes, MapPin, FileBarChart2, UserPlus, FileSignature,
  Handshake, Clock, CheckCircle2, Zap, Activity, Receipt,
} from "lucide-react";

const ENTITY_TYPES = ["company", "partner", "center", "project"];
const BREAKDOWN_TYPES = ["company", "partner", "center", "project", "item"];

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function Dashboard() {
  const { t } = useLang();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState({ company: [], partner: [], center: [], project: [] });
  const [settlement, setSettlement] = useState(null);
  const showSettlement = ["partner", "admin", "manager", "senior_manager", "accountant", "hr"].includes(user?.role);
  const [filters, setFilters] = useState({
    company_id: "", partner_id: "", center_id: "", project_id: "", start: "", end: "",
  });
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [milestoneSummary, setMilestoneSummary] = useState(null);
  const [foodingSummary, setFoodingSummary] = useState(null);

  useEffect(() => {
    Promise.all(ENTITY_TYPES.map((tt) => api.get(`/entities/${tt}`))).then((res) => {
      const e = {};
      ENTITY_TYPES.forEach((tt, i) => { e[tt] = res[i].data; });
      setEntities(e);
    }).catch(() => {});
  }, []);

  const { fy } = useFY();
  const query = useMemo(() => {
    const p = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    if (fy && fy !== "all") p.fy = fy;
    return p;
  }, [filters, fy]);

  useEffect(() => {
    const params = { ...query, include_settlement_history: showSettlement };
    api.get("/dashboard/all", { params })
      .then((r) => {
        const d = r.data || {};
        setData(d.summary || null);
        setMilestoneSummary(d.milestone_income || null);
        setFoodingSummary(d.fooding_income || null);
        if (showSettlement) setSettlement(d.settlement || null);
      })
      .catch(() => {
        setData(null); setMilestoneSummary(null); setFoodingSummary(null);
        if (showSettlement) setSettlement(null);
      });
  }, [query, showSettlement]);

  // Operational overview (transaction status, pending actions, org counts, activity)
  useEffect(() => {
    const params = {};
    if (filters.center_id) params.center_id = filters.center_id;
    if (fy && fy !== "all") params.fy = fy;
    api.get("/dashboard/overview", { params })
      .then((r) => { setOverview(r.data || null); setLastUpdated(new Date()); })
      .catch(() => setOverview(null));
  }, [filters.center_id, fy]);

  const refreshSettlement = () => {
    if (!showSettlement) return;
    const p = { include_history: true };
    if (query.start) p.start = query.start;
    if (query.end) p.end = query.end;
    if (query.center_id) p.center_id = query.center_id;
    api.get("/dashboard/settlement", { params: p }).then((r) => setSettlement(r.data)).catch(() => setSettlement(null));
  };

  const totals = data?.totals || { investment: 0, income: 0, expense: 0, deduction: 0, profit: 0 };
  const tx = overview?.transactions || { total: 0, approved: 0, pending: 0, rejected: 0 };
  const pa = overview?.pending_actions || { approvals: 0, payment_requests: 0, advances: 0, hr_actions: 0, partner_settlement: 0 };

  // Month-over-month % change for a summary key (real, from the monthly series).
  const mom = (key) => {
    const m = data?.monthly || [];
    if (m.length < 2) return null;
    const cur = m[m.length - 1][key] || 0;
    const prev = m[m.length - 2][key] || 0;
    if (!prev) return null;
    return ((cur - prev) / prev) * 100;
  };

  const pieData = [
    { name: t("investment"), value: totals.investment, color: "#002FA7" },
    { name: t("income"), value: totals.income, color: "#00A859" },
    { name: t("expense"), value: totals.expense, color: "#FF2A2A" },
    { name: t("deduction"), value: totals.deduction, color: "#B45309" },
  ].filter((d) => d.value > 0);

  // Transaction status donut (Completed / Pending / Failed).
  const txStatus = [
    { name: "Completed", value: tx.approved, color: "#10b981" },
    { name: "Pending", value: tx.pending, color: "#3b82f6" },
    { name: "Failed", value: tx.rejected, color: "#ef4444" },
  ];
  const txPct = (v) => (tx.total ? Math.round((v / tx.total) * 100) : 0);

  // Finance Overview — income vs expense monthly.
  const financeMonthly = (data?.monthly || []).map((m) => ({ month: m.month, income: m.income || 0, expense: m.expense || 0 }));

  // Center-wise activity — derived from by_center volume (income+expense+investment).
  const centerActivity = useMemo(() => {
    const rows = (data?.by_center || [])
      .map((r) => ({ name: r.name, vol: (r.income || 0) + (r.expense || 0) + (r.investment || 0) }))
      .filter((r) => r.vol > 0)
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 4);
    const max = rows.length ? rows[0].vol : 1;
    return rows.map((r) => ({ ...r, pct: Math.round((r.vol / max) * 100) }));
  }, [data?.by_center]);

  const pendingActions = [
    { label: "Pending Approvals", value: pa.approvals, icon: CheckCircle2, to: "/pending-approvals", dot: "bg-emerald-400" },
    { label: "Pending Payment Requests", value: pa.payment_requests, icon: FileSignature, to: "/quotations", dot: "bg-blue-400" },
    { label: "Pending Advances", value: pa.advances, icon: Wallet, to: "/advances", dot: "bg-amber-400" },
    { label: "Pending HR Actions", value: pa.hr_actions, icon: Users, to: "/hrms", dot: "bg-pink-400" },
    { label: "Partner Settlement Pending", value: pa.partner_settlement, icon: Handshake, to: "/partner-settlement", dot: "bg-violet-400" },
  ];

  const isAdmin = user?.role === "admin" || user?.role === "company_admin";
  const quickActions = [
    isAdmin && { label: "Add User", icon: UserPlus, to: "/users", tone: "bg-blue-50 text-blue-700" },
    { label: "Create Transaction", icon: ArrowLeftRight, to: "/transactions", tone: "bg-emerald-50 text-emerald-700" },
    { label: "View Approvals", icon: ClipboardCheck, to: "/pending-approvals", tone: "bg-violet-50 text-violet-700" },
    ["admin", "company_admin", "manager", "senior_manager"].includes(user?.role) && { label: "Manage Centers", icon: MapPin, to: "/centers", tone: "bg-orange-50 text-orange-700" },
    { label: "Manage Batches", icon: Boxes, to: "/batch-management", tone: "bg-cyan-50 text-cyan-700" },
    { label: "View Reports", icon: FileBarChart2, to: "/reports", tone: "bg-indigo-50 text-indigo-700" },
  ].filter(Boolean);

  const orgStats = [
    { label: "Company", value: entities.company.length, icon: Building2, color: "text-blue-600 bg-blue-50" },
    { label: "Centers", value: entities.center.length, icon: MapPin, color: "text-emerald-600 bg-emerald-50" },
    { label: "Active Users", value: overview?.org?.active_users ?? 0, icon: Users, color: "text-violet-600 bg-violet-50" },
    { label: "Active Batches", value: overview?.org?.active_batches ?? 0, icon: Boxes, color: "text-orange-600 bg-orange-50" },
  ];

  const kpis = [
    { label: "Total Transactions", value: tx.total.toLocaleString("en-IN"), icon: ArrowLeftRight, color: "text-blue-600 bg-blue-100", to: "/transactions", sub: `${tx.approved.toLocaleString("en-IN")} approved · ${tx.pending} pending` },
    { label: "Pending Approvals", value: pa.approvals.toLocaleString("en-IN"), icon: CheckCircle2, color: "text-amber-600 bg-amber-100", to: "/pending-approvals", sub: "Needs your action" },
    { label: t("total_income"), value: inr(totals.income), icon: IndianRupee, color: "text-emerald-600 bg-emerald-100", to: "/transactions", trend: mom("income") },
    { label: t("total_expense"), value: inr(totals.expense), icon: CreditCard, color: "text-purple-600 bg-purple-100", to: "/transactions", trend: mom("expense"), invert: true },
  ];

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));
  const companyLine = entities.company.map((c) => c.name).slice(0, 1).join("") || "All Companies";

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <BGExpiryAlert />

      {/* ===== Welcome hero ===== */}
      <div className="dash-hero rounded-2xl px-5 py-6 md:px-8 md:py-7 relative overflow-hidden" data-testid="dashboard-welcome">
        {/* Controls: in normal flow on mobile (avoids overlapping the title), floated on md+ */}
        <div className="flex items-center justify-end gap-2 mb-3 md:mb-0 md:absolute md:top-4 md:right-4 z-20">
          <FYSwitcher variant="inline" />
          <PrintButton />
        </div>
        <div className="relative z-10 max-w-3xl">
          <h1 className="font-heading font-black tracking-tight text-2xl md:text-3xl text-white">
            Welcome back, {user?.name || user?.email?.split("@")[0] || "there"}!
          </h1>
          <p className="text-white/80 text-sm md:text-base mt-1">Here's your business operations overview.</p>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="dash-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" data-testid="hero-company"><Building2 size={13} /> {companyLine}</span>
            <Select value={filters.center_id || "__all"} onValueChange={(v) => setF("center_id", v === "__all" ? "" : v)}>
              <SelectTrigger data-testid="dashboard-center-focus" className="dash-chip h-auto w-auto gap-1.5 rounded-full border-0 px-3 py-1 text-xs font-medium text-white focus:ring-0 focus:ring-offset-0 [&>svg]:opacity-70">
                <MapPin size={13} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Centers</SelectItem>
                {entities.center.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="dash-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"><Clock size={13} /> {fy && fy !== "all" ? `FY ${fy}` : "All Financial Years"}</span>
            {lastUpdated && <span className="dash-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"><Activity size={13} /> Updated {lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
        </div>
        {/* decorative */}
        <div className="hidden lg:flex items-end gap-1.5 absolute right-10 bottom-5 opacity-80 z-0" aria-hidden>
          {[34, 52, 40, 66, 48, 78].map((h, i) => (
            <div key={i} className="w-3.5 rounded-t-md bg-white/25" style={{ height: h }} />
          ))}
          <TrendingUp className="text-white/70 ml-1 mb-1" size={34} />
        </div>
      </div>

      {/* ===== KPI row ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="dashboard-kpis">
        {kpis.map((k) => {
          const Icon = k.icon;
          const up = k.trend != null && k.trend >= 0;
          const good = k.invert ? !up : up;
          return (
            <button key={k.label} type="button" onClick={() => navigate(k.to)} data-testid={`kpi-${k.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              className="dash-kpi text-left swiss-card p-5 flex flex-col gap-3 bg-white">
              <div className="flex items-start justify-between">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${k.color}`}><Icon size={20} /></div>
                <ChevronRight size={18} className="text-[var(--muted)]" />
              </div>
              <div>
                <div className="overline text-[11px]">{k.label}</div>
                <div className="font-heading font-black tracking-tight text-2xl mt-0.5">{k.value}</div>
              </div>
              {k.trend != null ? (
                <div className={`inline-flex items-center gap-1 text-xs font-semibold ${good ? "text-emerald-600" : "text-red-500"}`}>
                  {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {Math.abs(k.trend).toFixed(1)}% <span className="text-[var(--muted)] font-normal">vs last month</span>
                </div>
              ) : (
                <div className="text-xs text-[var(--muted)]">{k.sub}</div>
              )}
            </button>
          );
        })}
      </div>

      {/* ===== Finance Overview · Transaction Status · Pending Actions ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Finance Overview */}
        <div className="swiss-card p-5 lg:col-span-5" data-testid="finance-overview">
          <div className="flex items-center justify-between mb-3">
            <div className="font-heading font-bold tracking-tight flex items-center gap-2"><TrendingUp size={16} className="text-[var(--brand)]" /> Finance Overview</div>
            <span className="text-xs text-[var(--muted)]">{fy && fy !== "all" ? `FY ${fy}` : "All years"}</span>
          </div>
          <div className="h-64">
            {financeMonthly.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={financeMonthly}>
                  <CartesianGrid stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
                  <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(15,23,42,0.08)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" name={t("income")} dataKey="income" stroke="#2563EB" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" name={t("expense")} dataKey="expense" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart text={t("no_data")} />}
          </div>
        </div>

        {/* Transaction Status donut */}
        <div className="swiss-card p-5 lg:col-span-4" data-testid="transaction-status">
          <div className="font-heading font-bold tracking-tight mb-2">Transaction Status</div>
          <div className="flex items-center gap-4">
            <div className="relative w-36 h-36 shrink-0">
              {tx.total > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={txStatus} dataKey="value" nameKey="name" innerRadius={48} outerRadius={66} paddingAngle={2} stroke="none">
                      {txStatus.map((e) => <Cell key={e.name} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [`${v} (${txPct(v)}%)`, n]} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb" }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="w-full h-full rounded-full border-8 border-gray-100" />}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="font-heading font-black text-lg leading-none">{tx.total.toLocaleString("en-IN")}</div>
                <div className="overline text-[9px]">Total</div>
              </div>
            </div>
            <div className="flex-1 space-y-2.5">
              {txStatus.map((s) => (
                <div key={s.name} className="flex items-center justify-between text-sm" data-testid={`txstatus-${s.name.toLowerCase()}`}>
                  <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} /> {s.name}</span>
                  <span className="font-semibold num">{txPct(s.value)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pending Actions (dark) */}
        <div className="rounded-xl p-5 lg:col-span-3 text-white" style={{ background: "linear-gradient(160deg,#0B1F3A,#15336b)" }} data-testid="pending-actions">
          <div className="flex items-center justify-between mb-3">
            <div className="font-heading font-bold tracking-tight">Pending Actions</div>
            <button type="button" onClick={() => navigate("/pending-approvals")} className="text-xs text-blue-200 hover:text-white inline-flex items-center gap-1" data-testid="pending-actions-viewall">View All <ArrowRight size={12} /></button>
          </div>
          <div className="space-y-1">
            {pendingActions.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.label} type="button" onClick={() => navigate(a.to)} data-testid={`pending-${a.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                  className="w-full flex items-center gap-2.5 py-2 px-1 rounded-lg hover:bg-white/10 transition-colors text-left">
                  <span className={`w-2 h-2 rounded-full ${a.dot}`} />
                  <Icon size={15} className="text-white/70 shrink-0" />
                  <span className="flex-1 text-[13px] text-white/90 truncate">{a.label}</span>
                  <span className="min-w-[22px] text-center text-xs font-bold bg-white/15 rounded-full px-1.5 py-0.5">{a.value > 99 ? "99+" : a.value}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== Organization Overview · Recent Activity · Quick Actions ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Organization Overview */}
        <div className="swiss-card p-5" data-testid="org-overview">
          <div className="flex items-center justify-between mb-4">
            <div className="font-heading font-bold tracking-tight">Organization Overview</div>
            <button type="button" onClick={() => navigate("/centers")} className="text-xs text-[var(--brand)] hover:underline inline-flex items-center gap-1">View Details <ArrowRight size={12} /></button>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {orgStats.map((o) => {
              const Icon = o.icon;
              return (
                <div key={o.label} className="text-center" data-testid={`org-${o.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto ${o.color}`}><Icon size={18} /></div>
                  <div className="font-heading font-black text-lg mt-1.5 leading-none">{o.value}</div>
                  <div className="overline text-[9px] mt-0.5">{o.label}</div>
                </div>
              );
            })}
          </div>
          <div className="pt-3 border-t border-[var(--border)]">
            <div className="overline text-[10px] mb-2">Center-wise Activity</div>
            {centerActivity.length ? centerActivity.map((c, i) => (
              <div key={c.name} className="mb-2.5">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium truncate pr-2">{c.name}</span>
                  <span className="num text-[var(--muted)]">{c.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="dash-bar h-full rounded-full" style={{ width: `${c.pct}%`, background: ["#2563EB", "#10b981", "#8b5cf6", "#f59e0b"][i % 4] }} />
                </div>
              </div>
            )) : <div className="overline text-center py-4">{t("no_data")}</div>}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="swiss-card p-5" data-testid="recent-activity">
          <div className="flex items-center justify-between mb-4">
            <div className="font-heading font-bold tracking-tight flex items-center gap-2"><Clock size={15} className="text-[var(--muted)]" /> Recent Activity</div>
            <button type="button" onClick={() => navigate("/transactions")} className="text-xs text-[var(--brand)] hover:underline inline-flex items-center gap-1">View All <ArrowRight size={12} /></button>
          </div>
          {overview?.recent_activity?.length ? (
            <ul className="space-y-3">
              {overview.recent_activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3" data-testid={`activity-${a.id}`}>
                  <span className={`mt-1 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${a.type === "income" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                    {a.type === "income" ? <TrendingUp size={13} /> : <Receipt size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug line-clamp-2">{a.description}</div>
                    <div className="overline text-[10px] mt-0.5">{timeAgo(a.at)} · {a.by} · <span className="num">{inr(a.amount)}</span></div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="overline text-center py-6">{t("no_data")}</div>}
        </div>

        {/* Quick Actions */}
        <div className="swiss-card p-5" data-testid="quick-actions">
          <div className="font-heading font-bold tracking-tight flex items-center gap-2 mb-4"><Zap size={15} className="text-amber-500" /> Quick Actions</div>
          <div className="grid grid-cols-3 gap-3">
            {quickActions.map((q) => {
              const Icon = q.icon;
              return (
                <button key={q.label} type="button" onClick={() => navigate(q.to)} data-testid={`qa-${q.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                  className={`dash-qa rounded-xl p-3 flex flex-col items-center gap-2 text-center ${q.tone}`}>
                  <Icon size={20} />
                  <span className="text-[11px] font-semibold leading-tight">{q.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Role-specific personalised widgets */}
      <RoleWidgets />

      {/* ===== Detailed Analytics (existing functionality preserved) ===== */}
      <div className="pt-2">
        <h2 className="font-heading font-black tracking-tight text-xl mb-1">Detailed Analytics</h2>
        <p className="text-sm text-[var(--muted)] mb-4">Filter and drill down across companies, partners, centers and projects.</p>
      </div>

      {/* Filters */}
      <div className="swiss-card p-4 grid grid-cols-2 md:grid-cols-6 gap-3" data-testid="dashboard-filters">
        {ENTITY_TYPES.map((etype) => (
          <div key={etype} className="space-y-1">
            <Label className="overline">{t(etype)}</Label>
            <Select value={filters[`${etype}_id`] || "__all"} onValueChange={(v) => setF(`${etype}_id`, v === "__all" ? "" : v)}>
              <SelectTrigger className="rounded-md" data-testid={`filter-${etype}`}><SelectValue placeholder={t("all")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t("all")}</SelectItem>
                {entities[etype].map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
        <div className="space-y-1">
          <Label className="overline">From</Label>
          <Input type="date" value={filters.start} onChange={(e) => setF("start", e.target.value)} className="rounded-md" data-testid="filter-start" />
        </div>
        <div className="space-y-1">
          <Label className="overline">To</Label>
          <Input type="date" value={filters.end} onChange={(e) => setF("end", e.target.value)} className="rounded-md" data-testid="filter-end" />
        </div>
      </div>

      {/* Distribution + monthly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="swiss-card p-5 lg:col-span-2 h-80" data-testid="chart-monthly">
          <div className="flex items-center justify-between mb-3">
            <div className="font-heading font-bold tracking-tight">{t("monthly_trend")}</div>
          </div>
          {data?.monthly?.length ? (
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={data.monthly}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 4" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(15,23,42,0.08)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="investment" stroke="#002FA7" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="income" stroke="#00A859" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expense" stroke="#FF2A2A" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart text={t("no_data")} />}
        </div>
        <div className="swiss-card p-5 h-80" data-testid="chart-distribution">
          <div className="font-heading font-bold tracking-tight mb-3">{t("distribution")}</div>
          {pieData.length ? (
            <ResponsiveContainer width="100%" height="90%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} stroke="#fff">
                  {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(15,23,42,0.08)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart text={t("no_data")} />}
        </div>
      </div>

      {/* Company vs Partner — separated charts */}
      <CompanyPartnerCharts entities={entities} baseFilters={filters} />

      {/* Upcoming + live activity widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TodayLiveWidget />
            <UpcomingWidget />
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="swiss-card p-5" data-testid="breakdown-section">
        <div className="font-heading font-bold tracking-tight mb-4">{t("breakdown")}</div>
        <Tabs defaultValue="company">
          <TabsList className="rounded-none bg-transparent border-b border-[var(--border)] p-0 h-auto">
            {BREAKDOWN_TYPES.map((tt) => (
              <TabsTrigger key={tt} value={tt} data-testid={`tab-${tt}`}
                className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand)] data-[state=active]:text-[var(--brand)] px-4 py-2">
                {t(tt)}
              </TabsTrigger>
            ))}
          </TabsList>
          {BREAKDOWN_TYPES.map((tt) => {
            const rows = (data?.[`by_${tt}`] || []).slice(0, 10);
            const isItem = tt === "item";
            return (
              <TabsContent key={tt} value={tt} className="mt-4">
                {rows.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] overline">
                          <th className="text-left py-2">{t(tt)}</th>
                          {isItem && <th className="text-right">{t("quantity")}</th>}
                          <th className="text-right">{t("investment")}</th>
                          <th className="text-right">{t("income")}</th>
                          <th className="text-right">{t("expense")}</th>
                          <th className="text-right">{t("deduction")}</th>
                          <th className="text-right">{t("profit")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.id || r.name || i} className="border-b border-[var(--border)] hover:bg-gray-50">
                            <td className="py-2 font-medium">{r.name}</td>
                            {isItem && <td className="num">{(r.quantity || 0).toLocaleString()}</td>}
                            <td className="num">{inr(r.investment)}</td>
                            <td className="num value-positive">{inr(r.income)}</td>
                            <td className="num value-negative">{inr(r.expense)}</td>
                            <td className="num text-amber-700">{inr(r.deduction)}</td>
                            <td className={`num font-semibold ${r.profit >= 0 ? "value-positive" : "value-negative"}`}>{inr(r.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="overline text-center py-6">{t("no_data")}</div>}
              </TabsContent>
            );
          })}
        </Tabs>
      </div>

      {/* Milestone Income Section */}
      {milestoneSummary && milestoneSummary.count > 0 && (
        <div className="space-y-3" data-testid="milestone-income-section">
          <h2 className="font-heading font-black tracking-tight text-2xl">Milestone Income</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="swiss-card p-3"><div className="overline">Total Milestone Income</div><div className="num font-bold text-2xl value-positive">{inr(milestoneSummary.total)}</div></div>
            <div className="swiss-card p-3"><div className="overline">1st Milestone</div><div className="num font-bold text-xl">{inr(milestoneSummary.by_milestone["1st"])}</div></div>
            <div className="swiss-card p-3"><div className="overline">2nd Milestone</div><div className="num font-bold text-xl">{inr(milestoneSummary.by_milestone["2nd"])}</div></div>
            <div className="swiss-card p-3"><div className="overline">3rd Milestone</div><div className="num font-bold text-xl">{inr(milestoneSummary.by_milestone["3rd"])}</div></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Partner-wise split */}
            <div className="swiss-card p-4" data-testid="milestone-by-partner">
              <div className="overline mb-2">Partner-wise Split</div>
              {milestoneSummary.by_partner.length === 0 ? (
                <div className="overline text-center py-6">No partner allocations</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border)] overline">
                    <th className="text-left py-2">Partner</th>
                    <th className="text-right py-2">Amount</th>
                    <th className="text-right py-2">Share</th>
                  </tr></thead>
                  <tbody>
                    {milestoneSummary.by_partner.map((r) => {
                      const pct = milestoneSummary.total > 0 ? (r.amount / milestoneSummary.total * 100).toFixed(1) : "0.0";
                      return (
                        <tr key={r.partner_id || "unassigned"} className="border-b border-[var(--border)]">
                          <td className="py-2 font-medium">{r.partner_name}</td>
                          <td className="py-2 num value-positive">{inr(r.amount)}</td>
                          <td className="py-2 num text-[var(--muted)]">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Project-wise */}
            <div className="swiss-card p-4" data-testid="milestone-by-project">
              <div className="overline mb-2">Project-wise</div>
              {milestoneSummary.by_project.length === 0 ? (
                <div className="overline text-center py-6">No project allocations</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border)] overline">
                    <th className="text-left py-2">Project</th>
                    <th className="text-right py-2">Amount</th>
                    <th className="text-right py-2">Share</th>
                  </tr></thead>
                  <tbody>
                    {milestoneSummary.by_project.map((r) => {
                      const pct = milestoneSummary.total > 0 ? (r.amount / milestoneSummary.total * 100).toFixed(1) : "0.0";
                      return (
                        <tr key={r.project_id || "none"} className="border-b border-[var(--border)]">
                          <td className="py-2 font-medium">{r.project_name}</td>
                          <td className="py-2 num value-positive">{inr(r.amount)}</td>
                          <td className="py-2 num text-[var(--muted)]">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fooding Income Section */}
      {foodingSummary && foodingSummary.count > 0 && (
        <div className="space-y-3" data-testid="fooding-income-section">
          <h2 className="font-heading font-black tracking-tight text-2xl flex items-center gap-2">
            <span>🍽️</span> Fooding Income
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="swiss-card p-3"><div className="overline">Total Fooding</div><div className="num font-bold text-2xl value-positive">{inr(foodingSummary.total)}</div></div>
            <div className="swiss-card p-3"><div className="overline">Company Share</div><div className="num font-bold text-xl">{inr(foodingSummary.company_total)}</div></div>
            <div className="swiss-card p-3"><div className="overline">Partners Share</div><div className="num font-bold text-xl">{inr(foodingSummary.partner_total)}</div></div>
            <div className="swiss-card p-3"><div className="overline">Entries</div><div className="num font-bold text-2xl">{foodingSummary.count}</div></div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Monthly trend bar chart */}
            <div className="swiss-card p-4 lg:col-span-2 h-72" data-testid="fooding-monthly-chart">
              <div className="overline mb-2">Monthly Trend</div>
              {foodingSummary.monthly.length === 0 ? (
                <EmptyChart text="No monthly data" />
              ) : (
                <ResponsiveContainer width="100%" height="88%">
                  <BarChart data={foodingSummary.monthly}>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 4" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(15,23,42,0.08)" }} />
                    <Bar dataKey="amount" fill="#0a3bc5" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* By company table */}
            <div className="swiss-card p-4" data-testid="fooding-by-company">
              <div className="overline mb-2">By Company</div>
              {foodingSummary.by_company.length === 0 ? (
                <div className="overline text-center py-6">No company data</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border)] overline">
                    <th className="text-left py-2">Company</th>
                    <th className="text-right py-2">Amount</th>
                  </tr></thead>
                  <tbody>
                    {foodingSummary.by_company.map((r) => (
                      <tr key={r.company_id || "unassigned"} className="border-b border-[var(--border)]">
                        <td className="py-2 font-medium">{r.company_name}</td>
                        <td className="py-2 num value-positive">{inr(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Partner-wise split */}
          {foodingSummary.by_partner.length > 0 && (
            <div className="swiss-card p-4" data-testid="fooding-by-partner">
              <div className="overline mb-2">By Partner</div>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] overline">
                  <th className="text-left py-2">Partner</th>
                  <th className="text-right py-2">Amount</th>
                  <th className="text-right py-2">Share</th>
                </tr></thead>
                <tbody>
                  {foodingSummary.by_partner.map((r) => {
                    const pct = foodingSummary.partner_total > 0 ? (r.amount / foodingSummary.partner_total * 100).toFixed(1) : "0.0";
                    return (
                      <tr key={r.partner_id} className="border-b border-[var(--border)]">
                        <td className="py-2 font-medium">{r.partner_name}</td>
                        <td className="py-2 num value-positive">{inr(r.amount)}</td>
                        <td className="py-2 num text-[var(--muted)]">{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyChart({ text }) {
  return <div className="h-full flex items-center justify-center overline">{text}</div>;
}

/**
 * Section: Company Income chart (separate) and Partner charts (Investment+Income+Expense)
 * with a per-partner dropdown filter. Both blocks reuse /dashboard/summary
 * with company_id / partner_id filters so monthly data is already scoped.
 */
function CompanyPartnerCharts({ entities, baseFilters }) {
  const [companyId, setCompanyId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [companyData, setCompanyData] = useState(null);
  const [partnerData, setPartnerData] = useState(null);

  // Build common filter params (excluding partner/company so each chart can override)
  const commonParams = useMemo(() => {
    const p = {};
    if (baseFilters.center_id) p.center_id = baseFilters.center_id;
    if (baseFilters.project_id) p.project_id = baseFilters.project_id;
    if (baseFilters.start) p.start = baseFilters.start;
    if (baseFilters.end) p.end = baseFilters.end;
    return p;
  }, [baseFilters]);

  // Company chart: fetch with company_id filter (if any). Shows monthly income trend.
  useEffect(() => {
    const params = { ...commonParams };
    if (companyId) params.company_id = companyId;
    api.get("/dashboard/summary", { params })
      .then((r) => setCompanyData(r.data))
      .catch(() => setCompanyData(null));
  }, [companyId, commonParams]);

  // Partner chart: requires a partner selected
  useEffect(() => {
    if (!partnerId) { setPartnerData(null); return; }
    const params = { ...commonParams, partner_id: partnerId };
    api.get("/dashboard/summary", { params })
      .then((r) => setPartnerData(r.data))
      .catch(() => setPartnerData(null));
  }, [partnerId, commonParams]);

  // Income-only monthly for company chart
  const companyMonthly = (companyData?.monthly || []).map((m) => ({ month: m.month, income: m.income || 0 }));
  const companyTotal = companyData?.totals?.income || 0;

  return (
    <div className="space-y-4" data-testid="company-partner-section">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Company Income */}
        <div className="swiss-card p-5" data-testid="chart-company-income">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div>
              <div className="overline">Company</div>
              <div className="font-heading font-bold tracking-tight text-lg">Company Income</div>
              <div className="num text-sm value-positive mt-0.5">Total: {inr(companyTotal)}</div>
            </div>
            <Select value={companyId || "__all"} onValueChange={(v) => setCompanyId(v === "__all" ? "" : v)}>
              <SelectTrigger className="rounded-none w-56" data-testid="filter-company-chart"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Companies</SelectItem>
                {entities.company.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="h-64">
            {companyMonthly.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={companyMonthly}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 4" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(15,23,42,0.08)" }} />
                  <Bar dataKey="income" fill="#00A859" />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="No company income in range" />}
          </div>
        </div>

        {/* Partner — Investment + Income + Expense */}
        <div className="swiss-card p-5" data-testid="chart-partner">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div>
              <div className="overline">Partner</div>
              <div className="font-heading font-bold tracking-tight text-lg">Investment · Income · Expense</div>
              {partnerData && (
                <div className="text-xs num mt-0.5 flex gap-3">
                  <span>Inv <span className="font-semibold">{inr(partnerData.totals.investment)}</span></span>
                  <span className="value-positive">Inc <span className="font-semibold">{inr(partnerData.totals.income)}</span></span>
                  <span className="value-negative">Exp <span className="font-semibold">{inr(partnerData.totals.expense)}</span></span>
                </div>
              )}
            </div>
            <Select value={partnerId || "__none"} onValueChange={(v) => setPartnerId(v === "__none" ? "" : v)}>
              <SelectTrigger className="rounded-none w-56" data-testid="filter-partner-chart"><SelectValue placeholder="Select partner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Select partner —</SelectItem>
                {entities.partner.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="h-64">
            {partnerData?.monthly?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={partnerData.monthly}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 4" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(15,23,42,0.08)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="investment" stroke="#002FA7" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="income" stroke="#00A859" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expense" stroke="#FF2A2A" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart text={partnerId ? "No data for selected partner" : "Select a partner to view chart"} />}
          </div>
        </div>
      </div>
    </div>
  );
}

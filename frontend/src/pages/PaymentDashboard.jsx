import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { inr } from "@/lib/i18n";
import KpiCard from "@/components/KpiCard";
import PrintButton from "@/components/PrintButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";
import { RefreshCw } from "lucide-react";

const ENTITY_TYPES = ["center", "partner", "project"];
const PIE_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9",
  "#a855f7", "#14b8a6", "#f97316",
];

function shortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function fmtCompact(n) {
  const num = Number(n || 0);
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
  if (num >= 100000) return `₹${(num / 100000).toFixed(2)}L`;
  if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`;
  return `₹${num.toFixed(0)}`;
}

export default function PaymentDashboard() {
  const [entities, setEntities] = useState({ center: [], partner: [], project: [] });
  const [filters, setFilters] = useState({
    center_id: "", partner_id: "", project_id: "", start: "", end: "",
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all(ENTITY_TYPES.map((tt) => api.get(`/entities/${tt}`)))
      .then((res) => {
        const e = {};
        ENTITY_TYPES.forEach((tt, i) => { e[tt] = res[i].data || []; });
        setEntities(e);
      })
      .catch(() => {});
  }, []);

  const query = useMemo(() => {
    const p = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    return p;
  }, [filters]);

  const load = () => {
    setLoading(true);
    api.get("/dashboard/payment-summary", { params: query })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [query]);

  const kpis = data?.kpis || { daily: 0, weekly: 0, monthly: 0, upcoming: 0 };
  const dailySeries = (data?.daily_series || []).map((r) => ({ ...r, label: shortDate(r.date) }));
  const monthlySeries = data?.monthly_series || [];
  const weeklySeries = (data?.weekly_series || []).map((r) => ({ ...r, label: `W${r.week}` }));
  const centerWise = data?.center_wise || [];
  const projectWise = data?.project_wise || [];
  const incomeBreakdown = data?.income_breakdown || [];
  const incomeTotal = incomeBreakdown.reduce((s, r) => s + Number(r.amount || 0), 0);

  const resetFilters = () => setFilters({ center_id: "", partner_id: "", project_id: "", start: "", end: "" });

  return (
    <div className="space-y-6" data-testid="payment-dashboard-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading font-black text-3xl md:text-4xl tracking-tight">Payment Dashboard</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Expense &amp; income insights across your operations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            data-testid="pd-refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <PrintButton />
        </div>
      </div>

      {/* Filters */}
      <div className="swiss-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div>
            <Label className="text-xs">Center</Label>
            <Select
              value={filters.center_id || "__all__"}
              onValueChange={(v) => setFilters({ ...filters, center_id: v === "__all__" ? "" : v })}
            >
              <SelectTrigger data-testid="pd-filter-center"><SelectValue placeholder="All Centers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Centers</SelectItem>
                {entities.center.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Partner</Label>
            <Select
              value={filters.partner_id || "__all__"}
              onValueChange={(v) => setFilters({ ...filters, partner_id: v === "__all__" ? "" : v })}
            >
              <SelectTrigger data-testid="pd-filter-partner"><SelectValue placeholder="All Partners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Partners</SelectItem>
                {entities.partner.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Project</Label>
            <Select
              value={filters.project_id || "__all__"}
              onValueChange={(v) => setFilters({ ...filters, project_id: v === "__all__" ? "" : v })}
            >
              <SelectTrigger data-testid="pd-filter-project"><SelectValue placeholder="All Projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Projects</SelectItem>
                {entities.project.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Start Date</Label>
            <Input
              type="date"
              value={filters.start}
              onChange={(e) => setFilters({ ...filters, start: e.target.value })}
              data-testid="pd-filter-start"
            />
          </div>
          <div>
            <Label className="text-xs">End Date</Label>
            <Input
              type="date"
              value={filters.end}
              onChange={(e) => setFilters({ ...filters, end: e.target.value })}
              data-testid="pd-filter-end"
            />
          </div>
          <div>
            <Button
              variant="outline"
              className="w-full"
              onClick={resetFilters}
              data-testid="pd-filter-reset"
            >
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Today's Expense" value={kpis.daily} accent="negative" testId="pd-kpi-daily" />
        <KpiCard label="Last 7 Days" value={kpis.weekly} accent="negative" testId="pd-kpi-weekly" />
        <KpiCard label="This Month" value={kpis.monthly} accent="negative" testId="pd-kpi-monthly" />
        <KpiCard label="Upcoming Payments" value={kpis.upcoming} accent="positive" testId="pd-kpi-upcoming" />
      </div>

      {/* Daily trend */}
      <div className="swiss-card p-5" data-testid="pd-chart-daily">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-heading font-bold text-lg">Daily Expense Trend</h3>
            <p className="text-xs text-[var(--muted)]">Last 30 days</p>
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailySeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtCompact} width={70} />
              <Tooltip formatter={(v) => inr(v)} />
              <Line type="monotone" dataKey="expense" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly + Monthly side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="swiss-card p-5" data-testid="pd-chart-weekly">
          <div className="mb-3">
            <h3 className="font-heading font-bold text-lg">Weekly Expense</h3>
            <p className="text-xs text-[var(--muted)]">Last 12 ISO weeks</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtCompact} width={70} />
                <Tooltip formatter={(v) => inr(v)} />
                <Bar dataKey="expense" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="swiss-card p-5" data-testid="pd-chart-monthly">
          <div className="mb-3">
            <h3 className="font-heading font-bold text-lg">Monthly Expense</h3>
            <p className="text-xs text-[var(--muted)]">Last 12 months</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtCompact} width={70} />
                <Tooltip formatter={(v) => inr(v)} />
                <Bar dataKey="expense" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Center + Project side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="swiss-card p-5" data-testid="pd-chart-center">
          <div className="mb-3">
            <h3 className="font-heading font-bold text-lg">Center-wise Expense</h3>
            <p className="text-xs text-[var(--muted)]">Top 10 centers by outflow</p>
          </div>
          {centerWise.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-[var(--muted)]">No data</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={centerWise} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtCompact} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip formatter={(v) => inr(v)} />
                  <Bar dataKey="amount" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="swiss-card p-5" data-testid="pd-chart-project">
          <div className="mb-3">
            <h3 className="font-heading font-bold text-lg">Project-wise Expense</h3>
            <p className="text-xs text-[var(--muted)]">Top 10 projects by outflow</p>
          </div>
          {projectWise.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-[var(--muted)]">No data</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={projectWise} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtCompact} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip formatter={(v) => inr(v)} />
                  <Bar dataKey="amount" fill="#a855f7" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Income Pie */}
      <div className="swiss-card p-5" data-testid="pd-chart-income">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-heading font-bold text-lg">Income Breakdown</h3>
            <p className="text-xs text-[var(--muted)]">By category — total {inr(incomeTotal)}</p>
          </div>
        </div>
        {incomeBreakdown.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-[var(--muted)]">No income in range</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={incomeBreakdown}
                    dataKey="amount"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(entry) => entry.category}
                  >
                    {incomeBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => inr(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {incomeBreakdown.map((row, i) => {
                const pct = incomeTotal > 0 ? ((row.amount / incomeTotal) * 100).toFixed(1) : "0.0";
                return (
                  <div
                    key={row.category}
                    className="flex items-center justify-between text-sm py-1.5 border-b border-[var(--border)] last:border-0"
                    data-testid={`pd-income-row-${i}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="font-medium">{row.category}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="num font-semibold">{inr(row.amount)}</span>
                      <span className="text-xs text-[var(--muted)] w-12 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {data?.meta && (
        <div className="text-xs text-[var(--muted)] text-center pb-4" data-testid="pd-meta">
          Data range: {data.meta.start} → {data.meta.end}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { inr } from "@/lib/i18n";
import KpiCard from "@/components/KpiCard";
import PrintButton from "@/components/PrintButton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import RoleWidgets from "@/components/RoleWidgets";
import SettlementSection from "@/components/SettlementSection";

const ENTITY_TYPES = ["company", "partner", "center", "project"];
const BREAKDOWN_TYPES = ["company", "partner", "center", "project", "item"];

export default function Dashboard() {
  const { t } = useLang();
  const { user } = useAuth();
  const [entities, setEntities] = useState({ company: [], partner: [], center: [], project: [] });
  const [settlement, setSettlement] = useState(null);
  const showSettlement = ["partner", "admin", "manager", "senior_manager", "accountant", "hr"].includes(user?.role);
  const [filters, setFilters] = useState({
    company_id: "", partner_id: "", center_id: "", project_id: "", start: "", end: "",
  });
  const [data, setData] = useState(null);
  const [milestoneSummary, setMilestoneSummary] = useState(null);
  const [foodingSummary, setFoodingSummary] = useState(null);

  useEffect(() => {
    Promise.all(ENTITY_TYPES.map((tt) => api.get(`/entities/${tt}`))).then((res) => {
      const e = {};
      ENTITY_TYPES.forEach((tt, i) => { e[tt] = res[i].data; });
      setEntities(e);
    }).catch(() => {});
  }, []);

  const query = useMemo(() => {
    const p = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    return p;
  }, [filters]);

  useEffect(() => {
    api.get("/dashboard/summary", { params: query }).then((r) => setData(r.data)).catch(() => setData(null));
    api.get("/dashboard/milestone-income", { params: query }).then((r) => setMilestoneSummary(r.data)).catch(() => setMilestoneSummary(null));
    api.get("/dashboard/fooding-income", { params: query }).then((r) => setFoodingSummary(r.data)).catch(() => setFoodingSummary(null));
  }, [query]);

  useEffect(() => {
    if (!showSettlement) return;
    const p = { include_history: true };
    if (query.start) p.start = query.start;
    if (query.end) p.end = query.end;
    if (query.center_id) p.center_id = query.center_id;
    api.get("/dashboard/settlement", { params: p }).then((r) => setSettlement(r.data)).catch(() => setSettlement(null));
  }, [query, showSettlement]);

  const refreshSettlement = () => {
    if (!showSettlement) return;
    const p = { include_history: true };
    if (query.start) p.start = query.start;
    if (query.end) p.end = query.end;
    if (query.center_id) p.center_id = query.center_id;
    api.get("/dashboard/settlement", { params: p }).then((r) => setSettlement(r.data)).catch(() => setSettlement(null));
  };

  const totals = data?.totals || { investment: 0, income: 0, expense: 0, profit: 0 };

  const pieData = [
    { name: t("investment"), value: totals.investment, color: "#002FA7" },
    { name: t("income"), value: totals.income, color: "#00A859" },
    { name: t("expense"), value: totals.expense, color: "#FF2A2A" },
  ].filter((d) => d.value > 0);

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">{t("dashboard")}</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t("dashboard")}</h1>
        </div>
        <PrintButton />
      </div>

      {/* Role-specific personalised widgets (Center Manager, Accountant, HR, Senior Mgr, RA, Center Partner) */}
      <RoleWidgets />

      {/* Filters */}
      <div className="swiss-card p-4 grid grid-cols-2 md:grid-cols-6 gap-3" data-testid="dashboard-filters">
        {ENTITY_TYPES.map((etype) => (
          <div key={etype} className="space-y-1">
            <Label className="overline">{t(etype)}</Label>
            <Select value={filters[`${etype}_id`] || "__all"} onValueChange={(v) => setF(`${etype}_id`, v === "__all" ? "" : v)}>
              <SelectTrigger className="rounded-none" data-testid={`filter-${etype}`}><SelectValue placeholder={t("all")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t("all")}</SelectItem>
                {entities[etype].map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
        <div className="space-y-1">
          <Label className="overline">From</Label>
          <Input type="date" value={filters.start} onChange={(e) => setF("start", e.target.value)} className="rounded-none" data-testid="filter-start" />
        </div>
        <div className="space-y-1">
          <Label className="overline">To</Label>
          <Input type="date" value={filters.end} onChange={(e) => setF("end", e.target.value)} className="rounded-none" data-testid="filter-end" />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label={t("total_investment")} value={totals.investment} testId="kpi-investment" />
        <KpiCard label={t("total_income")} value={totals.income} accent="positive" testId="kpi-income" />
        <KpiCard label={t("total_expense")} value={totals.expense} accent="negative" testId="kpi-expense" />
        <KpiCard label={t("net_profit")} value={totals.profit} accent={totals.profit >= 0 ? "positive" : "negative"} testId="kpi-profit" />
      </div>

      {/* Charts row */}
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
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 0, border: "1px solid #0a0a0a" }} />
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
                <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 0, border: "1px solid #0a0a0a" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart text={t("no_data")} />}
        </div>
      </div>

      {/* Company vs Partner — separated charts */}
      <CompanyPartnerCharts entities={entities} baseFilters={filters} />

      {/* Partner Settlement */}
      {showSettlement && (
        <SettlementSection settlement={settlement} onSettled={refreshSettlement} />
      )}

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
                    <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 0, border: "1px solid #0a0a0a" }} />
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
                  <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 0, border: "1px solid #0a0a0a" }} />
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
                  <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 0, border: "1px solid #0a0a0a" }} />
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

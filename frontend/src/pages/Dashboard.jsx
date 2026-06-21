import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { inr } from "@/lib/i18n";
import KpiCard from "@/components/KpiCard";
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

const ENTITY_TYPES = ["company", "partner", "center", "project"];
const BREAKDOWN_TYPES = ["company", "partner", "center", "project", "item"];

export default function Dashboard() {
  const { t } = useLang();
  const { user } = useAuth();
  const [entities, setEntities] = useState({ company: [], partner: [], center: [], project: [] });
  const [settlement, setSettlement] = useState(null);
  const showSettlement = ["partner", "admin", "manager", "accountant"].includes(user?.role);
  const [filters, setFilters] = useState({
    company_id: "", partner_id: "", center_id: "", project_id: "", start: "", end: "",
  });
  const [data, setData] = useState(null);

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
  }, [query]);

  useEffect(() => {
    if (!showSettlement) return;
    const p = {};
    if (query.start) p.start = query.start;
    if (query.end) p.end = query.end;
    if (query.center_id) p.center_id = query.center_id;
    api.get("/dashboard/settlement", { params: p }).then((r) => setSettlement(r.data)).catch(() => setSettlement(null));
  }, [query, showSettlement]);

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
      </div>

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
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 0, border: "1px solid #0a0a0a" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart text={t("no_data")} />}
        </div>
      </div>

      {/* Partner Settlement */}
      {showSettlement && settlement?.centers?.length > 0 && (
        <div className="swiss-card p-5" data-testid="settlement-section">
          <div className="flex items-center justify-between mb-1">
            <div className="font-heading font-bold tracking-tight text-lg">{t("settlement")}</div>
            <div className="overline">Equal-split fair share</div>
          </div>
          <p className="text-sm text-[var(--muted)] mb-4">Net contribution = investment + expense − income (money each partner put into the venture). Adjustment shows who should pay or receive to balance.</p>
          <div className="space-y-6">
            {settlement.centers.map((c) => (
              <div key={c.center_id} className="border border-[var(--border)]" data-testid={`settlement-center-${c.center_id}`}>
                <div className="px-4 py-2 bg-gray-50 border-b border-[var(--border)] flex justify-between items-center">
                  <div>
                    <span className="overline mr-2">Center</span>
                    <span className="font-heading font-bold">{c.center_name}</span>
                  </div>
                  <div className="text-sm">
                    <span className="overline mr-2">Fair share / partner</span>
                    <span className="num font-semibold">{inr(c.fair_share_each)}</span>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] overline">
                      <th className="text-left p-3">{t("partner")}</th>
                      <th className="text-right p-3">{t("investment")}</th>
                      <th className="text-right p-3">{t("expense")}</th>
                      <th className="text-right p-3">{t("income")}</th>
                      <th className="text-right p-3">{t("net_contribution")}</th>
                      <th className="text-right p-3">{t("adjustment")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.partners.map((p) => {
                      const adj = p.adjustment;
                      const label = Math.abs(adj) < 0.5 ? t("settled") : adj > 0 ? t("to_pay") : t("to_receive");
                      const color = Math.abs(adj) < 0.5 ? "text-[var(--muted)]" : adj > 0 ? "value-negative" : "value-positive";
                      return (
                        <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                          <td className="p-3 font-medium">{p.name}</td>
                          <td className="p-3 num">{inr(p.investment)}</td>
                          <td className="p-3 num value-negative">{inr(p.expense)}</td>
                          <td className="p-3 num value-positive">{inr(p.income)}</td>
                          <td className="p-3 num font-medium">{inr(p.net_contribution)}</td>
                          <td className={`p-3 num font-bold ${color}`}>
                            <div className="flex justify-end items-center gap-2">
                              <span className="overline text-[10px]">{label}</span>
                              <span>{inr(Math.abs(adj))}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
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
    </div>
  );
}

function EmptyChart({ text }) {
  return <div className="h-full flex items-center justify-center overline">{text}</div>;
}

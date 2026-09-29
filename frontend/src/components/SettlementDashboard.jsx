import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { useFY } from "@/context/FYContext";
import KpiCard from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  ChevronDown, ChevronRight, TrendingUp, Wallet, Scale,
  ArrowUpCircle, CheckCircle2, PieChart as PieIcon,
} from "lucide-react";
import { toast } from "sonner";

const GREEN = "#00A859";
const RED = "#FF2A2A";
const BLUE = "#002FA7";
const PALETTE = ["#002FA7", "#00A859", "#F59E0B", "#7C3AED", "#EC4899", "#0891B2", "#DC2626", "#65A30D"];

const shortName = (n = "") => (n.length > 16 ? n.slice(0, 15) + "…" : n);

export default function SettlementDashboard() {
  const { t } = useLang();
  const { user } = useAuth();
  const { fy } = useFY();
  const isAdmin = user?.role === "admin";
  const canRecord = ["admin", "senior_manager", "manager", "accountant", "partner"].includes(user?.role);
  const canUndo = ["admin", "accountant", "senior_manager"].includes(user?.role);

  const [settlement, setSettlement] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [companyMap, setCompanyMap] = useState({}); // center_id -> {company_id, company_name}
  const [companies, setCompanies] = useState([]);   // [{id,name}]
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({
    company_id: "all", center_id: "all", partner_id: "all",
    cycle: "active", status: "all", start: "", end: "",
  });

  const [expanded, setExpanded] = useState({});          // center_id -> bool
  const [expandedPartner, setExpandedPartner] = useState({});
  const [historyOpen, setHistoryOpen] = useState(false);

  // action dialogs (reuse existing endpoints)
  const [openModal, setOpenModal] = useState(null);
  const [form, setForm] = useState({ to_partner_id: "", amount: "", date: "", note: "" });
  const [submitting, setSubmitting] = useState(false);
  const [txnDrill, setTxnDrill] = useState(null);

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));

  const loadSettlement = async () => {
    setLoading(true);
    try {
      const params = { include_history: true };
      if (filters.start) params.start = filters.start;
      if (filters.end) params.end = filters.end;
      const sRes = await api.get("/dashboard/settlement", { params });
      const hRes = await api.get("/dashboard/settlement/history").catch(() => ({ data: { records: [] } }));
      setSettlement(sRes.data || { centers: [] });
      setHistoryRecords(hRes.data?.records || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load settlement data");
      setSettlement({ centers: [] });
      setHistoryRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSettlement(); /* eslint-disable-next-line */ }, [filters.start, filters.end, fy]);

  // Best-effort company mapping (for the Company filter). Fails silently for
  // roles without entity access — the Company filter then just stays "All".
  useEffect(() => {
    Promise.all([
      api.get("/entities/center").catch(() => ({ data: [] })),
      api.get("/entities/company").catch(() => ({ data: [] })),
    ]).then(([cRes, coRes]) => {
      const comps = (coRes.data || []).map((c) => ({ id: c.id, name: c.name }));
      const cmap = {};
      (cRes.data || []).forEach((c) => {
        cmap[c.id] = { company_id: c.company_id, company_name: (comps.find((x) => x.id === c.company_id) || {}).name };
      });
      setCompanies(comps);
      setCompanyMap(cmap);
    }).catch(() => {});
  }, []);

  const allCenters = settlement?.centers || [];

  // Distinct partner options across all centers
  const partnerOptions = useMemo(() => {
    const m = {};
    allCenters.forEach((c) => (c.partners || []).forEach((p) => { m[p.id] = p.name; }));
    return Object.entries(m).map(([id, name]) => ({ id, name }));
  }, [allCenters]);

  const centerStatus = (c) => {
    const parts = c.partners || [];
    if (parts.length === 0) return "settled";
    return parts.some((p) => Math.abs(p.adjustment) >= 0.5) ? "pending" : "settled";
  };

  // Apply client-side filters
  const centers = useMemo(() => {
    return allCenters.filter((c) => {
      if (filters.center_id !== "all" && c.center_id !== filters.center_id) return false;
      if (filters.company_id !== "all") {
        const cm = companyMap[c.center_id];
        if (!cm || cm.company_id !== filters.company_id) return false;
      }
      if (filters.partner_id !== "all") {
        if (!(c.partners || []).some((p) => p.id === filters.partner_id)) return false;
      }
      if (filters.status !== "all" && centerStatus(c) !== filters.status) return false;
      return true;
    });
  }, [allCenters, filters, companyMap]);

  const useLifetime = filters.cycle === "lifetime";
  const centerVals = (c) => {
    if (useLifetime && c.lifetime) {
      return {
        income: c.lifetime.total_income || 0,
        expense: c.lifetime.total_contribution || 0,
        pl: c.lifetime.profit_loss || 0,
        fair: c.lifetime.fair_share_each || 0,
        pshare: (c.lifetime.profit_loss || 0) / 2,
        partners: c.lifetime.partners || [],
      };
    }
    return {
      income: c.total_income || 0,
      expense: c.total_contribution || 0,
      pl: c.profit_loss || 0,
      fair: c.fair_share_each || 0,
      pshare: c.profit_share_each || 0,
      partners: c.partners || [],
    };
  };

  // KPI aggregation
  const kpis = useMemo(() => {
    let income = 0, expense = 0, pl = 0, pshare = 0, fair = 0, toReceive = 0, toPay = 0;
    centers.forEach((c) => {
      const v = centerVals(c);
      income += v.income; expense += v.expense; pl += v.pl; pshare += v.pshare; fair += v.fair;
      (c.partners || []).forEach((p) => {
        if (p.adjustment < -0.5) toReceive += Math.abs(p.adjustment);
        else if (p.adjustment > 0.5) toPay += p.adjustment;
      });
    });
    const centerIds = new Set(centers.map((c) => c.center_id));
    const settledAmount = historyRecords
      .filter((h) => (filters.center_id === "all" ? centerIds.has(h.center_id) : h.center_id === filters.center_id))
      .filter((h) => (!filters.start || h.date >= filters.start) && (!filters.end || h.date <= filters.end))
      .reduce((s, h) => s + (h.amount || 0), 0);
    return { income, expense, pl, pshare, fair, toReceive, toPay, settledAmount };
  }, [centers, historyRecords, filters, useLifetime]);

  // Partner-wise aggregation (across filtered centers)
  const partnerAgg = useMemo(() => {
    const m = {};
    centers.forEach((c) => {
      const v = centerVals(c);
      (v.partners || []).forEach((p) => {
        if (!m[p.id]) m[p.id] = {
          id: p.id, name: p.name, investment: 0, expense: 0, total_contribution: 0,
          profit_share: 0, final_share: 0, fair_share: 0, adjustment: 0, dues: [],
        };
        const a = m[p.id];
        a.investment += p.investment || 0;
        a.expense += p.expense || 0;
        a.total_contribution += p.total_contribution || 0;
        a.profit_share += p.profit_share || 0;
        a.final_share += p.final_share || 0;
        a.fair_share += v.fair || 0;
        a.adjustment += p.adjustment || 0;
        if (!useLifetime && (p.adjustment || 0) > 0.5) a.dues.push({ center: c, partner: p });
      });
    });
    return Object.values(m).sort((a, b) => b.total_contribution - a.total_contribution);
  }, [centers, useLifetime]);

  // Chart datasets (top-N for readability; always reflects current filters)
  const TOP_CENTERS = 10;
  const TOP_PARTNERS = 8;
  const sortedCenters = [...centers].sort((a, b) => {
    const va = centerVals(a), vb = centerVals(b);
    return (Math.abs(vb.income) + Math.abs(vb.expense)) - (Math.abs(va.income) + Math.abs(va.expense));
  }).slice(0, TOP_CENTERS);
  const incomeExpenseData = sortedCenters.map((c) => {
    const v = centerVals(c);
    return { name: shortName(c.center_name), income: v.income, expense: v.expense };
  });
  const plData = [...centers].sort((a, b) => Math.abs(centerVals(b).pl) - Math.abs(centerVals(a).pl))
    .slice(0, TOP_CENTERS)
    .map((c) => ({ name: shortName(c.center_name), pl: centerVals(c).pl }));
  const contribData = partnerAgg
    .map((p) => ({ name: shortName(p.name), value: Math.max(p.total_contribution, 0) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_PARTNERS);
  const shareData = (() => {
    const rows = partnerAgg
      .map((p) => ({ name: shortName(p.name), value: Math.abs(p.final_share) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    const top = rows.slice(0, TOP_PARTNERS);
    const rest = rows.slice(TOP_PARTNERS).reduce((s, d) => s + d.value, 0);
    if (rest > 0) top.push({ name: "Others", value: rest });
    return top;
  })();
  const statusData = (() => {
    let settled = 0, pending = 0;
    centers.forEach((c) => (c.partners || []).forEach((p) => {
      if (Math.abs(p.adjustment) >= 0.5) pending += 1; else settled += 1;
    }));
    return [
      { name: t("settled") || "Settled", value: settled, color: GREEN },
      { name: "Pending", value: pending, color: RED },
    ].filter((d) => d.value > 0);
  })();

  // ---- action handlers (reuse existing endpoints, unchanged logic) ----
  const openSettleModal = (center, fromPartner) => {
    const candidates = center.partners.filter((p) => p.id !== fromPartner.id && p.adjustment < 0);
    setForm({
      to_partner_id: candidates[0]?.id || "",
      amount: Math.abs(Math.round(fromPartner.adjustment)).toString(),
      date: new Date().toISOString().slice(0, 10),
      note: "",
    });
    setOpenModal({ center, fromPartner, toCandidates: candidates });
  };

  const submitSettlement = async () => {
    if (!form.to_partner_id || !form.amount || !form.date) {
      toast.error("Please fill recipient, amount and date");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/dashboard/settlement/record", {
        center_id: openModal.center.center_id,
        from_partner_id: openModal.fromPartner.id,
        to_partner_id: form.to_partner_id,
        amount: parseFloat(form.amount),
        date: form.date,
        note: form.note || null,
      });
      toast.success("Settlement recorded — balances reset from this date");
      setOpenModal(null);
      loadSettlement();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to record settlement");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteHistoryRecord = async (recId) => {
    if (!window.confirm("Undo this settlement? Post-cutoff balances will be recalculated.")) return;
    try {
      await api.delete(`/dashboard/settlement/record/${recId}`);
      toast.success("Settlement record removed");
      loadSettlement();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to remove settlement");
    }
  };

  const openTxnDrill = async (c, scope) => {
    setTxnDrill({ center: c, scope, loading: true, data: null });
    try {
      const r = await api.get("/dashboard/settlement/txns", { params: { center_id: c.center_id, scope } });
      setTxnDrill({ center: c, scope, loading: false, data: r.data });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load transactions");
      setTxnDrill(null);
    }
  };

  const runNormalizeDates = async () => {
    if (!window.confirm(
      "Ye maintenance action legacy transactions ke DD-MM-YYYY / DD/MM/YYYY dates ko YYYY-MM-DD me convert karega. " +
      "Ye zaroori hai kyunki galat format se puraani expenses \"Current Cycle\" me leak ho jaati hain. Continue?"
    )) return;
    try {
      const dry = await api.post("/admin/normalize-txn-dates?dry_run=true");
      const preview = dry.data;
      if (preview.fixed === 0) {
        toast.success(`Kuch nahi karna — sab ${preview.scanned} rows already sahi format me hain.`);
        return;
      }
      if (!window.confirm(`Dry run: ${preview.fixed} rows fix hoge, ${preview.unfixable} unfixable. Real update karein?`)) return;
      const real = await api.post("/admin/normalize-txn-dates?dry_run=false");
      toast.success(`Fixed ${real.data.fixed} txn dates. Refresh…`);
      loadSettlement();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Normalize failed");
    }
  };

  const clearFilters = () => setFilters({
    company_id: "all", center_id: "all", partner_id: "all",
    cycle: "active", status: "all", start: "", end: "",
  });

  const hasCompanyData = companies.length > 0 && Object.keys(companyMap).length > 0;

  return (
    <div className="space-y-6" data-testid="settlement-dashboard">
      {/* ===== Header actions ===== */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-[var(--muted)] max-w-3xl">
          <b>Cycle Math:</b> Contribution = Investment + Expense · Profit/Loss = Total Income − Total Contribution ·
          Final Share = Contribution + 50% × P/L. Only <b>active cycle</b> transactions (after the last settlement) are counted.
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button size="sm" variant="outline" className="rounded-none text-xs"
              onClick={runNormalizeDates} data-testid="normalize-dates-btn"
              title="Fix legacy DD-MM-YYYY dates that leak into current cycle">
              Fix Legacy Dates
            </Button>
          )}
          <Button size="sm" variant="outline" className="rounded-none"
            onClick={() => setHistoryOpen(true)} data-testid="open-history-btn">
            View Settled History
          </Button>
        </div>
      </div>

      {/* ===== KPI Summary ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="settlement-kpis">
        <KpiCard label="Total Income" value={kpis.income} accent="positive" testId="kpi-total-income" />
        <KpiCard label="Total Contribution / Expense" value={kpis.expense} accent="negative" testId="kpi-total-expense" />
        <KpiCard label="Overall Profit / Loss" value={kpis.pl} accent={kpis.pl >= 0 ? "positive" : "negative"} testId="kpi-overall-pl" />
        <KpiCard label="Partner Profit Share" value={kpis.pshare} accent={kpis.pshare >= 0 ? "positive" : "negative"} testId="kpi-partner-share" />
        <KpiCard label="Fair Share / Partner" value={kpis.fair} testId="kpi-fair-share" />
        <KpiCard label="Amount To Receive" value={kpis.toReceive} accent="positive" testId="kpi-to-receive" />
        <KpiCard label="Amount To Pay" value={kpis.toPay} accent="negative" testId="kpi-to-pay" />
        <KpiCard label="Settled Amount" value={kpis.settledAmount} testId="kpi-settled-amount" />
      </div>

      {/* ===== Filters ===== */}
      <div className="swiss-card p-4" data-testid="settlement-filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {hasCompanyData && (
            <div>
              <Label className="overline">Company</Label>
              <Select value={filters.company_id} onValueChange={(v) => setF("company_id", v)}>
                <SelectTrigger className="rounded-none" data-testid="filter-company"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="overline">Center</Label>
            <Select value={filters.center_id} onValueChange={(v) => setF("center_id", v)}>
              <SelectTrigger className="rounded-none" data-testid="filter-center"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Centers</SelectItem>
                {allCenters.map((c) => <SelectItem key={c.center_id} value={c.center_id}>{c.center_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">Partner</Label>
            <Select value={filters.partner_id} onValueChange={(v) => setF("partner_id", v)}>
              <SelectTrigger className="rounded-none" data-testid="filter-partner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Partners</SelectItem>
                {partnerOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">Cycle</Label>
            <Select value={filters.cycle} onValueChange={(v) => setF("cycle", v)}>
              <SelectTrigger className="rounded-none" data-testid="filter-cycle"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active Cycle</SelectItem>
                <SelectItem value="lifetime">Lifetime</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">Status</Label>
            <Select value={filters.status} onValueChange={(v) => setF("status", v)}>
              <SelectTrigger className="rounded-none" data-testid="filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="settled">Settled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">From</Label>
            <Input type="date" value={filters.start} onChange={(e) => setF("start", e.target.value)}
              className="rounded-none" data-testid="filter-start" />
          </div>
          <div>
            <Label className="overline">To</Label>
            <Input type="date" value={filters.end} onChange={(e) => setF("end", e.target.value)}
              className="rounded-none" data-testid="filter-end" />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="rounded-none w-full" onClick={clearFilters} data-testid="clear-filters">
              Clear Filters
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="swiss-card p-10 text-center text-sm text-[var(--muted)]">Loading settlement data…</div>
      ) : centers.length === 0 ? (
        <div className="swiss-card p-10 text-center text-sm text-[var(--muted)]" data-testid="settlement-empty">
          No settlement data for the selected filters.
        </div>
      ) : (
        <>
          {/* ===== Charts ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="settlement-charts">
            <div className="swiss-card p-4">
              <div className="font-heading font-bold text-sm mb-3 flex items-center gap-2"><TrendingUp size={16} /> Income vs Expense{centers.length > 10 ? " (Top 10 Centers)" : ""}</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={incomeExpenseData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => inr(v)} />
                  <Legend />
                  <Bar dataKey="income" name="Income" fill={GREEN} />
                  <Bar dataKey="expense" name="Expense" fill={RED} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="swiss-card p-4">
              <div className="font-heading font-bold text-sm mb-3 flex items-center gap-2"><Scale size={16} /> Profit / Loss by Center{centers.length > 10 ? " (Top 10)" : ""}</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={plData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => inr(v)} />
                  <Bar dataKey="pl" name="Profit / Loss">
                    {plData.map((d, i) => <Cell key={i} fill={d.pl >= 0 ? GREEN : RED} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="swiss-card p-4">
              <div className="font-heading font-bold text-sm mb-3 flex items-center gap-2"><Wallet size={16} /> Partner Contribution{partnerAgg.length > 8 ? " (Top 8)" : ""}</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={contribData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => inr(v)} />
                  <Bar dataKey="value" name="Contribution" fill={BLUE} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="swiss-card p-4">
                <div className="font-heading font-bold text-sm mb-3 flex items-center gap-2"><PieIcon size={16} /> Share Distribution</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={shareData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={false}>
                      {shareData.map((d, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => inr(v)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="swiss-card p-4">
                <div className="font-heading font-bold text-sm mb-3 flex items-center gap-2"><CheckCircle2 size={16} /> Settlement Status</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                      {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ===== Center Overview (cards, expandable) ===== */}
          <div>
            <div className="font-heading font-bold tracking-tight text-lg mb-3">Center Overview</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="center-overview">
              {centers.map((c) => {
                const v = centerVals(c);
                const st = centerStatus(c);
                const toRecv = (c.partners || []).filter((p) => p.adjustment < -0.5).reduce((s, p) => s + Math.abs(p.adjustment), 0);
                const toPay = (c.partners || []).filter((p) => p.adjustment > 0.5).reduce((s, p) => s + p.adjustment, 0);
                const open = !!expanded[c.center_id];
                return (
                  <div key={c.center_id} className="swiss-card p-0 overflow-hidden" data-testid={`center-card-${c.center_id}`}>
                    <button
                      className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-gray-50 transition-colors"
                      onClick={() => setExpanded((s) => ({ ...s, [c.center_id]: !open }))}
                      data-testid={`center-card-toggle-${c.center_id}`}
                    >
                      <div className="min-w-0">
                        <div className="overline text-[10px]">Center</div>
                        <div className="font-heading font-bold truncate">{c.center_name}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] px-2 py-0.5 border ${st === "pending" ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                          {st === "pending" ? "Pending" : "Settled"}
                        </span>
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </div>
                    </button>
                    <div className="grid grid-cols-2 border-t border-[var(--border)] text-sm">
                      <div className="p-2 border-r border-b border-[var(--border)]">
                        <div className="overline text-[10px]">Income</div>
                        <div className="num value-positive font-semibold">{inr(v.income)}</div>
                      </div>
                      <div className="p-2 border-b border-[var(--border)]">
                        <div className="overline text-[10px]">Expense</div>
                        <div className="num value-negative font-semibold">{inr(v.expense)}</div>
                      </div>
                      <div className="p-2 border-r border-[var(--border)]">
                        <div className="overline text-[10px]">Profit / Loss</div>
                        <div className={`num font-bold ${v.pl >= 0 ? "value-positive" : "value-negative"}`}>{inr(v.pl)}</div>
                      </div>
                      <div className="p-2">
                        <div className="overline text-[10px]">Fair Share / Partner</div>
                        <div className="num font-semibold">{inr(v.fair)}</div>
                      </div>
                      <div className="p-2 border-r border-t border-[var(--border)]">
                        <div className="overline text-[10px]">To Receive</div>
                        <div className="num value-positive font-semibold">{inr(toRecv)}</div>
                      </div>
                      <div className="p-2 border-t border-[var(--border)]">
                        <div className="overline text-[10px]">To Pay</div>
                        <div className="num value-negative font-semibold">{inr(toPay)}</div>
                      </div>
                    </div>
                    {open && <CenterDetail c={c} t={t} canRecord={canRecord} openSettleModal={openSettleModal} openTxnDrill={openTxnDrill} history={historyRecords.filter((h) => h.center_id === c.center_id)} canUndo={canUndo} onUndo={deleteHistoryRecord} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ===== Partner-wise Settlement ===== */}
          <div>
            <div className="font-heading font-bold tracking-tight text-lg mb-3">Partner-wise Settlement</div>
            <div className="swiss-card p-0 overflow-x-auto" data-testid="partner-wise">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="border-b border-[var(--border)] overline">
                    <th className="text-left p-3">{t("partner")}</th>
                    <th className="text-right p-3">{t("investment")}</th>
                    <th className="text-right p-3">{t("expense")}</th>
                    <th className="text-right p-3">Contribution</th>
                    <th className="text-right p-3">Profit Share (50/50)</th>
                    <th className="text-right p-3">Final Share</th>
                    <th className="text-right p-3">Fair Share</th>
                    <th className="text-right p-3">{t("adjustment")}</th>
                    <th className="text-center p-3">Status</th>
                    <th className="text-right p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {partnerAgg.map((p) => {
                    const settled = Math.abs(p.adjustment) < 0.5;
                    const label = settled ? t("settled") : p.adjustment > 0 ? t("to_pay") : t("to_receive");
                    const color = settled ? "text-[var(--muted)]" : p.adjustment > 0 ? "value-negative" : "value-positive";
                    const pOpen = !!expandedPartner[p.id];
                    return (
                      <React.Fragment key={p.id}>
                        <tr className="border-b border-[var(--border)]" data-testid={`partner-row-${p.id}`}>
                          <td className="p-3 font-medium">{p.name}</td>
                          <td className="p-3 num">{inr(p.investment)}</td>
                          <td className="p-3 num value-negative">{inr(p.expense)}</td>
                          <td className="p-3 num font-semibold">{inr(p.total_contribution)}</td>
                          <td className={`p-3 num ${p.profit_share >= 0 ? "value-positive" : "value-negative"}`}>{inr(p.profit_share)}</td>
                          <td className="p-3 num font-bold">{inr(p.final_share)}</td>
                          <td className="p-3 num">{inr(p.fair_share)}</td>
                          <td className={`p-3 num font-bold ${color}`}>
                            <div className="flex justify-end items-center gap-2">
                              <span className="overline text-[10px]">{label}</span>
                              <span>{inr(Math.abs(p.adjustment))}</span>
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <span className={`text-[10px] px-2 py-0.5 border ${settled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                              {settled ? "Settled" : "Pending"}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {canRecord && p.dues.length > 0 && (
                              <Button size="sm" variant="outline" className="rounded-none text-xs"
                                onClick={() => setExpandedPartner((s) => ({ ...s, [p.id]: !pOpen }))}
                                data-testid={`partner-settle-toggle-${p.id}`}>
                                Settle Dues ({p.dues.length})
                              </Button>
                            )}
                          </td>
                        </tr>
                        {pOpen && p.dues.map(({ center, partner }) => (
                          <tr key={`${p.id}-${center.center_id}`} className="border-b border-[var(--border)] bg-gray-50 text-xs">
                            <td className="p-2 pl-6 text-[var(--muted)]" colSpan={7}>
                              <ArrowUpCircle size={12} className="inline mr-1 text-red-500" />
                              Owes at <b>{center.center_name}</b>
                            </td>
                            <td className="p-2 num value-negative text-right font-semibold">{inr(Math.abs(partner.adjustment))}</td>
                            <td></td>
                            <td className="p-2 text-right">
                              <Button size="sm" variant="outline" className="rounded-none text-[11px]"
                                onClick={() => openSettleModal(center, partner)}
                                data-testid={`partner-settle-btn-${p.id}-${center.center_id}`}>
                                Settle
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ===== History Dialog ===== */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="rounded-none max-w-3xl" data-testid="history-dialog">
          <DialogHeader>
            <DialogTitle>Settled History</DialogTitle>
            <DialogDescription>All recorded partner-to-partner settlements you are authorised to view.</DialogDescription>
          </DialogHeader>
          {historyRecords.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--muted)]">No settlements recorded yet.</div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="border-b border-[var(--border)] overline">
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Center</th>
                    <th className="text-left p-2">From</th>
                    <th className="text-left p-2">To</th>
                    <th className="text-right p-2">Amount</th>
                    <th className="text-left p-2">Note</th>
                    {canUndo && <th className="text-right p-2">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {historyRecords.map((h) => (
                    <tr key={h.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="p-2 num whitespace-nowrap">{h.date}</td>
                      <td className="p-2">{h.center_name || "—"}</td>
                      <td className="p-2">{h.from_partner_name}</td>
                      <td className="p-2">{h.to_partner_name}</td>
                      <td className="p-2 num font-medium">{inr(h.amount)}</td>
                      <td className="p-2 text-[var(--muted)]">{h.note || "—"}</td>
                      {canUndo && (
                        <td className="p-2 text-right">
                          <button className="text-xs text-red-600 hover:underline"
                            onClick={() => deleteHistoryRecord(h.id)} data-testid={`undo-settlement-${h.id}`}>
                            Undo
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setHistoryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Contributing Transactions Drill-Down ===== */}
      <Dialog open={!!txnDrill} onOpenChange={(o) => !o && setTxnDrill(null)}>
        <DialogContent className="rounded-none max-w-4xl" data-testid="txn-drill-dialog">
          <DialogHeader>
            <DialogTitle>Contributing Transactions — {txnDrill?.center?.center_name}</DialogTitle>
            <DialogDescription>
              {txnDrill?.scope === "current"
                ? `Active cycle (${txnDrill?.data?.cutoff ? `after ${txnDrill?.data?.cutoff}` : "no cutoff yet"}).`
                : "All approved partner-tagged transactions for this center (lifetime)."}
            </DialogDescription>
          </DialogHeader>
          {txnDrill?.loading ? (
            <div className="text-sm text-[var(--muted)] p-4">Loading…</div>
          ) : txnDrill?.data ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-0 border border-[var(--border)] bg-gray-50 text-sm">
                <div className="p-2 border-r border-[var(--border)]">
                  <div className="overline text-[10px]">Total Investment</div>
                  <div className="num font-semibold">{inr(txnDrill.data.totals.investment)}</div>
                </div>
                <div className="p-2 border-r border-[var(--border)]">
                  <div className="overline text-[10px]">Total Expense</div>
                  <div className="num font-semibold value-negative">{inr(txnDrill.data.totals.expense)}</div>
                </div>
                <div className="p-2">
                  <div className="overline text-[10px]">Total Income</div>
                  <div className="num font-semibold value-positive">{inr(txnDrill.data.totals.income)}</div>
                </div>
              </div>
              <div className="text-xs text-[var(--muted)]">
                <b>{txnDrill.data.count}</b> transaction{txnDrill.data.count === 1 ? "" : "s"} counted
                {txnDrill.data.cutoff && ` — cutoff: ${txnDrill.data.cutoff}`}
              </div>
              {txnDrill.data.rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--muted)] border border-dashed border-[var(--border)]">
                  No transactions in this scope.
                </div>
              ) : (
                <div className="max-h-[50vh] overflow-y-auto border border-[var(--border)]">
                  <table className="w-full text-xs" data-testid="txn-drill-table">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="overline border-b border-[var(--border)]">
                        <th className="text-left p-2">Date</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-left p-2">Partner</th>
                        <th className="text-left p-2">Source</th>
                        <th className="text-right p-2">Amount</th>
                        <th className="text-left p-2">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txnDrill.data.rows.map((r) => (
                        <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-gray-50">
                          <td className="p-2 num whitespace-nowrap">{r.date}</td>
                          <td className={`p-2 font-semibold ${r.type === "income" ? "value-positive" : r.type === "expense" ? "value-negative" : ""}`}>{r.type}</td>
                          <td className="p-2">{r.partner_name}</td>
                          <td className="p-2 text-[var(--muted)]">{r.source || "—"}</td>
                          <td className={`p-2 num font-semibold ${r.type === "income" ? "value-positive" : r.type === "expense" ? "value-negative" : ""}`}>{inr(r.amount)}</td>
                          <td className="p-2 text-[var(--muted)] max-w-md truncate" title={r.description}>{r.description || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setTxnDrill(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Settle Dialog ===== */}
      <Dialog open={!!openModal} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="rounded-none" data-testid="settle-dialog">
          <DialogHeader>
            <DialogTitle>Settle Dues</DialogTitle>
            <DialogDescription>
              Recording this payment will reset balances from the chosen date — only transactions after this date will be counted going forward.
            </DialogDescription>
          </DialogHeader>
          {openModal && (
            <div className="space-y-3">
              <div className="text-sm"><span className="overline mr-2">Center</span><span className="font-medium">{openModal.center.center_name}</span></div>
              <div className="text-sm"><span className="overline mr-2">Paying Partner</span><span className="font-medium">{openModal.fromPartner.name}</span></div>
              <div className="space-y-1">
                <Label className="overline">Receiving Partner</Label>
                <select className="w-full h-10 border border-[var(--border)] px-3 text-sm"
                  value={form.to_partner_id} onChange={(e) => setForm({ ...form, to_partner_id: e.target.value })}
                  data-testid="settle-to-partner">
                  <option value="">— Select —</option>
                  {(openModal.toCandidates.length ? openModal.toCandidates : openModal.center.partners.filter((p) => p.id !== openModal.fromPartner.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} {p.adjustment < 0 ? `(to receive ${inr(Math.abs(p.adjustment))})` : ""}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="overline">Amount Paid (₹)</Label>
                <Input type="number" step="0.01" value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-none" data-testid="settle-amount" />
              </div>
              <div className="space-y-1">
                <Label className="overline">Payment Date (cutoff)</Label>
                <Input type="date" value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-none" data-testid="settle-date" />
              </div>
              <div className="space-y-1">
                <Label className="overline">Note (optional)</Label>
                <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="UTR / cheque no. / reference" className="rounded-none" data-testid="settle-note" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setOpenModal(null)}>Cancel</Button>
            <Button onClick={submitSettlement} disabled={submitting} className="rounded-none" data-testid="settle-submit">
              {submitting ? "Recording…" : "Record Settlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Detailed per-center table (original layout) — shown on card expand. */
function CenterDetail({ c, t, canRecord, openSettleModal, openTxnDrill, history, canUndo, onUndo }) {
  return (
    <div className="border-t border-[var(--border)]" data-testid={`center-detail-${c.center_id}`}>
      <div className="px-4 py-2 bg-gray-50 border-b border-[var(--border)] flex justify-between items-center flex-wrap gap-2">
        <div className="text-xs">
          {c.settled_till
            ? <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200">Settled till {c.settled_till} • Active cycle from next day</span>
            : <span className="text-[var(--muted)]">No settlement recorded yet.</span>}
        </div>
        <Button size="sm" variant="outline" className="rounded-none text-xs"
          onClick={() => openTxnDrill(c, "current")} data-testid={`view-txns-current-${c.center_id}`}>
          View Contributing Txns
        </Button>
      </div>
      {(c.partners || []).length === 0 ? (
        <div className="p-6 text-center text-sm text-[var(--muted)]">All settled. No new transactions after {c.settled_till || "cutoff"}.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-[var(--border)] overline">
                <th className="text-left p-3">{t("partner")}</th>
                <th className="text-right p-3">{t("investment")}</th>
                <th className="text-right p-3">{t("expense")}</th>
                <th className="text-right p-3">Contribution</th>
                <th className="text-right p-3">Profit Share (50%)</th>
                <th className="text-right p-3">Final Share</th>
                <th className="text-right p-3">{t("adjustment")}</th>
                {canRecord && <th className="text-right p-3">Action</th>}
              </tr>
            </thead>
            <tbody>
              {c.partners.map((p) => {
                const adj = p.adjustment;
                const isSettled = Math.abs(adj) < 0.5;
                const label = isSettled ? t("settled") : adj > 0 ? t("to_pay") : t("to_receive");
                const color = isSettled ? "text-[var(--muted)]" : adj > 0 ? "value-negative" : "value-positive";
                const psColor = (p.profit_share || 0) >= 0 ? "value-positive" : "value-negative";
                return (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0" data-testid={`settle-row-${c.center_id}-${p.id}`}>
                    <td className="p-3 font-medium">{p.name}</td>
                    <td className="p-3 num">{inr(p.investment)}</td>
                    <td className="p-3 num value-negative">{inr(p.expense)}</td>
                    <td className="p-3 num font-semibold">{inr(p.total_contribution)}</td>
                    <td className={`p-3 num ${psColor}`}>{inr(p.profit_share || 0)}</td>
                    <td className="p-3 num font-bold">{inr(p.final_share || 0)}</td>
                    <td className={`p-3 num font-bold ${color}`}>
                      <div className="flex justify-end items-center gap-2">
                        <span className="overline text-[10px]">{label}</span>
                        <span>{inr(Math.abs(adj))}</span>
                      </div>
                    </td>
                    {canRecord && (
                      <td className="p-3 text-right">
                        {adj > 0.5 && (
                          <Button size="sm" variant="outline" className="rounded-none text-xs"
                            onClick={() => openSettleModal(c, p)} data-testid={`settle-btn-${c.center_id}-${p.id}`}>
                            Settle Dues
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {history.length > 0 && (
        <div className="border-t border-[var(--border)] bg-gray-50 p-3">
          <div className="overline mb-2">Past settlements at this center</div>
          <div className="bg-white border border-[var(--border)] overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="border-b border-[var(--border)] overline">
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">From</th>
                  <th className="text-left p-2">To</th>
                  <th className="text-right p-2">Amount</th>
                  <th className="text-left p-2">Note</th>
                  {canUndo && <th className="text-right p-2">Action</th>}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="p-2 num">{h.date}</td>
                    <td className="p-2">{h.from_partner_name}</td>
                    <td className="p-2">{h.to_partner_name}</td>
                    <td className="p-2 num font-medium">{inr(h.amount)}</td>
                    <td className="p-2 text-[var(--muted)]">{h.note || "—"}</td>
                    {canUndo && (
                      <td className="p-2 text-right">
                        <button className="text-xs text-red-600 hover:underline"
                          onClick={() => onUndo(h.id)} data-testid={`undo-settlement-${h.id}`}>Undo</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

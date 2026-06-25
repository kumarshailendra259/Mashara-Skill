import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Download, FileBarChart2, Receipt } from "lucide-react";
import PrintButton from "@/components/PrintButton";

const QUARTERS = [
  { v: "all", label: "All Quarters" },
  { v: "Q1", label: "Q1 (Apr–Jun)" },
  { v: "Q2", label: "Q2 (Jul–Sep)" },
  { v: "Q3", label: "Q3 (Oct–Dec)" },
  { v: "Q4", label: "Q4 (Jan–Mar)" },
];

const inr2 = (n) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(n || 0));

// Current Indian FY (Apr–Mar)
function currentFY() {
  const d = new Date();
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // Apr (index 3) onwards = same year
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Build FY options: 5 years back + 1 year forward
function buildFYOptions() {
  const d = new Date();
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1;
  const list = [];
  for (let i = -5; i <= 1; i += 1) {
    const s = startYear + i;
    list.push(`${s}-${String((s + 1) % 100).padStart(2, "0")}`);
  }
  return list.reverse();
}

export default function TdsRegister() {
  const { user } = useAuth();
  const canExport = ["admin", "accountant", "senior_manager", "hr"].includes(user?.role);
  const [fy, setFy] = useState(currentFY());
  const [quarter, setQuarter] = useState("all");
  const [projectId, setProjectId] = useState("__all");
  const [projects, setProjects] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const fyOptions = useMemo(buildFYOptions, []);

  useEffect(() => {
    api.get("/entities/project").then((r) => setProjects(r.data || [])).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = { fy, quarter };
      if (projectId && projectId !== "__all") params.project_id = projectId;
      const r = await api.get("/reports/tds-register", { params });
      setData(r.data);
    } catch (e) {
      toast.error(formatError(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fy, quarter, projectId]);

  const downloadCsv = async () => {
    try {
      const params = new URLSearchParams({ fy, quarter });
      if (projectId && projectId !== "__all") params.append("project_id", projectId);
      const url = `${process.env.REACT_APP_BACKEND_URL}/api/reports/tds-register/csv?${params.toString()}`;
      // Open in new tab — backend uses cookies (withCredentials)
      const a = document.createElement("a");
      a.href = url;
      a.click();
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const totals = data?.totals || { tds_amount: 0, count: 0 };
  const byQuarter = data?.by_quarter || { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  const byProject = data?.by_project || [];
  const rows = data?.rows || [];

  return (
    <div className="space-y-5" data-testid="tds-register-page">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <div className="overline text-[var(--brand)]">/ reports</div>
          <h1 className="font-heading text-3xl font-black tracking-tight mt-1 flex items-center gap-2">
            <Receipt size={26} /> TDS Register
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
            All TDS deductions by department on milestone payments — Form 26Q quarterly filing helper.
            Sourced from approved transactions with <code className="text-xs bg-gray-100 px-1">source=&apos;tds_deduction&apos;</code>.
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <PrintButton />
          {canExport && (
            <Button onClick={downloadCsv} className="brand-btn rounded-none gap-1" data-testid="tds-csv-btn">
              <Download size={14} /> CSV
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="swiss-card p-4 grid grid-cols-1 md:grid-cols-4 gap-3 no-print">
        <div>
          <Label className="overline">Financial Year</Label>
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="rounded-none" data-testid="tds-fy"><SelectValue /></SelectTrigger>
            <SelectContent>{fyOptions.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="overline">Quarter</Label>
          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger className="rounded-none" data-testid="tds-quarter"><SelectValue /></SelectTrigger>
            <SelectContent>{QUARTERS.map((q) => <SelectItem key={q.v} value={q.v}>{q.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label className="overline">Project filter</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="rounded-none" data-testid="tds-project"><SelectValue placeholder="All projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All projects</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="swiss-card p-3 md:col-span-1">
          <div className="overline">Total TDS · {fy}</div>
          <div className="num font-heading font-black text-2xl text-[var(--brand)] mt-1">{inr2(totals.tds_amount)}</div>
          <div className="text-xs text-[var(--muted)] mt-1">{totals.count} transaction{totals.count === 1 ? "" : "s"}</div>
        </div>
        {["Q1", "Q2", "Q3", "Q4"].map((q) => (
          <div key={q} className="swiss-card p-3" data-testid={`tds-card-${q}`}>
            <div className="overline">{q}</div>
            <div className="num font-bold text-lg mt-1">{inr2(byQuarter[q] || 0)}</div>
          </div>
        ))}
      </div>

      {/* Project-wise breakdown */}
      {byProject.length > 0 && (
        <div className="swiss-card p-4">
          <div className="overline mb-3">By Project</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="overline bg-gray-50 border-b border-[var(--border)]">
                <th className="text-left p-2">Project</th>
                <th className="text-right p-2">TDS Amount</th>
                <th className="text-right p-2">Share</th>
              </tr></thead>
              <tbody>
                {byProject.map((p) => {
                  const pct = totals.tds_amount > 0 ? (p.tds_amount / totals.tds_amount) * 100 : 0;
                  return (
                    <tr key={p.project_id || "__unassigned"} className="border-b border-[var(--border)]">
                      <td className="p-2">{p.project_name || <span className="text-[var(--muted)]">Unassigned</span>}</td>
                      <td className="p-2 num text-right">{inr2(p.tds_amount)}</td>
                      <td className="p-2 num text-right text-[var(--muted)]">{pct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detailed transactions table */}
      <div className="swiss-card overflow-x-auto" data-testid="tds-txn-table">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
            <th className="text-left p-3">Date</th>
            <th className="text-left p-3">Quarter</th>
            <th className="text-left p-3">Project</th>
            <th className="text-left p-3">Center</th>
            <th className="text-left p-3">Milestone</th>
            <th className="text-left p-3">Description</th>
            <th className="text-right p-3">TDS Amount</th>
          </tr></thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center p-8 overline">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center p-8 text-[var(--muted)]">
                <FileBarChart2 size={28} className="mx-auto mb-2 opacity-40" />
                No TDS deductions in this period.
              </td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.txn_id} className="border-b border-[var(--border)]" data-testid={`tds-row-${r.txn_id}`}>
                <td className="p-3 num">{r.date}</td>
                <td className="p-3 overline text-xs">{r.quarter}</td>
                <td className="p-3">{r.project_name || <span className="text-[var(--muted)]">—</span>}</td>
                <td className="p-3">{r.center_name || <span className="text-[var(--muted)]">—</span>}</td>
                <td className="p-3 overline text-xs">{r.milestone || "—"}</td>
                <td className="p-3 text-xs text-[var(--muted)] max-w-md truncate" title={r.description}>{r.description}</td>
                <td className="p-3 num font-medium text-right">{inr2(r.tds_amount)}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-blue-50 font-bold">
                <td colSpan={6} className="p-3 text-right">TOTAL</td>
                <td className="p-3 num text-right text-[var(--brand)]">{inr2(totals.tds_amount)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Search, RefreshCw, Filter, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import { api, formatError } from "@/lib/api";

const inr = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format((paise || 0) / 100);
const dt  = (iso) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function CompaniesAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (q.trim()) params.q = q.trim();
      if (status !== "all") params.status = status;
      const r = await api.get("/companies-admin/list", { params });
      setRows(r.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [q, status]);

  useEffect(() => { load(); }, [load]);

  const totalCompanies = rows.length;
  const activeCount    = rows.filter((r) => r.subscription_status === "active").length;
  const totalHrmsUsed  = rows.reduce((s, r) => s + (r.hrms_used || 0), 0);
  const totalRoleUsed  = rows.reduce((s, r) => s + (r.role_user_used || 0), 0);
  const totalHrmsBought= rows.reduce((s, r) => s + (r.hrms_purchased || 0), 0);
  const totalRoleBought= rows.reduce((s, r) => s + (r.role_user_purchased || 0), 0);
  const totalRevenue   = rows.reduce((s, r) => s + (r.latest_order_amount || 0), 0);

  const exportCsv = () => {
    if (!rows.length) return;
    const headers = ["Company Name","Company Code","Plan","HRMS Purchased","HRMS Used","Role/User Purchased","Role/User Used","Status","Expiry","Latest Payment"];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(",")].concat(rows.map((r) => [
      r.company_name, r.company_code, r.plan, r.hrms_purchased, r.hrms_used,
      r.role_user_purchased, r.role_user_used, r.subscription_status,
      r.expiry_date ? dt(r.expiry_date) : "",
      r.latest_payment || "",
    ].map(escape).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `companies_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="companies-admin-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
            <Building2 size={14}/> Super Admin
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 mt-1" data-testid="ca-heading">Companies</h1>
          <div className="text-sm text-slate-500 mt-1">All tenants — subscriptions, license usage, payments</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="export-csv"><Download size={14} className="mr-1"/> CSV</Button>
          <Button variant="outline" size="sm" onClick={load} data-testid="refresh"><RefreshCw size={14} className="mr-1"/> Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Companies" value={totalCompanies} testid="k-total"/>
        <Kpi label="Active Subs" value={activeCount} accent="emerald" testid="k-active"/>
        <Kpi label="HRMS Licenses" value={`${totalHrmsUsed}/${totalHrmsBought}`} testid="k-hrms"/>
        <Kpi label="Role/User Licenses" value={`${totalRoleUsed}/${totalRoleBought}`} testid="k-role"/>
        <Kpi label="Recent Revenue" value={inr(totalRevenue)} accent="blue" testid="k-revenue"/>
      </div>

      <Card className="p-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 mb-4">
          <div className="flex-1 flex items-center gap-2 border rounded-md px-3 h-10 bg-white">
            <Search size={14} className="text-slate-400"/>
            <input
              className="flex-1 outline-none text-sm bg-transparent"
              placeholder="Search by company name, code or payment ID…"
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              data-testid="search-input"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48" data-testid="status-filter"><Filter size={14} className="mr-1"/> <SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="expired">Expired only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-widest text-slate-500 border-b">
              <tr>
                <th className="text-left py-2">Company</th>
                <th className="text-left">Code</th>
                <th className="text-left">Modules</th>
                <th className="text-right">HRMS Used/Bought</th>
                <th className="text-right">Role/User Used/Bought</th>
                <th className="text-left">Status</th>
                <th className="text-left">Expiry</th>
                <th className="text-left">Latest Payment</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="py-8 text-center text-slate-400">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-slate-400">No companies</td></tr>}
              {!loading && rows.map((r) => (
                <tr key={r.company_id} className="border-b last:border-0 hover:bg-slate-50" data-testid={`company-row-${r.company_code}`}>
                  <td className="py-2 font-semibold text-slate-900">{r.company_name || "—"}</td>
                  <td className="font-mono text-[11px] text-slate-500">{r.company_code || "—"}</td>
                  <td className="text-xs text-slate-500 max-w-[200px] truncate" title={r.plan}>{r.plan}</td>
                  <td className="text-right tabular-nums"><span className="font-bold">{r.hrms_used || 0}</span><span className="text-slate-400"> / {r.hrms_purchased || 0}</span></td>
                  <td className="text-right tabular-nums"><span className="font-bold">{r.role_user_used || 0}</span><span className="text-slate-400"> / {r.role_user_purchased || 0}</span></td>
                  <td><Badge className={r.subscription_status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}>{r.subscription_status}</Badge></td>
                  <td className="text-slate-500 text-xs">{dt(r.expiry_date)}</td>
                  <td>
                    {r.latest_payment
                      ? <div className="text-[11px] font-mono text-slate-500">{r.latest_payment}<div className="text-[10px] text-slate-400">{inr(r.latest_order_amount)} · {dt(r.latest_order_at)}</div></div>
                      : <span className="text-slate-400 text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, accent, testid }) {
  const map = { emerald: "text-emerald-700", blue: "text-blue-700" };
  return (
    <Card className="p-4" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">{label}</div>
      <div className={`text-2xl font-black tabular-nums mt-1 ${map[accent] || "text-slate-900"}`}>{value}</div>
    </Card>
  );
}

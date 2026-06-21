import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { inr } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import PrintButton from "@/components/PrintButton";
import { ShieldAlert } from "lucide-react";

const TYPES = ["transaction", "reimbursement", "leave", "payroll"];
const ACTIONS = ["approved", "rejected", "l1_approved", "accountant_approved", "paid"];

function actionBadge(action) {
  const map = {
    approved: "border-[var(--success)] text-[var(--success)]",
    paid: "border-[var(--brand)] text-[var(--brand)]",
    l1_approved: "border-[var(--brand)] text-[var(--brand)]",
    accountant_approved: "border-[var(--brand)] text-[var(--brand)]",
    rejected: "border-[var(--danger)] text-[var(--danger)]",
  };
  return `inline-block px-2 py-0.5 text-xs border ${map[action] || "border-[var(--border)]"}`;
}

export default function ApprovalLog() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ type_filter: "", action: "", start: "", end: "" });
  const [loading, setLoading] = useState(false);

  const params = useMemo(() => {
    const p = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    return p;
  }, [filters]);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    api.get("/approval-log", { params }).then((r) => setRows(r.data)).catch(() => setRows([])).finally(() => setLoading(false));
  }, [params, isAdmin]);

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));

  if (!isAdmin) {
    return (
      <div className="swiss-card p-8 text-center" data-testid="approval-log-forbidden">
        <ShieldAlert className="mx-auto mb-3 text-[var(--danger)]" size={32} />
        <h2 className="font-heading font-bold text-xl mb-1">Admin only</h2>
        <p className="text-sm text-[var(--muted)]">The Approval Log is restricted to admin users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="approval-log-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">Audit</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">Approval Log</h1>
        </div>
        <PrintButton />
      </div>

      <div className="swiss-card p-4 grid grid-cols-2 md:grid-cols-4 gap-3 no-print">
        <div>
          <Label className="overline">Type</Label>
          <Select value={filters.type_filter || "__all"} onValueChange={(v) => setF("type_filter", v === "__all" ? "" : v)}>
            <SelectTrigger className="rounded-none" data-testid="filter-type"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All</SelectItem>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="overline">Action</Label>
          <Select value={filters.action || "__all"} onValueChange={(v) => setF("action", v === "__all" ? "" : v)}>
            <SelectTrigger className="rounded-none" data-testid="filter-action"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All</SelectItem>
              {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="overline">From</Label>
          <Input type="date" value={filters.start} onChange={(e) => setF("start", e.target.value)} className="rounded-none" data-testid="filter-start" />
        </div>
        <div>
          <Label className="overline">To</Label>
          <Input type="date" value={filters.end} onChange={(e) => setF("end", e.target.value)} className="rounded-none" data-testid="filter-end" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="swiss-card p-3"><div className="overline">Total</div><div className="num font-bold text-2xl">{rows.length}</div></div>
        <div className="swiss-card p-3"><div className="overline">Approved</div><div className="num font-bold text-2xl text-[var(--success)]">{rows.filter((r) => r.action === "approved" || r.action === "paid").length}</div></div>
        <div className="swiss-card p-3"><div className="overline">Rejected</div><div className="num font-bold text-2xl text-[var(--danger)]">{rows.filter((r) => r.action === "rejected").length}</div></div>
        <div className="swiss-card p-3"><div className="overline">Total Amount</div><div className="num font-bold text-2xl">{inr(rows.reduce((s, r) => s + (r.amount || 0), 0))}</div></div>
      </div>

      <div className="swiss-card overflow-x-auto" data-testid="approval-log-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3 w-44">Date / Time</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Action</th>
              <th className="text-left p-3">Summary</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">By</th>
              <th className="text-left p-3">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8 overline">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 overline">No approvals yet</td></tr>
            ) : rows.map((r) => (
              <tr key={`${r.type}-${r.ref_id}-${r.action}-${r.at}`} className="border-b border-[var(--border)] hover:bg-gray-50">
                <td className="p-3 num text-xs">{r.at ? new Date(r.at).toLocaleString() : "—"}</td>
                <td className="p-3 overline text-xs">{r.type}</td>
                <td className="p-3"><span className={actionBadge(r.action)}>{r.action}</span></td>
                <td className="p-3">{r.summary || "—"}</td>
                <td className="p-3 num font-medium">{r.amount != null ? inr(r.amount) : "—"}</td>
                <td className="p-3">{r.by || "—"}</td>
                <td className="p-3 text-[var(--muted)] max-w-xs truncate" title={r.remarks || ""}>{r.remarks || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

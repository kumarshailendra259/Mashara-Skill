import React from "react";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, ShieldCheck, Layers, BarChart3, Plus, Eye, RotateCcw } from "lucide-react";

const FinCard = ({ label, value, icon: Icon, tone, testId }) => {
  const box = {
    brand: "bg-[var(--brand-soft)] text-[var(--brand)]",
    amber: "bg-[var(--warning-soft)] text-amber-700",
    indigo: "bg-[var(--investment-soft)] text-[var(--investment)]",
    green: "bg-[var(--success-soft)] text-[var(--success)]",
  }[tone];
  return (
    <div className="swiss-card p-4 flex items-start justify-between gap-2" data-testid={testId}>
      <div className="min-w-0">
        <div className="overline text-[10px]">{label}</div>
        <div className="font-heading font-bold text-xl num mt-1 truncate">{inr(value)}</div>
      </div>
      {Icon && <div className={`shrink-0 h-9 w-9 rounded-lg flex items-center justify-center ${box}`}><Icon size={16} /></div>}
    </div>
  );
};

export default function WorkOrderFinancials({
  cards, summaryRows, grandTotal, filters, setFilter, clearFilters,
  projects, centers, loading, onAddWO, onViewRow, canManage,
}) {
  const FY = ["2024-25", "2025-26", "2026-27", "2027-28", "2028-29"];
  return (
    <div className="space-y-4" data-testid="wo-financials">
      {/* Financial KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FinCard label="Total Work Order Value" value={cards?.total_work_order_value || 0} icon={Wallet} tone="brand" testId="wo-card-total-value" />
        <FinCard label="Total PBG Amount" value={cards?.total_pbg_amount || 0} icon={ShieldCheck} tone="amber" testId="wo-card-pbg" />
        <FinCard label="Allocated Value" value={cards?.allocated_value || 0} icon={Layers} tone="indigo" testId="wo-card-allocated" />
        <FinCard label="Average Work Order Value" value={cards?.average_work_order_value || 0} icon={BarChart3} tone="green" testId="wo-card-avg" />
      </div>

      {/* Filters */}
      <div className="swiss-card p-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div className="col-span-2 md:col-span-1">
            <Label className="overline">Search</Label>
            <Input value={filters.q} onChange={(e) => setFilter("q", e.target.value)} placeholder="Project / Centre / Company / WO No." className="h-9" data-testid="wo-filter-search" />
          </div>
          <div>
            <Label className="overline">Project</Label>
            <Select value={filters.project_id} onValueChange={(v) => setFilter("project_id", v)}>
              <SelectTrigger className="h-9" data-testid="wo-filter-project"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Projects</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">Centre</Label>
            <Select value={filters.center_id} onValueChange={(v) => setFilter("center_id", v)}>
              <SelectTrigger className="h-9" data-testid="wo-filter-center"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Centres</SelectItem>{centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">Financial Year</Label>
            <Select value={filters.fy} onValueChange={(v) => setFilter("fy", v)}>
              <SelectTrigger className="h-9" data-testid="wo-filter-fy"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All FY</SelectItem>{FY.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline">WO Status</Label>
            <Select value={filters.status} onValueChange={(v) => setFilter("status", v)}>
              <SelectTrigger className="h-9" data-testid="wo-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem><SelectItem value="active">Active</SelectItem>
                <SelectItem value="expired">Expired</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-9 flex-1" onClick={clearFilters} data-testid="wo-filter-clear"><RotateCcw size={13} /> Clear</Button>
            {canManage && <Button className="brand-btn h-9 flex-1" onClick={() => onAddWO()} data-testid="wo-add-btn"><Plus size={14} /> Work Order</Button>}
          </div>
        </div>
      </div>

      {/* Work Order Financial Summary */}
      <div>
        <div className="font-heading font-bold text-base mb-2">Work Order Financial Summary</div>
        <div className="swiss-card overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px] [&>th]:whitespace-nowrap">
                <th>Project</th><th>Centre</th><th>FY</th><th className="text-right">WO Count</th>
                <th className="text-right">Total Target</th><th className="text-right">Allocated</th><th className="text-right">Remaining</th>
                <th className="text-right">Utilization</th><th className="text-right">Total WO Value</th><th className="text-right">PBG Amount</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={11} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
              {!loading && (!summaryRows || summaryRows.length === 0) && (
                <tr><td colSpan={11} className="p-8 text-center text-[var(--muted)]" data-testid="wo-summary-empty">No active work orders yet. Click <b>+ Work Order</b> to add one.</td></tr>
              )}
              {(summaryRows || []).map((r, i) => (
                <tr key={i} className="border-t border-[var(--border)] hover:bg-slate-50 [&>td]:p-2 [&>td]:whitespace-nowrap" data-testid={`wo-summary-row-${i}`}>
                  <td className="font-semibold">{r.project_name || "—"}</td>
                  <td>{r.center_name || "—"}</td>
                  <td className="num">{r.fy || "—"}</td>
                  <td className="text-right num">{r.wo_count}</td>
                  <td className="text-right num">{r.total_target?.toLocaleString("en-IN")}</td>
                  <td className="text-right num text-emerald-700">{r.allocated?.toLocaleString("en-IN")}</td>
                  <td className="text-right num text-amber-700">{r.remaining?.toLocaleString("en-IN")}</td>
                  <td className="text-right num">{r.utilization_pct}%</td>
                  <td className="text-right num font-semibold text-[var(--brand)]">{inr(r.total_wo_value)}</td>
                  <td className="text-right num text-amber-700">{inr(r.pbg_amount)}</td>
                  <td><Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onViewRow(r)} data-testid={`wo-summary-view-${i}`}><Eye size={12} /> View</Button></td>
                </tr>
              ))}
            </tbody>
            {summaryRows && summaryRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] bg-slate-50 font-bold [&>td]:p-2 [&>td]:whitespace-nowrap" data-testid="wo-summary-grand">
                  <td colSpan={3} className="overline">Grand Total</td>
                  <td className="text-right num">{grandTotal?.wo_count}</td>
                  <td className="text-right num">{grandTotal?.total_target?.toLocaleString("en-IN")}</td>
                  <td className="text-right num text-emerald-700">{grandTotal?.allocated?.toLocaleString("en-IN")}</td>
                  <td className="text-right num text-amber-700">{grandTotal?.remaining?.toLocaleString("en-IN")}</td>
                  <td></td>
                  <td className="text-right num text-[var(--brand)]">{inr(grandTotal?.total_wo_value)}</td>
                  <td className="text-right num text-amber-700">{inr(grandTotal?.pbg_amount)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

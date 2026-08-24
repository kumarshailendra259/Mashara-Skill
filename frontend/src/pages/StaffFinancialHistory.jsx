import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Wallet, Receipt, TrendingUp, Gift, Award, Zap, Coins, PiggyBank,
  Download, Plus, Search, Calendar, User, Filter, FileText,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const PAYMENT_TYPES = [
  { id: "salary", label: "Salary", icon: Wallet, tone: "bg-slate-50 text-slate-700 border-slate-300" },
  { id: "reimbursement", label: "Reimbursement", icon: Receipt, tone: "bg-blue-50 text-blue-700 border-blue-300" },
  { id: "salary_advance", label: "Salary Advance", icon: PiggyBank, tone: "bg-amber-50 text-amber-700 border-amber-300" },
  { id: "bonus", label: "Bonus", icon: Gift, tone: "bg-emerald-50 text-emerald-700 border-emerald-300" },
  { id: "incentive", label: "Incentive", icon: Award, tone: "bg-teal-50 text-teal-700 border-teal-300" },
  { id: "overtime", label: "Overtime", icon: Zap, tone: "bg-orange-50 text-orange-700 border-orange-300" },
  { id: "arrear", label: "Arrear", icon: Coins, tone: "bg-indigo-50 text-indigo-700 border-indigo-300" },
  { id: "loan_payment", label: "Loan Payment", icon: PiggyBank, tone: "bg-cyan-50 text-cyan-700 border-cyan-300" },
  { id: "final_settlement", label: "Final Settlement", icon: FileText, tone: "bg-purple-50 text-purple-700 border-purple-300" },
  { id: "other_payment", label: "Other Payment", icon: TrendingUp, tone: "bg-pink-50 text-pink-700 border-pink-300" },
  { id: "recovery", label: "Recovery", icon: Coins, tone: "bg-red-50 text-red-700 border-red-300" },
];

const MANUAL_TYPES = ["bonus", "incentive", "overtime", "arrear", "loan_payment", "final_settlement", "other_payment", "recovery"];

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function StaffFinancialHistory() {
  const { user } = useAuth();
  const canEdit = ["admin", "hr", "accountant"].includes(user?.role);

  const [staffList, setStaffList] = useState([]);
  const [staffQ, setStaffQ] = useState("");
  const [selectedSid, setSelectedSid] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [filters, setFilters] = useState({ date_from: "", date_to: "", payment_type: "", status: "" });

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    payment_type: "bonus", payment_date: new Date().toISOString().slice(0, 10),
    amount: "", description: "", payment_mode: "bank", payment_reference: "", remarks: "",
  });
  const [addBusy, setAddBusy] = useState(false);

  // Load staff — server-side search (small `q` sends the right subset).
  useEffect(() => {
    const params = staffQ.trim() ? { q: staffQ.trim(), limit: 200 } : { limit: 200 };
    const t = setTimeout(() => {
      api.get("/staff", { params }).then((r) => {
        const rows = Array.isArray(r.data) ? r.data : (r.data?.rows || []);
        setStaffList(rows);
      }).catch(() => setStaffList([]));
    }, 250);
    return () => clearTimeout(t);
  }, [staffQ]);

  const filteredStaff = staffList.slice(0, 100);

  const load = async () => {
    if (!selectedSid) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const { data: d } = await api.get(`/staff/${selectedSid}/financial-history?${params.toString()}`);
      setData(d);
    } catch (e) {
      toast.error(formatError(e));
      setData(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (selectedSid) load();
  }, [selectedSid, filters]);

  const resetFilters = () => setFilters({ date_from: "", date_to: "", payment_type: "", status: "" });

  const applyPreset = (preset) => {
    const now = new Date();
    let from = "", to = new Date().toISOString().slice(0, 10);
    if (preset === "this_month") {
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    } else if (preset === "last_month") {
      const d1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const d2 = new Date(now.getFullYear(), now.getMonth(), 0);
      from = d1.toISOString().slice(0, 10);
      to = d2.toISOString().slice(0, 10);
    } else if (preset === "fy_current") {
      const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      from = `${y}-04-01`;
      to = `${y + 1}-03-31`;
    } else if (preset === "till_date") {
      from = "";
      to = "";
    }
    setFilters((f) => ({ ...f, date_from: from, date_to: to }));
  };

  const submitAdd = async () => {
    setAddBusy(true);
    try {
      await api.post("/staff-payments", {
        ...addForm,
        staff_id: selectedSid,
        amount: Number(addForm.amount),
      });
      toast.success("Payment added");
      setAddOpen(false);
      setAddForm({ ...addForm, amount: "", description: "", payment_reference: "", remarks: "" });
      load();
    } catch (e) {
      toast.error(formatError(e));
    }
    setAddBusy(false);
  };

  const exportCsv = () => {
    if (!data) return;
    const header = ["Date", "Month", "Payment Type", "Reference", "Description", "Gross", "Deduction", "Net", "Status", "Payment Mode", "Payment Ref"];
    const rows = data.transactions.map((t) => [t.date, t.month, t.payment_type, t.reference, t.description, t.gross, t.deduction, t.net, t.status, t.payment_mode, t.payment_reference || ""]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${(c ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `financial_history_${data.staff.name || "staff"}_${Date.now()}.csv`;
    a.click();
  };

  const s = data?.staff;
  const sum = data?.summary;

  const kpiCards = sum ? [
    { key: "salary", label: "Total Salary", value: sum.total_salary, tone: "bg-slate-50 border-slate-200 text-slate-800" },
    { key: "reimb", label: "Reimbursements", value: sum.total_reimbursement, tone: "bg-blue-50 border-blue-200 text-blue-800" },
    { key: "advance", label: "Advances", value: sum.total_advance, tone: "bg-amber-50 border-amber-200 text-amber-800" },
    { key: "bonus", label: "Bonus + Incentive", value: sum.total_bonus + sum.total_incentive, tone: "bg-emerald-50 border-emerald-200 text-emerald-800" },
    { key: "overtime", label: "Overtime + Arrear", value: sum.total_overtime + sum.total_arrear, tone: "bg-orange-50 border-orange-200 text-orange-800" },
    { key: "other", label: "Other Payments", value: sum.total_other, tone: "bg-pink-50 border-pink-200 text-pink-800" },
    { key: "deductions", label: "Deductions", value: sum.total_deductions, tone: "bg-red-50 border-red-200 text-red-800" },
    { key: "grand", label: "Grand Total Paid", value: sum.grand_total, tone: "bg-[#dfe4ff] border-[var(--brand)] text-[var(--brand)] font-bold" },
  ] : [];

  return (
    <div className="space-y-5" data-testid="staff-fin-history-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">Employee / HR Management</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">Employee Payment History</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Ek jagah pe har employee ki lifetime financial ledger — salary, reimbursement, advance, bonus, incentive, overtime, aur manual payments.</p>
        </div>
      </div>

      {/* Employee picker + Filters */}
      <div className="border border-[var(--border)] bg-white p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-1">
            <Label className="text-[11px]">Search Employee</Label>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-2.5 text-[var(--muted)]" />
              <Input value={staffQ} onChange={(e) => setStaffQ(e.target.value)} placeholder="Name / Emp Code / Designation" className="pl-8" data-testid="staff-search" />
            </div>
            <div className="mt-1 max-h-40 overflow-y-auto border border-[var(--border)]" data-testid="staff-list">
              {filteredStaff.length === 0 ? (
                <div className="p-2 text-[11px] text-[var(--muted)]">No staff found</div>
              ) : filteredStaff.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedSid(st.id)}
                  data-testid={`pick-${st.id}`}
                  className={`w-full text-left px-2 py-1.5 text-[12px] border-b border-[var(--border)] hover:bg-slate-50 ${selectedSid === st.id ? "bg-[#f3f5fb] font-semibold" : ""}`}
                >
                  <div className="truncate">{st.name}</div>
                  <div className="text-[10px] text-[var(--muted)]">{st.employee_code || "—"} · {st.designation || "—"}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div>
                <Label className="text-[11px]">Date From</Label>
                <Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} data-testid="filter-from" />
              </div>
              <div>
                <Label className="text-[11px]">Date To</Label>
                <Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} data-testid="filter-to" />
              </div>
              <div>
                <Label className="text-[11px]">Payment Type</Label>
                <Select value={filters.payment_type || "__all"} onValueChange={(v) => setFilters({ ...filters, payment_type: v === "__all" ? "" : v })}>
                  <SelectTrigger data-testid="filter-type"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All Types</SelectItem>
                    {PAYMENT_TYPES.map((pt) => <SelectItem key={pt.id} value={pt.id}>{pt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Status</Label>
                <Select value={filters.status || "__all"} onValueChange={(v) => setFilters({ ...filters, status: v === "__all" ? "" : v })}>
                  <SelectTrigger data-testid="filter-status"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2 flex items-end gap-1 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => applyPreset("this_month")}>This Month</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset("last_month")}>Last Month</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset("fy_current")}>FY 2026-27</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset("till_date")}>Till Date</Button>
                <Button size="sm" variant="outline" onClick={resetFilters}>Reset</Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!selectedSid ? (
        <div className="border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">
          <User size={32} className="mx-auto mb-2 opacity-40" />
          Left sidebar se ek employee select karein
        </div>
      ) : loading ? (
        <div className="p-8 text-center text-[var(--muted)]">Loading financial history…</div>
      ) : !data ? (
        <div className="p-8 text-center text-[var(--muted)]">No data</div>
      ) : (
        <>
          {/* Staff header */}
          <div className="border border-[var(--border)] bg-gradient-to-r from-slate-50 to-indigo-50/40 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-heading font-black text-xl tracking-tight">{s.name}</div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">
                <span className="mr-3">{s.employee_code || "—"}</span>
                <span className="mr-3">{s.designation || "—"}</span>
                <span className="mr-3">Joined: {fmtDate(s.joining_date)}</span>
                {s.exit_date ? <span className="mr-3 text-red-700">Exited: {fmtDate(s.exit_date)}</span> : <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 border text-[10px]">Active</Badge>}
              </div>
            </div>
            <div className="flex gap-2">
              {canEdit && (
                <Button size="sm" onClick={() => setAddOpen(true)} data-testid="btn-add-payment">
                  <Plus size={14} className="mr-1" /> Add Payment
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={exportCsv} data-testid="btn-export">
                <Download size={14} className="mr-1" /> Export CSV
              </Button>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpiCards.map((k) => (
              <div key={k.key} className={`border p-3 ${k.tone}`} data-testid={`kpi-${k.key}`}>
                <div className="overline text-[10px] font-semibold">{k.label}</div>
                <div className="font-heading font-black text-xl tracking-tight num mt-1">{inr(k.value)}</div>
              </div>
            ))}
          </div>

          {/* Tabs — Transactions | Monthly Summary */}
          <Tabs defaultValue="txns">
            <TabsList className="rounded-none bg-white border border-[var(--border)] p-1 h-auto">
              <TabsTrigger value="txns" data-testid="tab-txns" className="rounded-none data-[state=active]:bg-slate-100 px-4 py-2">
                Transactions ({data.transactions.length})
              </TabsTrigger>
              <TabsTrigger value="monthly" data-testid="tab-monthly" className="rounded-none data-[state=active]:bg-slate-100 px-4 py-2">
                Monthly Summary ({data.monthly.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="txns" className="mt-4">
              <div className="border border-[var(--border)] bg-white overflow-x-auto">
                <table className="w-full text-sm" data-testid="fin-txn-table">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Month</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Gross</th>
                      <th className="px-3 py-2 text-right">Deduction</th>
                      <th className="px-3 py-2 text-right">Net</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.length === 0 ? (
                      <tr><td colSpan="10" className="px-3 py-8 text-center text-[var(--muted)]">No transactions in the selected range.</td></tr>
                    ) : data.transactions.map((t) => {
                      const pt = PAYMENT_TYPES.find((p) => p.id === t.payment_type) || PAYMENT_TYPES[0];
                      const paid = ["paid", "released", "adjusting", "settled"].includes((t.status || "").toLowerCase());
                      return (
                        <tr key={t.id} className="border-t border-[var(--border)] hover:bg-slate-50" data-testid={`txn-${t.id}`}>
                          <td className="px-3 py-2 text-[12px]">{fmtDate(t.date)}</td>
                          <td className="px-3 py-2 text-[12px]">{t.month}</td>
                          <td className="px-3 py-2">
                            <Badge className={`${pt.tone} border font-normal text-[11px]`}>{pt.label}</Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px]">{t.reference}</td>
                          <td className="px-3 py-2 text-[12px] max-w-xs truncate" title={t.description}>{t.description}</td>
                          <td className="px-3 py-2 text-right num text-[12px]">{inr(t.gross)}</td>
                          <td className="px-3 py-2 text-right num text-[12px] text-red-700">{t.deduction ? inr(t.deduction) : "—"}</td>
                          <td className="px-3 py-2 text-right num font-semibold">{inr(t.net)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-1.5 py-0.5 text-[10px] border ${paid ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-slate-300 text-slate-600 bg-slate-50"}`}>{t.status}</span>
                          </td>
                          <td className="px-3 py-2 text-[11px] uppercase">{t.payment_mode || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="monthly" className="mt-4">
              <div className="border border-[var(--border)] bg-white overflow-x-auto">
                <table className="w-full text-sm" data-testid="fin-monthly-table">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                      <th className="px-3 py-2">Month</th>
                      <th className="px-3 py-2 text-right">Salary</th>
                      <th className="px-3 py-2 text-right">Reimbursement</th>
                      <th className="px-3 py-2 text-right">Advance</th>
                      <th className="px-3 py-2 text-right">Bonus</th>
                      <th className="px-3 py-2 text-right">Incentive</th>
                      <th className="px-3 py-2 text-right">Overtime</th>
                      <th className="px-3 py-2 text-right">Other</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthly.length === 0 ? (
                      <tr><td colSpan="9" className="px-3 py-8 text-center text-[var(--muted)]">No paid months in range.</td></tr>
                    ) : data.monthly.map((m) => (
                      <tr key={m.month} className="border-t border-[var(--border)]" data-testid={`monthly-${m.month}`}>
                        <td className="px-3 py-2 font-semibold">{m.month}</td>
                        <td className="px-3 py-2 text-right num">{inr(m.salary)}</td>
                        <td className="px-3 py-2 text-right num">{inr(m.reimbursement)}</td>
                        <td className="px-3 py-2 text-right num">{inr(m.salary_advance)}</td>
                        <td className="px-3 py-2 text-right num">{inr(m.bonus)}</td>
                        <td className="px-3 py-2 text-right num">{inr(m.incentive)}</td>
                        <td className="px-3 py-2 text-right num">{inr(m.overtime)}</td>
                        <td className="px-3 py-2 text-right num">{inr((m.other_payment || 0) + (m.arrear || 0) + (m.final_settlement || 0) + (m.loan_payment || 0))}</td>
                        <td className="px-3 py-2 text-right num font-bold text-[var(--brand)]">{inr(m.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Add Manual Payment Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Payment</DialogTitle>
            <DialogDescription>Manual payment (bonus, incentive, arrear, final settlement etc.) will be added to the ledger with source = custom.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Payment Type</Label>
              <Select value={addForm.payment_type} onValueChange={(v) => setAddForm({ ...addForm, payment_type: v })}>
                <SelectTrigger data-testid="add-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MANUAL_TYPES.map((t) => {
                    const pt = PAYMENT_TYPES.find((p) => p.id === t);
                    return <SelectItem key={t} value={t}>{pt?.label || t}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment Date</Label>
                <Input type="date" value={addForm.payment_date} onChange={(e) => setAddForm({ ...addForm, payment_date: e.target.value })} data-testid="add-date" />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} data-testid="add-amount" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment Mode</Label>
                <Select value={addForm.payment_mode} onValueChange={(v) => setAddForm({ ...addForm, payment_mode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reference Number</Label>
                <Input value={addForm.payment_reference} onChange={(e) => setAddForm({ ...addForm, payment_reference: e.target.value })} placeholder="UTR / Cheque No." data-testid="add-ref" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} data-testid="add-desc" />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea rows={2} value={addForm.remarks} onChange={(e) => setAddForm({ ...addForm, remarks: e.target.value })} data-testid="add-remarks" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={submitAdd} disabled={addBusy || !addForm.amount} data-testid="btn-submit-add">
              {addBusy ? "Saving…" : "Save Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

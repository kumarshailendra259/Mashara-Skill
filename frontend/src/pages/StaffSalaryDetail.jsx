import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  ArrowLeft, Download, User, Wallet, ClipboardCheck, TrendingUp,
  TrendingDown, Calendar, Building2, Landmark, Edit2, FileText,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const EARN_FIELDS = [
  { k: "basic", label: "Basic Pay" },
  { k: "hra", label: "HRA" },
  { k: "da", label: "DA" },
  { k: "conveyance", label: "Conveyance" },
  { k: "bonus", label: "Bonus" },
  { k: "incentive", label: "Incentive" },
  { k: "overtime_pay", label: "Overtime Pay" },
  { k: "other_earnings", label: "Other Earnings" },
  { k: "reimbursements_paid", label: "Reimbursements Paid" },
];
const DED_FIELDS = [
  { k: "pf_deduction", label: "PF" },
  { k: "esi_deduction", label: "ESI" },
  { k: "late_deduction", label: "Late Fine" },
  { k: "early_fine", label: "Early Fine" },
  { k: "advance", label: "Advance Recovery" },
  { k: "loan_deduction", label: "Loan EMI" },
];

export default function StaffSalaryDetail() {
  const { sid } = useParams();
  const nav = useNavigate();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [attEditRow, setAttEditRow] = useState(null);
  const [editForm, setEditForm] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get(`/payroll/staff/${sid}/summary`, { params: { month, year } });
      setData(d);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [sid, month, year]);

  useEffect(() => { load(); }, [load]);

  const openEdit = () => {
    const pr = data?.current?.payroll || {};
    setEditForm({
      basic: pr.basic ?? "", hra: pr.hra ?? "", da: pr.da ?? "",
      conveyance: pr.conveyance ?? "", bonus: pr.bonus ?? "", incentive: pr.incentive ?? "",
      overtime_pay: pr.overtime_pay ?? "", other_earnings: pr.other_earnings ?? "",
      reimbursements_paid: pr.reimbursements_paid ?? "",
      pf_deduction: pr.pf_deduction ?? "", esi_deduction: pr.esi_deduction ?? "",
      late_deduction: pr.late_deduction ?? "", early_fine: pr.early_fine ?? "",
      advance: pr.advance ?? "", loan_deduction: pr.loan_deduction ?? "",
      remarks: pr.remarks ?? "",
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const pr = data?.current?.payroll;
    if (!pr?.id) return;
    try {
      const payload = Object.fromEntries(
        Object.entries(editForm).map(([k, v]) => [k, v === "" || v == null ? null : (k === "remarks" ? v : Number(v))]),
      );
      await api.patch(`/payroll/${pr.id}`, payload);
      toast.success("Payroll updated");
      setEditOpen(false);
      await load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const runPayroll = async () => {
    try {
      await api.post("/payroll/run", null, { params: { month, year } });
      toast.success("Payroll draft generated");
      await load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const markPaid = async (paidVia = "bank") => {
    const pr = data?.current?.payroll;
    if (!pr?.id) return;
    try {
      await api.patch(`/payroll/${pr.id}/pay`, null, { params: { paid_via: paidVia } });
      toast.success("Marked as paid");
      await load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const saveAttendanceEdit = async () => {
    if (!attEditRow) return;
    try {
      await api.patch(`/attendance/${attEditRow.id}`, {
        status: attEditRow.status,
        check_in_at: attEditRow.check_in_at || null,
        check_out_at: attEditRow.check_out_at || null,
        remarks: attEditRow.remarks || null,
      });
      toast.success("Attendance updated");
      setAttEditRow(null);
      await load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const downloadReport = async (kind) => {
    try {
      const url = kind === "attendance"
        ? `/reports/attendance?month=${month}&year=${year}&staff_id=${sid}`
        : kind === "payroll"
          ? `/reports/payroll?month=${month}&year=${year}&staff_id=${sid}`
          : `/reports/consolidated?month=${month}&year=${year}&staff_id=${sid}`;
      const res = await api.get(url, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${kind}_${data?.staff?.name || "staff"}_${year}-${String(month).padStart(2, "0")}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast.error(formatError(e)); }
  };

  if (loading || !data) return <div className="p-8 text-center text-sm text-[var(--muted)]">Loading salary detail…</div>;

  const s = data.staff || {};
  const pr = data.current?.payroll;
  const att = data.current?.attendance || {};
  const totalPayable = pr?.gross || 0;
  const totalDed = pr?.deductions || 0;
  const netSalary = pr?.net || 0;
  const paidAmount = pr?.status === "paid" ? netSalary : 0;
  const pending = Math.max(0, netSalary - paidAmount);

  return (
    <div className="space-y-4" data-testid="staff-salary-detail">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => nav(-1)} className="rounded-none" data-testid="back-btn">
            <ArrowLeft size={14} className="mr-1" /> Back
          </Button>
          <div>
            <div className="overline">Salary Detail</div>
            <h1 className="font-heading font-black text-2xl md:text-3xl tracking-tight">{s.name || "—"}</h1>
            <div className="text-sm text-[var(--muted)]">{s.designation || "—"} · {s.employee_code || "No Emp Code"}</div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[110px] rounded-none" data-testid="month-select"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[100px] rounded-none" data-testid="year-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Staff meta strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetaCard icon={<Wallet size={14} />} label="CTC (Monthly)" value={inr(s.monthly_salary)} />
        <MetaCard icon={<Calendar size={14} />} label="Joining Date" value={s.joining_date || "—"} />
        <MetaCard icon={<Building2 size={14} />} label="Center" value={s.center_name || s.center_id || "—"} />
        <MetaCard icon={<Landmark size={14} />} label="Bank" value={s.bank_name || "—"} sub={s.bank_account_no_masked || "—"} />
      </div>

      {/* Top-line summary — SalaryBox style */}
      <div className="swiss-card p-5" data-testid="summary-card">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="overline">Salary of {MONTHS[month - 1]} {year}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl md:text-4xl font-heading font-black text-[var(--brand)]">{inr(netSalary)}</span>
              <span className="text-xs uppercase font-bold px-2 py-0.5 tracking-wider bg-amber-100 text-amber-700">
                {pr?.status || "Not run yet"}
              </span>
            </div>
            <div className="text-xs text-[var(--muted)] mt-1">
              Payables: <b>{inr(totalPayable)}</b> · Deductions: <b>{inr(totalDed)}</b> · Paid: <b>{inr(paidAmount)}</b> · Pending: <b className="text-red-600">{inr(pending)}</b>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!pr && (
              <Button onClick={runPayroll} className="brand-btn rounded-none" data-testid="run-payroll-btn">
                Finalize Now (Generate Draft)
              </Button>
            )}
            {pr && pr.status !== "paid" && (
              <>
                <Button variant="outline" onClick={openEdit} className="rounded-none" data-testid="edit-payroll-btn">
                  <Edit2 size={14} className="mr-1" /> Edit Components
                </Button>
                <Button onClick={() => markPaid("bank")} className="brand-btn rounded-none" data-testid="pay-salary-btn">
                  <Wallet size={14} className="mr-1" /> Pay Salary
                </Button>
              </>
            )}
            {pr && (
              <Button variant="outline" onClick={() => downloadReport("payroll")} className="rounded-none" data-testid="download-slip-btn">
                <FileText size={14} className="mr-1" /> Salary Slip (Coming in Phase B)
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Attendance breakdown + Earnings / Deductions grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="swiss-card p-4 md:col-span-1" data-testid="attendance-card">
          <div className="flex items-center justify-between">
            <div className="font-heading font-bold flex items-center gap-1.5"><ClipboardCheck size={14} /> Attendance</div>
            <div className="text-[10px] text-[var(--muted)]">{MONTHS[month - 1]} {year}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
            <MiniStat label="Present" value={att.present} accent="text-green-700" />
            <MiniStat label="Half Day" value={att.half} accent="text-amber-700" />
            <MiniStat label="Absent" value={att.absent} accent="text-red-700" />
            <MiniStat label="Leave" value={att.leave} accent="text-blue-700" />
            <MiniStat label="Working Days" value={att.working_days} />
            <MiniStat label="Marked" value={att.days_marked} />
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <button
              onClick={() => downloadReport("attendance")}
              className="text-xs font-medium text-[var(--brand)] hover:underline flex items-center gap-1"
              data-testid="download-att-btn"
            >
              <Download size={12} /> Download attendance CSV
            </button>
          </div>
        </div>

        <div className="swiss-card p-4 md:col-span-1" data-testid="earnings-card">
          <div className="font-heading font-bold flex items-center gap-1.5 mb-3"><TrendingUp size={14} className="text-green-600" /> Earnings</div>
          {EARN_FIELDS.map((f) => (
            <RowKV key={f.k} label={f.label} value={inr(pr?.[f.k] || 0)} />
          ))}
          <div className="flex justify-between border-t border-[var(--border)] pt-2 mt-2 font-bold">
            <span>Gross Payable</span><span className="text-green-700">{inr(totalPayable)}</span>
          </div>
        </div>

        <div className="swiss-card p-4 md:col-span-1" data-testid="deductions-card">
          <div className="font-heading font-bold flex items-center gap-1.5 mb-3"><TrendingDown size={14} className="text-red-600" /> Deductions</div>
          {DED_FIELDS.map((f) => (
            <RowKV key={f.k} label={f.label} value={inr(pr?.[f.k] || 0)} />
          ))}
          <div className="flex justify-between border-t border-[var(--border)] pt-2 mt-2 font-bold">
            <span>Total Deductions</span><span className="text-red-700">{inr(totalDed)}</span>
          </div>
        </div>
      </div>

      {/* Download strip */}
      <div className="swiss-card p-4 flex items-center justify-between flex-wrap gap-2" data-testid="download-strip">
        <div>
          <div className="font-heading font-bold text-sm">Reports for {MONTHS[month - 1]} {year}</div>
          <div className="text-xs text-[var(--muted)]">Includes attendance, payroll and consolidated views.</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => downloadReport("attendance")} className="rounded-none" data-testid="download-attendance">
            <Download size={12} className="mr-1" /> Attendance
          </Button>
          <Button variant="outline" onClick={() => downloadReport("payroll")} className="rounded-none" data-testid="download-payroll">
            <Download size={12} className="mr-1" /> Payroll
          </Button>
          <Button variant="outline" onClick={() => downloadReport("consolidated")} className="rounded-none" data-testid="download-consolidated">
            <Download size={12} className="mr-1" /> Consolidated
          </Button>
        </div>
      </div>

      {/* Monthly attendance rows — editable */}
      {(data.current?.attendance_rows || []).length > 0 && (
        <div className="swiss-card p-4" data-testid="attendance-rows">
          <div className="font-heading font-bold text-sm mb-2">Attendance rows this month (HR editable)</div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Punch In</TableHead>
                  <TableHead>Punch Out</TableHead>
                  <TableHead>Marked Via</TableHead>
                  <TableHead className="w-[80px]">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.current?.attendance_rows || []).map((r) => (
                  <TableRow key={r.id} data-testid={`att-row-${r.id}`}>
                    <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                    <TableCell><StatusBadge s={r.status} /></TableCell>
                    <TableCell className="whitespace-nowrap num">{fmtTime(r.check_in_at)}</TableCell>
                    <TableCell className="whitespace-nowrap num">{fmtTime(r.check_out_at)}</TableCell>
                    <TableCell><span className="text-[10px] uppercase text-[var(--muted)]">{r.marked_via || "-"}</span></TableCell>
                    <TableCell>
                      <button
                        className="text-[var(--brand)] hover:underline text-xs"
                        onClick={() => setAttEditRow({ ...r })}
                        data-testid={`edit-att-${r.id}`}
                      >Edit</button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Salary history */}
      <div className="swiss-card p-4" data-testid="salary-history">
        <div className="flex items-center justify-between mb-2">
          <div className="font-heading font-bold text-sm">Salary History</div>
          <Button variant="outline" size="sm" onClick={() => downloadReport("consolidated")} className="rounded-none" data-testid="download-history">
            <Download size={12} className="mr-1" /> Download Report
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>CTC</TableHead>
                <TableHead>Payables</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Net Salary</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Pending</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Slip</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.history.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-xs text-[var(--muted)]">No history yet</TableCell></TableRow>
              )}
              {data.history.map((h) => (
                <TableRow key={`${h.year}-${h.month}`} data-testid={`hist-${h.year}-${h.month}`}>
                  <TableCell className="font-medium whitespace-nowrap">{MONTHS[h.month - 1]} {h.year}</TableCell>
                  <TableCell className="num">{inr(h.ctc)}</TableCell>
                  <TableCell className="num">{inr(h.payables)}</TableCell>
                  <TableCell className="num text-red-600">-{inr(h.deductions)}</TableCell>
                  <TableCell className="num font-bold">{inr(h.total_salary)}</TableCell>
                  <TableCell className="num text-green-700">{inr(h.paid)}</TableCell>
                  <TableCell className="num text-red-700">{inr(h.pending)}</TableCell>
                  <TableCell><StatusBadge s={h.status} /></TableCell>
                  <TableCell>{h.slip_shared ? <span className="text-[10px] text-green-700 font-bold">SHARED</span> : <span className="text-[10px] text-[var(--muted)]">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Edit Payroll modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl rounded-none" data-testid="edit-payroll-modal">
          <DialogHeader>
            <DialogTitle>Edit payroll components — {MONTHS[month - 1]} {year}</DialogTitle>
            <DialogDescription>Net salary auto-recalculates from earnings − deductions.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
            {[...EARN_FIELDS, ...DED_FIELDS].map((f) => (
              <div key={f.k}>
                <Label className="overline">{f.label}</Label>
                <Input
                  type="number"
                  value={editForm[f.k] ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, [f.k]: e.target.value })}
                  className="rounded-none"
                  data-testid={`payroll-${f.k}`}
                />
              </div>
            ))}
            <div className="col-span-full">
              <Label className="overline">Remarks</Label>
              <Input
                value={editForm.remarks ?? ""}
                onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                className="rounded-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={saveEdit} className="brand-btn rounded-none" data-testid="save-payroll-btn">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attendance row edit modal */}
      <Dialog open={!!attEditRow} onOpenChange={(o) => !o && setAttEditRow(null)}>
        <DialogContent className="rounded-none max-w-md" data-testid="edit-att-modal">
          <DialogHeader>
            <DialogTitle>Edit attendance · {attEditRow?.date}</DialogTitle>
            <DialogDescription>HR override — persists with audit trail.</DialogDescription>
          </DialogHeader>
          {attEditRow && (
            <div className="space-y-3">
              <div>
                <Label className="overline">Status</Label>
                <Select value={attEditRow.status} onValueChange={(v) => setAttEditRow({ ...attEditRow, status: v })}>
                  <SelectTrigger className="rounded-none" data-testid="att-edit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">Present</SelectItem>
                    <SelectItem value="half">Half Day</SelectItem>
                    <SelectItem value="absent">Absent</SelectItem>
                    <SelectItem value="leave">Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="overline">Punch In (ISO)</Label>
                <Input
                  type="datetime-local"
                  value={isoToLocal(attEditRow.check_in_at)}
                  onChange={(e) => setAttEditRow({ ...attEditRow, check_in_at: localToIso(e.target.value) })}
                  className="rounded-none"
                  data-testid="att-edit-in"
                />
              </div>
              <div>
                <Label className="overline">Punch Out (ISO)</Label>
                <Input
                  type="datetime-local"
                  value={isoToLocal(attEditRow.check_out_at)}
                  onChange={(e) => setAttEditRow({ ...attEditRow, check_out_at: localToIso(e.target.value) })}
                  className="rounded-none"
                  data-testid="att-edit-out"
                />
              </div>
              <div>
                <Label className="overline">Remarks</Label>
                <Input
                  value={attEditRow.remarks || ""}
                  onChange={(e) => setAttEditRow({ ...attEditRow, remarks: e.target.value })}
                  className="rounded-none"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttEditRow(null)} className="rounded-none">Cancel</Button>
            <Button onClick={saveAttendanceEdit} className="brand-btn rounded-none" data-testid="save-att-btn">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetaCard({ icon, label, value, sub }) {
  return (
    <div className="swiss-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">{icon}{label}</div>
      <div className="font-heading font-bold text-sm mt-1 truncate">{value}</div>
      {sub && <div className="text-[10px] text-[var(--muted)] mt-0.5 num truncate">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, accent = "" }) {
  return (
    <div className="border border-[var(--border)] p-2">
      <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">{label}</div>
      <div className={`font-heading font-black text-lg ${accent}`}>{value ?? 0}</div>
    </div>
  );
}

function RowKV({ label, value }) {
  return (
    <div className="flex justify-between text-xs py-1 border-b border-[var(--border)] last:border-b-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-medium num">{value}</span>
    </div>
  );
}

function StatusBadge({ s }) {
  if (!s) return <span className="text-[10px] text-[var(--muted)]">—</span>;
  const map = {
    paid: "bg-green-100 text-green-700",
    draft: "bg-amber-100 text-amber-700",
    approved: "bg-blue-100 text-blue-700",
    rejected: "bg-red-100 text-red-700",
    present: "bg-green-100 text-green-700",
    half: "bg-amber-100 text-amber-700",
    absent: "bg-red-100 text-red-700",
    leave: "bg-blue-100 text-blue-700",
  };
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 ${map[s] || "bg-gray-100 text-gray-600"}`}>{s}</span>;
}

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function isoToLocal(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}
function localToIso(local) {
  if (!local) return "";
  try { return new Date(local).toISOString(); } catch { return ""; }
}

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LangContext";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Check, X, CalendarCheck, CalendarDays, Upload, Trash2, Paperclip, Pencil, Download, FileText, GitMerge, Archive, Mail, FileDown, User, Receipt, Hash, KeyRound, ShieldCheck, ShieldAlert, Users, Clock, Wallet, TrendingUp, Eye, RefreshCw, MoreVertical, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Calendar, Circle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import ApprovalTimelineModal from "@/components/ApprovalTimelineModal";
import PrintButton from "@/components/PrintButton";
import BulkDeleteDialog from "@/components/BulkDeleteDialog";

const STEPS = ["submitted", "l1_approved", "accountant_approved", "paid"];

function Stepper({ status }) {
  const idx = status === "rejected" ? -1 : STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const done = idx >= i;
        const isReject = status === "rejected";
        const color = isReject ? "bg-[var(--danger)]" : done ? "bg-[var(--success)]" : "bg-gray-300";
        return (
          <React.Fragment key={s}>
            <div className={`w-2.5 h-2.5 ${color}`} title={s} />
            {i < STEPS.length - 1 && <div className={`h-px w-4 ${done && !isReject ? "bg-[var(--success)]" : "bg-gray-300"}`} />}
          </React.Fragment>
        );
      })}
      <span className="ml-2 overline">{status}</span>
    </div>
  );
}

/**
 * Today's attendance status chip — color-coded per user request:
 *   present → green
 *   absent  → red
 *   leave   → blue
 *   half    → yellow (rest of the day still available)
 *   null    → light grey "—" (not marked yet)
 */
function StaffTodayChip({ status }) {
  const map = {
    present: { label: "Present", cls: "bg-emerald-50 text-emerald-700 border-emerald-300" },
    absent:  { label: "Absent",  cls: "bg-red-50 text-red-700 border-red-300" },
    leave:   { label: "On Leave", cls: "bg-blue-50 text-blue-700 border-blue-300" },
    half:    { label: "Half-day",  cls: "bg-amber-50 text-amber-700 border-amber-300" },
  };
  const m = map[status];
  if (!m) return <span className="text-xs text-[var(--muted)]">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase border rounded-none ${m.cls}`}
      data-testid={`today-chip-${status}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${status === "present" ? "bg-emerald-500" : status === "absent" ? "bg-red-500" : status === "leave" ? "bg-blue-500" : "bg-amber-500"}`} />
      {m.label}
    </span>
  );
}

export default function HRMS() {
  const { t } = useLang();
  const { user } = useAuth();
  const nav = useNavigate();
  const isAdmin = user?.role === "admin";
  const isAccountant = user?.role === "accountant";

  const [staff, setStaff] = useState([]);
  const [reimbs, setReimbs] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [centers, setCenters] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [openS, setOpenS] = useState(false);
  const emptyStaffForm = {
    name: "", designation: "", reports_to_id: "",
    monthly_salary: 0, per_day_rate: 0, joining_date: "",
    exit_date: "",  // last working day, blank = still active
    user_id: "", email: "", mobile: "",
    center_id: "", shift_id: "",
    date_of_birth: "", gender: "", address: "",
    pan: "", aadhaar_last4: "",
    emergency_contact_name: "", emergency_contact_mobile: "",
    bank_account_no: "", bank_name: "", ifsc: "", account_holder_name: "",
    create_login: false,
    send_offer_letter: true,
  };
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [editingStaffId, setEditingStaffId] = useState(null);

  const [openR, setOpenR] = useState(false);
  const [rForm, setRForm] = useState({ staff_id: "", amount: "", date: new Date().toISOString().slice(0,10), category: "", description: "", attachments: [] });
  const reimbFileRef = useRef(null);
  const [reimbUploading, setReimbUploading] = useState(false);
  // Reimbursement templates (HR-managed manual forms) + attachments viewer
  const [reimbTemplates, setReimbTemplates] = useState([]);
  const [openTplUpload, setOpenTplUpload] = useState(false);
  const [tplForm, setTplForm] = useState({ name: "", description: "", category: "", file: null });
  const [tplUploading, setTplUploading] = useState(false);
  const tplFileRef = useRef(null);
  const [viewAttachments, setViewAttachments] = useState(null); // reimbursement row or null
  const isHR = user?.role === "hr";
  const canManageTemplates = isAdmin || isHR;

  const [pMonth, setPMonth] = useState(new Date().getMonth() + 1);
  const [pYear, setPYear] = useState(new Date().getFullYear());

  // Approval timeline modal state
  const [trackTimeline, setTrackTimeline] = useState({ type: null, id: null });

  // Download payroll bank CSV
  const downloadBankCsv = async (m, y) => {
    try {
      const apiBase = process.env.REACT_APP_BACKEND_URL;
      const res = await fetch(`${apiBase}/api/payroll/bank-csv?month=${m}&year=${y}&status=draft`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `payroll_bank_${y}_${String(m).padStart(2,"0")}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const written = res.headers.get("X-Rows-Written") || "?";
      const skipped = res.headers.get("X-Rows-Skipped") || "?";
      toast.success(`CSV downloaded · ${written} rows (${skipped} skipped — no bank or zero net)`);
    } catch (e) { toast.error(`Download failed: ${e.message}`); }
  };

  // ---- Salary Slip actions (Phase B) ----
  const generateSlip = async (pid) => {
    try {
      await api.post(`/payroll/${pid}/generate-slip`);
      toast.success("Salary slip generated");
      await loadPayroll();
    } catch (e) { toast.error(formatError(e)); }
  };
  const downloadSlip = async (pid, filename) => {
    try {
      const res = await api.get(`/payroll/${pid}/slip/download`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url; a.download = filename || `salary_slip_${pid}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatError(e)); }
  };
  const releaseSlip = async (pid, released) => {
    try {
      await api.patch(`/payroll/${pid}/release-slip`, null, { params: { released } });
      toast.success(released ? "Slip released — visible to employee" : "Slip un-released");
      await loadPayroll();
    } catch (e) { toast.error(formatError(e)); }
  };

  // ---- Comprehensive HR reports (Phase A) ----
  //  attendance   : per-day punch-in/out matrix
  //  payroll      : full earnings + deductions + bank per staff
  //  consolidated : one row per staff (attendance summary + payroll + bank)
  const downloadHRReport = async (kind, m, y) => {
    try {
      const res = await api.get(`/reports/${kind}`, {
        params: { month: m, year: y },
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${kind}_${y}_${String(m).padStart(2, "0")}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${kind.charAt(0).toUpperCase() + kind.slice(1)} report downloaded`);
    } catch (e) { toast.error(formatError(e)); }
  };

  // Print/download single payslip via browser
  const printPayslip = (p) => {
    const staffRow = staff.find((s) => s.id === p.staff_id) || {};
    const monthName = new Date(p.year, p.month - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const w = window.open("", "_blank");
    if (!w) { toast.error("Popup blocked — allow popups to print payslip"); return; }
    const earn = [
      ["Basic", p.basic], ["HRA", p.hra], ["DA", p.da], ["Conveyance", p.conveyance], ["Bonus", p.bonus], ["Incentive", p.incentive],
    ].filter(([, v]) => v && v > 0);
    const ded = [
      ["PF", p.pf_deduction], ["ESI", p.esi_deduction], ["Late Penalty", p.late_deduction],
      ...((p.other_deductions || []).map((li) => [li.label, li.amount])),
    ].filter(([, v]) => v && v > 0);
    const rows = (arr) => arr.map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${k}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums">${inr(v)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Payslip — ${p.staff_name} — ${monthName}</title>
      <style>
        body{font-family:Helvetica,Arial,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}
        h1{font-size:22px;margin:0 0 4px;letter-spacing:0.5px}
        .meta{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:24px}
        h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:8px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        .total{font-weight:700;font-size:15px;border-top:2px solid #111;padding-top:8px}
        .net{font-size:24px;font-weight:900;margin-top:24px;padding:16px;background:#f0f9f3;border-left:4px solid #16a34a}
        @media print{body{margin:0}}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          <div class="meta">Mashara Skills · Payslip</div>
          <h1>${p.staff_name || ""}</h1>
          <div style="font-size:12px;color:#444;margin-top:4px">${staffRow.designation || ""} · A/C ${staffRow.bank_account_no ? "****" + staffRow.bank_account_no.slice(-4) : "—"}</div>
        </div>
        <div style="text-align:right">
          <div class="meta">Period</div>
          <div style="font-size:18px;font-weight:700">${monthName}</div>
          <div style="font-size:11px;color:#666;margin-top:2px">${p.days_present || 0} days present${p.late_days ? ` · ${p.late_days} late day(s)` : ""}</div>
        </div>
      </div>
      <div class="grid">
        <div><h3>Earnings</h3><table>${rows(earn) || '<tr><td colspan="2" style="padding:6px 10px;color:#999">—</td></tr>'}
        <tr class="total"><td style="padding:8px 10px">Gross</td><td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums">${inr(p.gross || 0)}</td></tr></table></div>
        <div><h3>Deductions</h3><table>${rows(ded) || '<tr><td colspan="2" style="padding:6px 10px;color:#999">—</td></tr>'}
        <tr class="total"><td style="padding:8px 10px">Total Deductions</td><td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums">${inr(p.deductions || 0)}</td></tr></table></div>
      </div>
      <div class="net">Net Pay: <span style="float:right;font-variant-numeric:tabular-nums">${inr(p.net || 0)}</span></div>
      ${p.remarks ? `<div style="margin-top:16px;font-size:12px;color:#555">Remarks: ${p.remarks}</div>` : ""}
      <div style="margin-top:48px;font-size:10px;color:#999;text-align:center">Generated on ${new Date().toLocaleString("en-IN")} · This is a system-generated payslip; no signature required.</div>
      <script>window.onload = () => { window.print(); }</script>
      </body></html>`);
    w.document.close();
  };

  // Payroll edit dialog state
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [editingPayroll, setEditingPayroll] = useState(null);
  const emptyPayrollForm = {
    days_present: 0, basic: 0, hra: 0, da: 0, conveyance: 0, bonus: 0, incentive: 0,
    pf_deduction: 0, esi_deduction: 0, late_deduction: 0, other_deductions: [], remarks: "",
  };
  const [payrollForm, setPayrollForm] = useState(emptyPayrollForm);

  const openEditPayroll = (p) => {
    setEditingPayroll(p);
    setPayrollForm({
      days_present: p.days_present || 0,
      basic: p.basic || 0,
      hra: p.hra || 0,
      da: p.da || 0,
      conveyance: p.conveyance || 0,
      bonus: p.bonus || 0,
      incentive: p.incentive || 0,
      pf_deduction: p.pf_deduction || 0,
      esi_deduction: p.esi_deduction || 0,
      late_deduction: p.late_deduction || 0,
      other_deductions: (p.other_deductions || []).map((li) => ({ ...li })),
      remarks: p.remarks || "",
    });
    setPayrollOpen(true);
  };

  const savePayroll = async () => {
    if (!editingPayroll) return;
    try {
      const payload = {
        days_present: +payrollForm.days_present || 0,
        basic: +payrollForm.basic || 0,
        hra: +payrollForm.hra || 0,
        da: +payrollForm.da || 0,
        conveyance: +payrollForm.conveyance || 0,
        bonus: +payrollForm.bonus || 0,
        incentive: +payrollForm.incentive || 0,
        pf_deduction: +payrollForm.pf_deduction || 0,
        esi_deduction: +payrollForm.esi_deduction || 0,
        late_deduction: +payrollForm.late_deduction || 0,
        other_deductions: (payrollForm.other_deductions || []).map((li) => ({ label: li.label || "", amount: +li.amount || 0 })),
        remarks: payrollForm.remarks || null,
      };
      await api.patch(`/payroll/${editingPayroll.id}`, payload);
      setPayrollOpen(false);
      setEditingPayroll(null);
      loadAll();
      toast.success("Payslip updated");
    } catch (e) { toast.error(formatError(e)); }
  };

  // Attendance state
  const [attDate, setAttDate] = useState(new Date().toISOString().slice(0,10));
  const [attMap, setAttMap] = useState({}); // staff_id -> status
  // Phase 37 — paid-off info for current date (weekly-off + holiday)
  const [dayPaidOff, setDayPaidOff] = useState({ isWeeklyOff: false, isHoliday: false });
  const [attRecent, setAttRecent] = useState([]);

  // Calendar view state
  const [calStaffId, setCalStaffId] = useState("");
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMap, setCalMap] = useState({}); // 'YYYY-MM-DD' -> status

  // Leaves state
  const [openL, setOpenL] = useState(false);
  const [lForm, setLForm] = useState({ staff_id: "", start_date: new Date().toISOString().slice(0,10), end_date: new Date().toISOString().slice(0,10), reason: "", leave_type_id: "" });
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [myBalances, setMyBalances] = useState([]);

  // Server-side search + pagination for the heavy tabs. Keeps HRMS snappy
  // even with 500+ staff / thousands of payroll rows.
  const PAGE = 25;
  const [staffQ, setStaffQ] = useState("");
  const [staffPage, setStaffPage] = useState(0);
  const [staffTotal, setStaffTotal] = useState(0);
  const [payrollQ, setPayrollQ] = useState("");
  const [payrollStatus, setPayrollStatus] = useState("all");
  const [payrollPage, setPayrollPage] = useState(0);
  const [payrollTotal, setPayrollTotal] = useState(0);
  // Phase 50 — Hide zero-attendance staff by default so HR sees only rows
  // that need real payroll action. Toggle-off reveals them for audit.
  const [hideZero, setHideZero] = useState(true);

  const canMarkAttendance = isAdmin || user?.role === "manager" || user?.role === "center_manager";

  const loadStaff = useCallback(async () => {
    try {
      const res = await api.get("/staff", { params: { q: staffQ || undefined, skip: staffPage * PAGE, limit: PAGE } });
      setStaff(res.data || []);
      const total = res.headers?.["x-total-count"];
      if (total != null) setStaffTotal(Number(total));
    } catch { /* silent */ }
  }, [staffQ, staffPage]);

  const loadPayroll = useCallback(async () => {
    try {
      const params = { skip: payrollPage * PAGE, limit: PAGE };
      if (payrollQ) params.q = payrollQ;
      if (payrollStatus && payrollStatus !== "all") params.status = payrollStatus;
      const res = await api.get("/payroll", { params });
      setPayroll(res.data || []);
      const total = res.headers?.["x-total-count"];
      if (total != null) setPayrollTotal(Number(total));
    } catch { /* silent */ }
  }, [payrollQ, payrollPage, payrollStatus]);

  const loadAll = () => Promise.all([
    loadStaff(),
    api.get("/reimbursements"),
    loadPayroll(),
    api.get("/leaves"),
    api.get("/entities/center"),
    api.get("/shifts").catch(() => ({ data: [] })),
    api.get("/leave-types").catch(() => ({ data: [] })),
    api.get("/reimbursement-templates").catch(() => ({ data: [] })),
  ]).then(([, r, , lv, c, sh, lt, tpl]) => {
    setReimbs(r.data); setLeaves(lv.data);
    setCenters(c.data); setShifts(sh.data); setLeaveTypes(lt.data);
    setReimbTemplates(tpl.data || []);
  });

  useEffect(() => { loadAll(); }, []);
  // Reload on filter/pagination change (debounced by simple state update).
  useEffect(() => { loadStaff(); }, [loadStaff]);
  useEffect(() => { loadPayroll(); }, [loadPayroll]);

  // Load attendance for selected date
  useEffect(() => {
    if (!attDate) return;
    api.get(`/attendance?start=${attDate}&end=${attDate}`).then((res) => {
      const m = {};
      (res.data || []).forEach((a) => { m[a.staff_id] = a.status; });
      setAttMap(m);
    }).catch(() => {});
    // Phase 37 — figure out if this date is a Weekly Off / Holiday
    api.get(`/attendance/paid-off-days?start=${attDate}&end=${attDate}`).then((res) => {
      const d = res.data || {};
      const wd = new Date(attDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      setDayPaidOff({
        isHoliday: (d.paid_off_dates || []).includes(attDate),
        isWeeklyOff: (d.weekly_off_weekdays || []).includes(wd),
      });
    }).catch(() => setDayPaidOff({ isWeeklyOff: false, isHoliday: false }));
    // Recent attendance (last 30 days)
    const end = attDate;
    const startDt = new Date(attDate); startDt.setDate(startDt.getDate() - 29);
    const start = startDt.toISOString().slice(0,10);
    api.get(`/attendance?start=${start}&end=${end}`).then((res) => setAttRecent(res.data || [])).catch(() => {});
  }, [attDate]);

  const setAtt = (staffId, status) => setAttMap((m) => ({ ...m, [staffId]: status }));

  const saveAttendance = async () => {
    try {
      const entries = Object.entries(attMap).filter(([, v]) => !!v);
      if (entries.length === 0) { toast.error("Mark at least one staff"); return; }
      await Promise.all(entries.map(([sid, status]) =>
        api.post("/attendance", { staff_id: sid, date: attDate, status })
      ));
      toast.success(`Saved ${entries.length} entries`);
      // refresh recent
      const end = attDate;
      const startDt = new Date(attDate); startDt.setDate(startDt.getDate() - 29);
      const start = startDt.toISOString().slice(0,10);
      const res = await api.get(`/attendance?start=${start}&end=${end}`);
      setAttRecent(res.data || []);
    } catch (e) { toast.error(formatError(e)); }
  };

  const markAll = (status) => {
    const m = {};
    staff.forEach((s) => { m[s.id] = status; });
    setAttMap(m);
  };

  // Calendar view: fetch attendance for the selected staff/month
  useEffect(() => {
    if (!calStaffId) { setCalMap({}); return; }
    const mm = String(calMonth).padStart(2, "0");
    const start = `${calYear}-${mm}-01`;
    const lastDay = new Date(calYear, calMonth, 0).getDate();
    const end = `${calYear}-${mm}-${String(lastDay).padStart(2,"0")}`;
    api.get(`/attendance?staff_id=${calStaffId}&start=${start}&end=${end}`)
      .then((res) => {
        const m = {};
        (res.data || []).forEach((a) => { m[a.date] = a.status; });
        setCalMap(m);
      }).catch(() => setCalMap({}));
  }, [calStaffId, calMonth, calYear]);

  // Click a calendar day to cycle status: empty → present → absent → half → leave → empty
  const CYCLE = ["present", "absent", "half", "leave"];
  const cycleDay = async (dateStr) => {
    if (!canMarkAttendance || !calStaffId) return;
    const current = calMap[dateStr];
    const nextIdx = current ? (CYCLE.indexOf(current) + 1) % (CYCLE.length + 1) : 0;
    const next = nextIdx < CYCLE.length ? CYCLE[nextIdx] : null;
    try {
      if (next) {
        await api.post("/attendance", { staff_id: calStaffId, date: dateStr, status: next });
        setCalMap((m) => ({ ...m, [dateStr]: next }));
      } else {
        // No DELETE endpoint — set explicit "absent" reset cycle; keep last status when cleared.
        // For now, cycle wraps back to present.
        await api.post("/attendance", { staff_id: calStaffId, date: dateStr, status: "present" });
        setCalMap((m) => ({ ...m, [dateStr]: "present" }));
      }
    } catch (e) { toast.error(formatError(e)); }
  };

  const applyLeave = async () => {
    try {
      if (!lForm.staff_id) { toast.error("Select staff"); return; }
      await api.post("/leaves", lForm);
      setOpenL(false);
      setLForm({ staff_id: "", start_date: new Date().toISOString().slice(0,10), end_date: new Date().toISOString().slice(0,10), reason: "", leave_type_id: "" });
      const lv = await api.get("/leaves");
      setLeaves(lv.data);
      toast.success("Leave applied");
    } catch (e) { toast.error(formatError(e)); }
  };

  const decideLeave = async (lid, decision) => {
    const remarks = window.prompt(`Remarks for ${decision} (mandatory, min 3 chars):`);
    if (!remarks || remarks.trim().length < 3) { toast.error("Remarks required (min 3 chars)"); return; }
    try {
      await api.patch(`/leaves/${lid}?decision=${decision}&remarks=${encodeURIComponent(remarks.trim())}`);
      const lv = await api.get("/leaves");
      setLeaves(lv.data);
      toast.success(decision === "approved" ? "Approved" : "Rejected");
    } catch (e) { toast.error(formatError(e)); }
  };

  const canManageStaff = isAdmin || user?.role === "manager" || user?.role === "hr";
  const canDeleteStaff = isAdmin || user?.role === "hr";
  // Accountant + HR + Admin can *see* full staff details (bank / documents / etc.)
  // in a read-only "View Details" drawer even when they cannot edit the record.
  const canViewStaffFull = isAdmin || isAccountant || user?.role === "hr" || user?.role === "manager";
  const [viewStaffId, setViewStaffId] = useState(null);

  // Bulk archive staff (admin only)
  const [selectedStaff, setSelectedStaff] = useState(new Set());
  const [bulkStaffOpen, setBulkStaffOpen] = useState(false);
  const [bulkStaffBusy, setBulkStaffBusy] = useState(false);
  const staffIds = staff.map((s) => s.id);
  const allStaffSelected = staffIds.length > 0 && staffIds.every((id) => selectedStaff.has(id));
  const toggleStaff = (id) => setSelectedStaff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAllStaff = () => setSelectedStaff(allStaffSelected ? new Set() : new Set(staffIds));
  const bulkArchiveStaff = async () => {
    setBulkStaffBusy(true);
    try {
      const res = await api.post("/staff/bulk-archive", { ids: Array.from(selectedStaff) });
      toast.success(`${res.data?.archived || 0} staff archived`);
      setBulkStaffOpen(false);
      setSelectedStaff(new Set());
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkStaffBusy(false); }
  };

  const openEditStaff = (s) => {
    setEditingStaffId(s.id);
    setStaffForm({
      name: s.name || "",
      designation: s.designation || "",
      reports_to_id: s.reports_to_id || "",
      monthly_salary: s.monthly_salary || 0,
      per_day_rate: s.per_day_rate || 0,
      joining_date: s.joining_date || "",
      exit_date: s.exit_date || "",
      user_id: s.user_id || "",
      email: s.email || "",
      mobile: s.mobile || "",
      center_id: s.center_id || "",
      shift_id: s.shift_id || "",
      date_of_birth: s.date_of_birth || "",
      gender: s.gender || "",
      address: s.address || "",
      pan: s.pan || "",
      aadhaar_last4: s.aadhaar_last4 || "",
      emergency_contact_name: s.emergency_contact_name || "",
      emergency_contact_mobile: s.emergency_contact_mobile || "",
      bank_account_no: s.bank_account_no || "",
      bank_name: s.bank_name || "",
      ifsc: s.ifsc || "",
      account_holder_name: s.account_holder_name || "",
      create_login: false,
      send_offer_letter: true,
    });
    setOpenS(true);
  };

  const openAddStaff = () => {
    setEditingStaffId(null);
    setStaffForm(emptyStaffForm);
    setOpenS(true);
  };

  const runBackfillEmpCodes = async () => {
    try {
      const dry = await api.post("/staff/backfill-employee-codes?dry_run=true");
      const preview = dry.data;
      if (!preview.scanned) {
        toast.success("All staff already have an Emp Code.");
        return;
      }
      if (!window.confirm(
        `${preview.scanned} staff members ke pass Emp Code nahin hai. Assign kar dun (EMP-YYYY-XXXX format)?`
      )) return;
      const real = await api.post("/staff/backfill-employee-codes?dry_run=false");
      toast.success(`Assigned ${real.data.assigned} employee codes`);
      loadAll();
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const handleBulkStaffCsv = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // reset so re-selecting the same file re-triggers
    if (!f) return;
    if (!window.confirm(
      `Import staff from "${f.name}"? Required column: name. ` +
      `Optional: designation, email, mobile, salary, center_id, employee_code. Continue?`
    )) return;
    try {
      const form = new FormData();
      form.append("file", f);
      const r = await api.post("/staff/import", form, { headers: { "Content-Type": "multipart/form-data" } });
      const { created, skipped, errors } = r.data;
      toast.success(`Imported ${created} staff · ${skipped} skipped`);
      if (errors?.length) {
        console.warn("CSV import errors:", errors);
      }
      loadAll();
    } catch (err) {
      toast.error(formatError(err));
    }
  };

  const _triggerDownload = (url, filename) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadStaffTemplate = async () => {
    try {
      const r = await api.get("/staff/template.csv", { responseType: "blob" });
      _triggerDownload(URL.createObjectURL(r.data), "staff_bulk_template.csv");
      toast.success("Template downloaded — fill it and use Bulk Add (CSV)");
    } catch (e) { toast.error(formatError(e)); }
  };

  const downloadStaffExport = async () => {
    try {
      const r = await api.get("/staff/export.csv", { responseType: "blob" });
      const today = new Date().toISOString().slice(0, 10);
      _triggerDownload(URL.createObjectURL(r.data), `staff_export_${today}.csv`);
      toast.success("Staff exported to CSV");
    } catch (e) { toast.error(formatError(e)); }
  };

  const generateLogin = async (s) => {
    const isReset = !!s.user_id;
    if (!s.email) { toast.error("Staff has no email — add one first"); return; }
    if (!window.confirm(
      isReset
        ? `Reset ${s.name}'s login password and email new credentials to ${s.email}?`
        : `Generate a login ID + password for ${s.name} and email it to ${s.email}?`
    )) return;
    try {
      const r = await api.post(`/staff/${s.id}/generate-login`, null, {
        params: { send_email: true, force_reset: isReset },
      });
      const d = r.data;
      if (d.email_sent) {
        toast.success(isReset ? "Password reset + credentials emailed" : "Login created + credentials emailed");
      } else if (d.password) {
        // Fallback: show the password so admin can share manually
        window.prompt(
          `Email delivery failed (${d.email_reason || "unknown"}). Share this password manually with the staff (they can change it after first login):`,
          d.password,
        );
      } else if (d.linked) {
        toast.info(d.note || "Existing account already linked");
      } else {
        toast.success("Login generated");
      }
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  const verifyBank = async (s) => {
    if (!window.confirm(
      `Verify ${s.name}'s bank details?\n\n` +
      `Bank: ${s.bank_name || "—"}\n` +
      `A/C:  ${s.bank_account_no || "—"}\n` +
      `IFSC: ${s.ifsc || "—"}\n\n` +
      `Only click Verify AFTER a penny-drop or physical passbook check.`
    )) return;
    try {
      await api.post(`/staff/${s.id}/verify-bank`);
      toast.success("Bank details verified");
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  const deleteStaff = async (s) => {
    if (!window.confirm(`Delete staff "${s.name}"? This cannot be undone.`)) return;
    try {await api.delete(`/staff/${s.id}`);
      toast.success("Deleted");
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  const sendOfferLetter = async (s) => {
    if (!s.email) { toast.error("Staff has no email — add one first"); return; }
    if (!window.confirm(`Generate & email offer letter to ${s.name} (${s.email})?`)) return;
    try {
      const { data } = await api.post(`/staff/${s.id}/send-offer-letter`);
      if (data?.generated && data?.emailed) toast.success("Offer letter generated + emailed as PDF");
      else if (data?.generated && !data?.emailed) toast.warning(`Generated but email failed: ${data.reason || "unknown"}`);
      else if (data?.reason === "no_template_uploaded") toast.error("No offer letter template — upload one under HR Settings → Offer Letters");
      else toast.error(data?.reason || "Failed to generate offer letter");
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  const saveStaff = async () => {
    try {
      const payload = {
        ...staffForm,
        monthly_salary: +staffForm.monthly_salary || 0,
        per_day_rate: +staffForm.per_day_rate || 0,
        reports_to_id: staffForm.reports_to_id || null,
        user_id: staffForm.user_id || null,
        center_id: staffForm.center_id || null,
        shift_id: staffForm.shift_id || null,
        email: staffForm.email?.trim() || null,
        mobile: staffForm.mobile?.trim() || null,
        date_of_birth: staffForm.date_of_birth || null,
        gender: staffForm.gender || null,
        address: staffForm.address?.trim() || null,
        pan: staffForm.pan?.trim().toUpperCase() || null,
        aadhaar_last4: staffForm.aadhaar_last4?.trim() || null,
        emergency_contact_name: staffForm.emergency_contact_name?.trim() || null,
        emergency_contact_mobile: staffForm.emergency_contact_mobile?.trim() || null,
        bank_account_no: staffForm.bank_account_no?.trim() || null,
        bank_name: staffForm.bank_name?.trim() || null,
        ifsc: staffForm.ifsc?.trim().toUpperCase() || null,
        account_holder_name: staffForm.account_holder_name?.trim() || null,
        create_login: !!staffForm.create_login,
        send_offer_letter: !!staffForm.send_offer_letter,
      };
      if (editingStaffId) {
        await api.put(`/staff/${editingStaffId}`, payload);
        setOpenS(false);
        setEditingStaffId(null);
        setStaffForm(emptyStaffForm);
        loadAll();
        toast.success("Updated");
        return;
      }
      const { data } = await api.post("/staff", payload);
      setOpenS(false);
      setStaffForm(emptyStaffForm);
      loadAll();
      const es = data?.email_status;
      if (payload.create_login) {
        if (es?.sent) toast.success("Staff saved · credentials emailed");
        else if (es?.reason === "resend_not_configured") toast.success("Staff saved · login created (email skipped — RESEND_API_KEY not set)");
        else toast.success("Staff saved · login created" + (es?.reason ? ` (email: ${es.reason})` : ""));
      } else {
        toast.success("Saved");
      }
      // Offer letter feedback
      const ol = data?.offer_letter_status;
      if (ol) {
        if (ol.generated && ol.emailed) toast.success("Offer letter generated + emailed as PDF");
        else if (ol.generated && !ol.emailed) toast.warning(`Offer letter generated but email failed: ${ol.reason || "unknown"}`);
        else if (ol.reason === "no_template_uploaded") toast.info("No offer letter template — upload one under HR Settings → Offer Letters");
        else if (ol.reason && ol.reason !== "staff_has_no_email") toast.warning(`Offer letter skipped: ${ol.reason}`);
      }
    } catch (e) { toast.error(formatError(e)); }
  };

  const submitReimb = async () => {
    try {
      await api.post("/reimbursements", { ...rForm, amount: parseFloat(rForm.amount) });
      setOpenR(false);
      setRForm({ staff_id: "", amount: "", date: new Date().toISOString().slice(0,10), category: "", description: "", attachments: [] });
      loadAll(); toast.success("Submitted");
    } catch (e) { toast.error(formatError(e)); }
  };

  const uploadReimbAttachment = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setReimbUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setRForm((s) => ({ ...s, attachments: [...(s.attachments || []), data] }));
      toast.success("Attached");
    } catch (err) { toast.error(formatError(err)); }
    finally { setReimbUploading(false); e.target.value = ""; }
  };

  const removeReimbAttachment = (id) => setRForm((s) => ({ ...s, attachments: s.attachments.filter((a) => a.id !== id) }));

  // --- Reimbursement Template management (HR / Admin only) ---
  const uploadTemplate = async () => {
    if (!tplForm.name.trim()) { toast.error("Template name is required"); return; }
    if (!tplForm.file) { toast.error("Please choose a file"); return; }
    setTplUploading(true);
    try {
      const fd = new FormData(); fd.append("file", tplForm.file);
      const params = new URLSearchParams({ name: tplForm.name.trim() });
      if (tplForm.description) params.set("description", tplForm.description.trim());
      if (tplForm.category) params.set("category", tplForm.category.trim());
      const { data } = await api.post(`/reimbursement-templates?${params.toString()}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setReimbTemplates((prev) => [data, ...prev]);
      setTplForm({ name: "", description: "", category: "", file: null });
      if (tplFileRef.current) tplFileRef.current.value = "";
      setOpenTplUpload(false);
      toast.success("Template uploaded");
    } catch (e) { toast.error(formatError(e)); }
    finally { setTplUploading(false); }
  };

  const deleteTemplate = async (tid) => {
    if (!window.confirm("Delete this template?")) return;
    try {
      await api.delete(`/reimbursement-templates/${tid}`);
      setReimbTemplates((prev) => prev.filter((t) => t.id !== tid));
      toast.success("Template deleted");
    } catch (e) { toast.error(formatError(e)); }
  };

  const toggleTemplateActive = async (t) => {
    try {
      const { data } = await api.patch(`/reimbursement-templates/${t.id}`, { is_active: !t.is_active });
      setReimbTemplates((prev) => prev.map((x) => (x.id === t.id ? data : x)));
    } catch (e) { toast.error(formatError(e)); }
  };

  const act = async (rid, action) => {
    try {
      if (action === "reject") {
        const reason = window.prompt("Reason:") || "";
        await api.patch(`/reimbursements/${rid}/reject`, { reason });
      } else {
        await api.patch(`/reimbursements/${rid}/${action}`);
      }
      loadAll(); toast.success("Done");
    } catch (e) { toast.error(formatError(e)); }
  };

  const runPayroll = async () => {
    try {
      // Pre-check for existing payroll rows in this month/year.
      const pre = await api.get(`/payroll?month=${pMonth}&year=${pYear}&limit=1`);
      const existingCount = Array.isArray(pre.data) ? pre.data.length : (pre.data?.rows?.length || 0);
      if (existingCount > 0) {
        const ok = window.confirm(
          `Payroll for ${pMonth}/${pYear} already exists. \n\n` +
          `• Draft rows will be recalculated with latest attendance + leaves.\n` +
          `• Approved/Paid rows will remain locked.\n\n` +
          `Continue?`,
        );
        if (!ok) return;
      }
      const r = await api.post(`/payroll/run?month=${pMonth}&year=${pYear}`);
      loadAll();
      const c = r.data.created || 0;
      const u = r.data.updated || 0;
      const l = r.data.skipped_locked || 0;
      const sne = r.data.skipped_not_employed || 0;
      toast.success(`Created ${c}, Updated ${u}${l ? `, Skipped locked ${l}` : ""}${sne ? `, Ineligible ${sne}` : ""}`);
    } catch (e) { toast.error(formatError(e)); }
  };

  const recalcPayroll = async (pid) => {
    try {
      await api.post(`/payroll/${pid}/recalc`);
      loadAll();
      toast.success("Recalculated with latest attendance + leaves");
    } catch (e) { toast.error(formatError(e)); }
  };

  const payPayroll = async (id) => {
    try { await api.patch(`/payroll/${id}/pay`); loadAll(); toast.success("Paid"); }
    catch (e) { toast.error(formatError(e)); }
  };

  // Admin escape hatch — reopen a paid payroll row (reverses txn), then open the
  // regular edit dialog so HR-style fields can be corrected in-place.
  const reopenAndEditPayroll = async (p) => {
    if (!window.confirm(
      `This payroll row is already PAID.\n\nReopening will:\n• Reverse the linked transaction (₹${(p.net || 0).toLocaleString("en-IN")} income offset)\n• Flip status back to Draft\n• If part of a Paid batch, the whole batch is also reopened\n\nContinue?`,
    )) return;
    try {
      await api.patch(`/payroll/${p.id}/reopen`);
      toast.success("Reopened — row is Draft. You can now edit it.");
      await loadAll();
      await loadBatches();
      // Fetch the fresh row so status/txn_id are up-to-date, then open the edit dialog.
      const { data } = await api.get(`/payroll?month=${p.month}&year=${p.year}`);
      const fresh = (data || []).find((x) => x.id === p.id);
      if (fresh) openEditPayroll(fresh);
    } catch (e) { toast.error(formatError(e)); }
  };

  const deletePayrollRow = async (p) => {
    const paidWarn = p.status === "paid"
      ? `\n\n⚠ This row is PAID — deleting will:\n• Reverse the ₹${(p.net || 0).toLocaleString("en-IN")} slice from the linked transaction\n• Cancel the staff_payments entry\n• Update the batch counters`
      : "";
    if (!window.confirm(`Delete payroll row for ${sName(p.staff_id)} · ${p.month}/${p.year}?${paidWarn}\n\nA compliance snapshot is stored in payroll_deletions.\n\nContinue?`)) return;
    try {
      await api.delete(`/payroll/${p.id}`);
      toast.success("Deleted");
      await loadAll();
      await loadBatches();
    } catch (e) { toast.error(formatError(e)); }
  };

  // Phase 55 — Payroll batch workflow state
  const [batches, setBatches] = useState([]);
  const [openBatchId, setOpenBatchId] = useState(null);
  // Phase 56 — Redesign state: quick filter chip + expandable row
  const [payrollQuickFilter, setPayrollQuickFilter] = useState("all"); // all | issues | pending | ready | paid
  const [expandedPayrollId, setExpandedPayrollId] = useState(null);
  const loadBatches = useCallback(async () => {
    try {
      const { data } = await api.get(`/payroll-batches?month=${pMonth}&year=${pYear}`);
      setBatches(data || []);
    } catch { /* best-effort */ }
  }, [pMonth, pYear]);
  useEffect(() => { if (isAdmin || isAccountant || user?.role === "hr" || user?.role === "manager" || user?.role === "senior_manager") { loadBatches(); } }, [loadBatches, isAdmin, isAccountant, user?.role]);
  const currentBatch = batches[0] || null;

  const finalisePayroll = async () => {
    if (!window.confirm(`Finalise payroll for ${pMonth}/${pYear}?\n\nAfter finalisation, payroll cannot be edited unless it is reopened by an authorised user.\n\nContinue?`)) return;
    try {
      const remarks = window.prompt("Optional remarks for the approver:", "") || "";
      const { data } = await api.post("/payroll/finalise", { month: pMonth, year: pYear, remarks });
      toast.success(`Finalised ₹${(data.net_payable || 0).toLocaleString("en-IN")} — ${data.staff_count} staff → ${data.status.replace("_", " ")}`);
      loadBatches();
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  const sName = (id) => staff.find((s) => s.id === id)?.name || "—";

  return (
    <div className="space-y-5" data-testid="hrms-page">
      {/* Hero header with gradient + KPI strip */}
      <div className="relative overflow-hidden border border-[var(--border)]">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/50" />
        <div className="relative px-5 py-5 md:px-6 md:py-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="overline text-[10px]">HRMS · Payroll · Attendance · Leaves · Reimbursements</div>
              <h1 className="font-heading font-black tracking-tight text-3xl md:text-4xl mt-1">HR Command Centre</h1>
              <p className="text-sm text-[var(--muted)] mt-1 max-w-xl">
                Ek jagah pe pura staff lifecycle — onboarding, attendance, leaves, reimbursements, payroll. Har action ek click door.
              </p>
            </div>
            <PrintButton />
          </div>
          {/* KPI strip */}
          <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { key: "staff", icon: Users, label: "Total Staff", value: staffTotal || staff.length, tone: "text-indigo-700 bg-indigo-50 border-indigo-200" },
              { key: "attendance", icon: CalendarCheck, label: "Attendance Rows", value: attRecent.length, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
              { key: "leaves", icon: CalendarDays, label: "Leave Requests", value: leaves.length, tone: "text-amber-700 bg-amber-50 border-amber-200" },
              { key: "reimb", icon: Receipt, label: "Reimbursements", value: reimbs.length, tone: "text-blue-700 bg-blue-50 border-blue-200" },
              { key: "payroll", icon: Wallet, label: "Payroll Rows", value: payrollTotal || payroll.length, tone: "text-slate-700 bg-slate-50 border-slate-200" },
            ].map((k) => {
              const Icon = k.icon;
              return (
                <div key={k.key} className={`border p-3 ${k.tone}`} data-testid={`hrms-kpi-${k.key}`}>
                  <div className="flex items-center gap-2">
                    <Icon size={14} strokeWidth={2} />
                    <div className="overline text-[10px] font-semibold">{k.label}</div>
                  </div>
                  <div className="font-heading font-black text-2xl tracking-tight num mt-1">{k.value}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Tabs defaultValue="reimb">
        <TabsList className="rounded-none bg-white border border-[var(--border)] p-1 h-auto flex flex-wrap gap-1 justify-start" data-testid="hrms-tablist">
          {[
            { value: "reimb",      label: "Reimbursements", desc: "Claims + approvals",   icon: Receipt,        tone: "data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:border-blue-300" },
            { value: "staff",      label: "Staff",          desc: "Roster + master data", icon: Users,          tone: "data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 data-[state=active]:border-indigo-300" },
            { value: "attendance", label: "Attendance",     desc: "Daily punch + regs.",  icon: CalendarCheck,  tone: "data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700 data-[state=active]:border-emerald-300" },
            { value: "leaves",     label: "Leaves",         desc: "Requests + balances",  icon: CalendarDays,   tone: "data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700 data-[state=active]:border-amber-300" },
            { value: "payroll",    label: "Payroll",        desc: "Monthly salary run",   icon: Wallet,         tone: "data-[state=active]:bg-slate-100 data-[state=active]:text-slate-800 data-[state=active]:border-slate-400" },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger
                key={t.value}
                value={t.value}
                data-testid={`tab-${t.value}`}
                className={`rounded-none border border-transparent px-3 py-2 flex items-center gap-2 text-left flex-1 min-w-[150px] hover:bg-slate-50 transition-colors ${t.tone}`}
              >
                <Icon size={18} strokeWidth={1.8} />
                <div className="min-w-0">
                  <div className="font-semibold text-[13px] leading-tight">{t.label}</div>
                  <div className="text-[10px] text-[var(--muted)] leading-tight truncate">{t.desc}</div>
                </div>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Reimbursements */}
        <TabsContent value="reimb" className="mt-4 space-y-4">
          {/* Claim Form Templates — HR/Admin manages, everyone can download */}
          <div className="swiss-card p-4" data-testid="reimb-templates-panel">
            <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
              <div>
                <div className="overline">HR · Claim Form Templates</div>
                <div className="text-sm text-[var(--muted)]">Pre-designed formats (PDF/DOCX/XLSX) staff can download and fill manually before uploading.</div>
              </div>
              {canManageTemplates && (
                <Dialog open={openTplUpload} onOpenChange={setOpenTplUpload}>
                  <DialogTrigger asChild>
                    <Button className="brand-btn rounded-none gap-2" data-testid="btn-upload-tpl"><Upload size={14} /> Upload Template</Button>
                  </DialogTrigger>
                  <DialogContent className="rounded-none max-w-md">
                    <DialogHeader><DialogTitle className="font-heading">Upload Claim Template</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div><Label>Template Name *</Label><Input value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} placeholder="e.g. Travel Claim Form" className="rounded-none" data-testid="tpl-name" /></div>
                      <div><Label>Category (optional)</Label><Input value={tplForm.category} onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })} placeholder="Travel, Fuel, Food…" className="rounded-none" data-testid="tpl-category" /></div>
                      <div><Label>Description (optional)</Label><Textarea value={tplForm.description} onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })} className="rounded-none" rows={2} data-testid="tpl-description" /></div>
                      <div>
                        <Label>File * <span className="text-[10px] text-[var(--muted)]">(PDF / DOCX / XLSX — max 10MB)</span></Label>
                        <input ref={tplFileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => setTplForm({ ...tplForm, file: e.target.files?.[0] || null })} className="block w-full text-sm mt-1" data-testid="tpl-file" />
                        {tplForm.file && <div className="text-xs text-[var(--brand)] mt-1">{tplForm.file.name} · {(tplForm.file.size / 1024).toFixed(0)} KB</div>}
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setOpenTplUpload(false)} className="rounded-none">Cancel</Button>
                      <Button onClick={uploadTemplate} disabled={tplUploading} className="brand-btn rounded-none" data-testid="tpl-upload-submit">{tplUploading ? "Uploading…" : "Upload"}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            {reimbTemplates.length === 0 ? (
              <div className="overline text-center py-4 border border-dashed border-[var(--border)] text-xs">
                {canManageTemplates ? "No templates uploaded yet — click 'Upload Template' to add one." : "No templates available."}
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2" data-testid="reimb-templates-list">
                {reimbTemplates.map((t) => (
                  <li key={t.id} className={`border border-[var(--border)] px-3 py-2 text-sm flex items-center gap-3 ${t.is_active ? "" : "opacity-60"}`} data-testid={`tpl-row-${t.id}`}>
                    <FileText size={18} className="text-[var(--brand)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{t.name}{!t.is_active && <span className="ml-2 text-[10px] uppercase bg-gray-200 text-[var(--muted)] px-1">Archived</span>}</div>
                      <div className="text-xs text-[var(--muted)] truncate">{t.category ? `${t.category} · ` : ""}{t.filename} · {(t.size / 1024).toFixed(0)} KB</div>
                      {t.description && <div className="text-[10px] text-[var(--muted)] mt-0.5 line-clamp-1">{t.description}</div>}
                    </div>
                    <a
                      href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(t.file_path)}`}
                      target="_blank" rel="noreferrer"
                      className="text-[var(--brand)] hover:underline text-xs inline-flex items-center gap-1"
                      data-testid={`tpl-download-${t.id}`}
                    >
                      <Download size={12} /> Download
                    </a>
                    {canManageTemplates && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => toggleTemplateActive(t)} className="h-7 w-7 rounded-none" title={t.is_active ? "Archive" : "Restore"} data-testid={`tpl-toggle-${t.id}`}>
                          <Archive size={13} />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteTemplate(t.id)} className="h-7 w-7 rounded-none hover:text-[var(--danger)]" title="Delete" data-testid={`tpl-delete-${t.id}`}>
                          <Trash2 size={13} />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <Dialog open={openR} onOpenChange={setOpenR}>
              <DialogTrigger asChild>
                <Button className="brand-btn rounded-none gap-2" data-testid="btn-new-reimb"><Plus size={16} /> New Reimbursement</Button>
              </DialogTrigger>
              <DialogContent className="rounded-none">
                <DialogHeader><DialogTitle className="font-heading">New Reimbursement</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Staff</Label>
                    <Select value={rForm.staff_id} onValueChange={(v) => setRForm({ ...rForm, staff_id: v })}>
                      <SelectTrigger className="rounded-none"><SelectValue placeholder="Select staff" /></SelectTrigger>
                      <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — {s.designation}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Amount</Label><Input type="number" value={rForm.amount} onChange={(e) => setRForm({ ...rForm, amount: e.target.value })} className="rounded-none" /></div>
                    <div><Label>Date</Label><Input type="date" value={rForm.date} onChange={(e) => setRForm({ ...rForm, date: e.target.value })} className="rounded-none" /></div>
                  </div>
                  <div><Label>Category</Label><Input value={rForm.category} onChange={(e) => setRForm({ ...rForm, category: e.target.value })} placeholder="Travel, Meals, Supplies…" className="rounded-none" /></div>
                  <div><Label>Description</Label><Textarea value={rForm.description} onChange={(e) => setRForm({ ...rForm, description: e.target.value })} className="rounded-none" rows={2} /></div>

                  {/* Attachments */}
                  <div className="border-t border-[var(--border)] pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="overline">Attachments (bills / receipts)</Label>
                      <div>
                        <input ref={reimbFileRef} type="file" hidden onChange={uploadReimbAttachment} data-testid="reimb-attach-input" />
                        <Button type="button" size="sm" variant="outline" disabled={reimbUploading} onClick={() => reimbFileRef.current?.click()} className="rounded-none gap-2" data-testid="btn-reimb-attach">
                          <Upload size={14} /> {reimbUploading ? "Uploading…" : "Attach file"}
                        </Button>
                      </div>
                    </div>
                    {(rForm.attachments || []).length === 0 ? (
                      <div className="overline text-center py-3 border border-dashed border-[var(--border)] text-xs">No attachments — upload bills/receipts (max 10MB).</div>
                    ) : (
                      <ul className="space-y-1">
                        {rForm.attachments.map((a) => (
                          <li key={a.id} className="flex items-center justify-between border border-[var(--border)] px-3 py-2 text-sm">
                            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline truncate flex items-center gap-2">
                              <Paperclip size={12} /> {a.filename}
                            </a>
                            <div className="flex items-center gap-3 ml-3">
                              <span className="overline text-xs">{(a.size / 1024).toFixed(0)} KB</span>
                              <Button type="button" size="icon" variant="ghost" onClick={() => removeReimbAttachment(a.id)} className="h-7 w-7 rounded-none hover:text-[var(--danger)]"><Trash2 size={14} /></Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenR(false)} className="rounded-none">Cancel</Button>
                  <Button onClick={submitReimb} className="brand-btn rounded-none" data-testid="reimb-save">Submit</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="swiss-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
                <th className="text-left p-3">Date</th><th className="text-left p-3">Staff</th>
                <th className="text-right p-3">Amount</th><th className="text-left p-3">Category</th>
                <th className="text-left p-3">Approval Flow</th><th className="text-right p-3 w-44">Actions</th>
              </tr></thead>
              <tbody>
                {reimbs.length === 0 ? <tr><td colSpan={6} className="text-center py-8 overline">No data</td></tr> : reimbs.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                    <td className="p-3 num">{r.date}</td>
                    <td className="p-3">{sName(r.staff_id)}</td>
                    <td className="p-3 num font-medium">{inr(r.amount)}</td>
                    <td className="p-3 text-[var(--muted)]">{r.category || "—"}{r.attachments?.length ? (
                      <button
                        type="button"
                        onClick={() => setViewAttachments(r)}
                        className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--brand)] border border-[var(--brand)] px-1 py-0.5 hover:bg-blue-50"
                        title={`View ${r.attachments.length} attachment(s)`}
                        data-testid={`view-attach-${r.id}`}
                      >
                        <Paperclip size={10} /> {r.attachments.length}
                      </button>
                    ) : null}</td>
                    <td className="p-3"><Stepper status={r.status} /></td>
                    <td className="p-3 text-right">
                      <div className="inline-flex gap-1 flex-wrap justify-end">
                        {r.chain_snapshot?.length && (
                          <Button size="sm" variant="ghost" onClick={() => setTrackTimeline({ type: "reimbursement", id: r.id })} className="rounded-none h-8 px-2 text-[var(--brand)] gap-1" title="Track approval chain" data-testid={`track-reimb-${r.id}`}><GitMerge size={12} /> Track</Button>
                        )}
                        {r.status === "submitted" && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => act(r.id, "l1-approve")} className="rounded-none h-8 px-2 text-[var(--success)]" data-testid={`l1-${r.id}`}>L1 ✓</Button>
                            <Button size="sm" variant="ghost" onClick={() => act(r.id, "reject")} className="rounded-none h-8 px-2 text-[var(--danger)]"><X size={14} /></Button>
                          </>
                        )}
                        {r.status === "l1_approved" && (isAdmin || isAccountant) && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => act(r.id, "accountant-approve")} className="rounded-none h-8 px-2 text-[var(--success)]" data-testid={`acct-${r.id}`}>Acct ✓</Button>
                            <Button size="sm" variant="ghost" onClick={() => act(r.id, "reject")} className="rounded-none h-8 px-2 text-[var(--danger)]" data-testid={`reject-l1-${r.id}`}><X size={14} /></Button>
                          </>
                        )}
                        {r.status === "accountant_approved" && (isAdmin || isAccountant) && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => act(r.id, "pay")} className="rounded-none h-8 px-2 text-[var(--brand)] font-medium" data-testid={`pay-${r.id}`}><Check size={14} /> Pay</Button>
                            <Button size="sm" variant="ghost" onClick={() => act(r.id, "reject")} className="rounded-none h-8 px-2 text-[var(--danger)]" data-testid={`reject-acct-${r.id}`}><X size={14} /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Staff */}
        <TabsContent value="staff" className="mt-4 space-y-4">
          {/* Search + pagination header (server-side) */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Input
                type="search"
                placeholder="Search name / employee code / designation / email"
                value={staffQ}
                onChange={(e) => { setStaffQ(e.target.value); setStaffPage(0); }}
                className="rounded-none w-72"
                data-testid="staff-search"
              />
              <span className="text-xs text-[var(--muted)]">Showing {staff.length} of {staffTotal}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setStaffPage((p) => Math.max(0, p - 1))} disabled={staffPage === 0} className="rounded-none" data-testid="staff-prev">Prev</Button>
              <span className="text-xs">Page {staffPage + 1} / {Math.max(1, Math.ceil(staffTotal / PAGE))}</span>
              <Button size="sm" variant="outline" onClick={() => setStaffPage((p) => p + 1)} disabled={(staffPage + 1) * PAGE >= staffTotal} className="rounded-none" data-testid="staff-next">Next</Button>
            </div>
          </div>
          {canManageStaff && (
            <div className="flex justify-end gap-2">
              {isAdmin && selectedStaff.size > 0 && (
                <Button onClick={() => setBulkStaffOpen(true)} variant="outline" className="rounded-none gap-2 border-[var(--danger)] text-[var(--danger)] hover:bg-red-50" data-testid="bulk-archive-staff">
                  <Archive size={14} /> Archive ({selectedStaff.size})
                </Button>
              )}
              {isAdmin && (
                <>
                  <Button
                    onClick={runBackfillEmpCodes}
                    variant="outline"
                    className="rounded-none gap-2"
                    data-testid="backfill-empcodes-btn"
                    title="Assign EMP-YYYY-XXXX codes to staff who are missing one"
                  >
                    <Hash size={14} /> Backfill Codes
                  </Button>
                  <Button
                    onClick={downloadStaffExport}
                    variant="outline"
                    className="rounded-none gap-2"
                    data-testid="export-staff-csv-btn"
                    title="Download all staff as CSV (same format as bulk import)"
                  >
                    <Download size={14} /> Export CSV
                  </Button>
                  <Button
                    onClick={downloadStaffTemplate}
                    variant="outline"
                    className="rounded-none gap-2"
                    data-testid="template-staff-csv-btn"
                    title="Download an empty CSV template for bulk import"
                  >
                    <FileDown size={14} /> Template
                  </Button>
                  <label className="inline-flex items-center gap-2 border border-[var(--border)] rounded-none px-3 h-9 cursor-pointer hover:bg-gray-50 text-sm" data-testid="bulk-add-staff-label">
                    <Upload size={14} /> Bulk Add (CSV)
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleBulkStaffCsv}
                      className="hidden"
                      data-testid="bulk-add-staff-input"
                    />
                  </label>
                </>
              )}
              <Dialog open={openS} onOpenChange={(o) => { setOpenS(o); if (!o) { setEditingStaffId(null); setStaffForm(emptyStaffForm); } }}>
                <DialogTrigger asChild><Button onClick={openAddStaff} className="brand-btn rounded-none gap-2" data-testid="btn-new-staff"><Plus size={16} /> Add Staff</Button></DialogTrigger>
                <DialogContent className="rounded-none max-w-3xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle className="font-heading">{editingStaffId ? "Edit Staff" : "Add Staff"}</DialogTitle></DialogHeader>

                  {/* SECTION 1 — Basic */}
                  <div className="space-y-2">
                    <div className="overline text-[var(--brand)]">Basic Info</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2"><Label>Name <span className="text-[var(--danger)]">*</span></Label><Input value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} className="rounded-none" data-testid="staff-name" /></div>
                      <div><Label>Designation</Label><Input value={staffForm.designation} onChange={(e) => setStaffForm({ ...staffForm, designation: e.target.value })} className="rounded-none" /></div>
                      {isAdmin && (
                        <div><Label>Reports To <span className="overline text-[10px]">(admin only)</span></Label>
                          <Select value={staffForm.reports_to_id || "__none"} onValueChange={(v) => setStaffForm({ ...staffForm, reports_to_id: v === "__none" ? "" : v })}>
                            <SelectTrigger className="rounded-none"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent><SelectItem value="__none">—</SelectItem>{staff.filter((s) => s.id !== editingStaffId).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      )}
                      <div><Label>Monthly Salary</Label><Input type="number" value={staffForm.monthly_salary} onChange={(e) => setStaffForm({ ...staffForm, monthly_salary: e.target.value })} className="rounded-none" /></div>
                      <div><Label>Per-Day Rate</Label><Input type="number" value={staffForm.per_day_rate} onChange={(e) => setStaffForm({ ...staffForm, per_day_rate: e.target.value })} className="rounded-none" /></div>
                      <div><Label>Joining Date</Label><Input type="date" value={staffForm.joining_date} onChange={(e) => setStaffForm({ ...staffForm, joining_date: e.target.value })} className="rounded-none" /></div>
                      <div>
                        <Label>Exit / Last Working Date <span className="overline text-[10px]">(if resigned)</span></Label>
                        <Input
                          type="date"
                          value={staffForm.exit_date || ""}
                          onChange={(e) => setStaffForm({ ...staffForm, exit_date: e.target.value })}
                          className="rounded-none"
                          data-testid="staff-exit-date"
                        />
                        <div className="text-[10px] text-[var(--muted)] mt-1">Set this to auto-exclude staff from payroll runs beyond their last working month.</div>
                      </div>
                      <div><Label>Center / Location</Label>
                        <Select value={staffForm.center_id || "__none"} onValueChange={(v) => setStaffForm({ ...staffForm, center_id: v === "__none" ? "" : v })}>
                          <SelectTrigger className="rounded-none" data-testid="staff-center"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— None —</SelectItem>
                            {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <div className="text-[10px] text-[var(--muted)] mt-1">Drives geofence enforcement on mobile check-in</div>
                      </div>
                      <div><Label>Shift</Label>
                        <Select value={staffForm.shift_id || "__none"} onValueChange={(v) => setStaffForm({ ...staffForm, shift_id: v === "__none" ? "" : v })}>
                          <SelectTrigger className="rounded-none" data-testid="staff-shift"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— None —</SelectItem>
                            {shifts.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <div className="text-[10px] text-[var(--muted)] mt-1">Defines late penalty &amp; half-day rules</div>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2 — Contact */}
                  <div className="space-y-2 pt-4 border-t border-[var(--border)]">
                    <div className="overline text-[var(--brand)]">Contact</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Email</Label><Input type="email" value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} placeholder="staff@example.com" className="rounded-none" data-testid="staff-email" /></div>
                      <div><Label>Mobile</Label><Input value={staffForm.mobile} onChange={(e) => setStaffForm({ ...staffForm, mobile: e.target.value })} placeholder="+91 ..." className="rounded-none" data-testid="staff-mobile" /></div>
                    </div>
                  </div>

                  {/* SECTION 3 — Personal */}
                  <div className="space-y-2 pt-4 border-t border-[var(--border)]">
                    <div className="overline text-[var(--brand)]">Personal Info</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Date of Birth</Label><Input type="date" value={staffForm.date_of_birth} onChange={(e) => setStaffForm({ ...staffForm, date_of_birth: e.target.value })} className="rounded-none" /></div>
                      <div><Label>Gender</Label>
                        <Select value={staffForm.gender || "__none"} onValueChange={(v) => setStaffForm({ ...staffForm, gender: v === "__none" ? "" : v })}>
                          <SelectTrigger className="rounded-none"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">—</SelectItem>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2"><Label>Address</Label><Textarea value={staffForm.address} onChange={(e) => setStaffForm({ ...staffForm, address: e.target.value })} placeholder="Street, City, State, PIN" className="rounded-none" rows={2} /></div>
                      <div><Label>PAN</Label><Input value={staffForm.pan} onChange={(e) => setStaffForm({ ...staffForm, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} className="rounded-none uppercase" /></div>
                      <div><Label>Aadhaar (last 4 digits)</Label><Input value={staffForm.aadhaar_last4} onChange={(e) => setStaffForm({ ...staffForm, aadhaar_last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="1234" maxLength={4} className="rounded-none" /></div>
                      <div><Label>Emergency Contact Name</Label><Input value={staffForm.emergency_contact_name} onChange={(e) => setStaffForm({ ...staffForm, emergency_contact_name: e.target.value })} className="rounded-none" /></div>
                      <div><Label>Emergency Contact Mobile</Label><Input value={staffForm.emergency_contact_mobile} onChange={(e) => setStaffForm({ ...staffForm, emergency_contact_mobile: e.target.value })} placeholder="+91 ..." className="rounded-none" /></div>
                    </div>
                  </div>

                  {/* SECTION 4 — Bank Details */}
                  <div className="space-y-2 pt-4 border-t border-[var(--border)]">
                    <div className="flex items-center justify-between">
                      <div className="overline text-[var(--brand)]">Bank Details <span className="overline text-[10px] text-[var(--muted)]">(for payroll)</span></div>
                      {editingStaffId && (() => {
                        const target = staff.find((x) => x.id === editingStaffId) || {};
                        if (target.bank_verified) {
                          return <span className="inline-flex items-center gap-1 text-[10px] text-[var(--success)] font-bold uppercase">✓ Verified</span>;
                        }
                        return (
                          <Button size="sm" variant="outline" onClick={async () => {
                            try { await api.post(`/staff/${editingStaffId}/verify-bank`); toast.success("Bank verified"); loadAll(); }
                            catch (e) { toast.error(formatError(e)); }
                          }} className="rounded-none h-7 px-2 gap-1 text-xs" data-testid="verify-bank-btn">Verify Bank</Button>
                        );
                      })()}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Account Holder Name</Label><Input value={staffForm.account_holder_name} onChange={(e) => setStaffForm({ ...staffForm, account_holder_name: e.target.value })} className="rounded-none" /></div>
                      <div><Label>Bank Name</Label><Input value={staffForm.bank_name} onChange={(e) => setStaffForm({ ...staffForm, bank_name: e.target.value })} placeholder="e.g. SBI" className="rounded-none" /></div>
                      <div><Label>Account Number</Label><Input value={staffForm.bank_account_no} onChange={(e) => setStaffForm({ ...staffForm, bank_account_no: e.target.value.replace(/\s/g, "") })} className="rounded-none" data-testid="staff-bank-account" /></div>
                      <div><Label>IFSC</Label><Input value={staffForm.ifsc} onChange={(e) => setStaffForm({ ...staffForm, ifsc: e.target.value.toUpperCase() })} placeholder="SBIN0001234" maxLength={11} className="rounded-none uppercase" /></div>
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">Note: editing any bank field auto-clears verification — re-verify after change.</div>
                  </div>

                  {/* SECTION 4.5 — Staff Documents (only when editing) */}
                  {editingStaffId && <StaffDocsView staffId={editingStaffId} />}

                  {/* SECTION 5 — Login provisioning (only on Add, not Edit) */}
                  {!editingStaffId && (
                    <div className="pt-4 border-t border-[var(--border)] space-y-3">
                      <label className="flex items-start gap-2 cursor-pointer" data-testid="create-login-toggle">
                        <input
                          type="checkbox"
                          checked={!!staffForm.create_login}
                          onChange={(e) => setStaffForm({ ...staffForm, create_login: e.target.checked })}
                          className="mt-1"
                        />
                        <span className="text-sm">
                          <span className="font-medium">Create login &amp; email credentials</span>
                          <span className="block text-xs text-[var(--muted)] mt-0.5">A random password will be generated and emailed to the staff with their check-in link. Email above is used as login.</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer" data-testid="send-offer-letter-toggle">
                        <input
                          type="checkbox"
                          checked={!!staffForm.send_offer_letter}
                          onChange={(e) => setStaffForm({ ...staffForm, send_offer_letter: e.target.checked })}
                          className="mt-1"
                        />
                        <span className="text-sm">
                          <span className="font-medium">Send offer letter (PDF)</span>
                          <span className="block text-xs text-[var(--muted)] mt-0.5">Auto-generates the offer letter from the uploaded DOCX template (matched to the center&apos;s company), saves a PDF copy, and emails it to the staff. Skipped silently if no template is uploaded.</span>
                        </span>
                      </label>
                    </div>
                  )}

                  <DialogFooter><Button variant="outline" onClick={() => setOpenS(false)} className="rounded-none">Cancel</Button><Button onClick={saveStaff} className="brand-btn rounded-none" data-testid="staff-save">{editingStaffId ? "Update" : "Save"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <div className="swiss-card overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
              {isAdmin && (
                <th className="p-3 w-10">
                  <input type="checkbox" checked={allStaffSelected} onChange={toggleAllStaff} disabled={staffIds.length === 0} className="cursor-pointer" data-testid="select-all-staff" />
                </th>
              )}
              <th className="text-left p-3">Emp Code</th>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Today</th>
              <th className="text-left p-3">Designation</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Mobile</th>
              <th className="text-left p-3">Bank</th>
              <th className="text-right p-3">Salary</th>
              <th className="text-right p-3">Per-Day</th>
              {(canManageStaff || canViewStaffFull) && <th className="text-right p-3 no-print">Actions</th>}
            </tr></thead><tbody>
              {staff.length === 0 ? <tr><td colSpan={((canManageStaff || canViewStaffFull) ? 10 : 9) + (isAdmin ? 1 : 0)} className="text-center py-8 overline">No staff yet</td></tr> : staff.map((s) => (
                <tr key={s.id} className={`border-b border-[var(--border)] hover:bg-gray-50 ${s.is_active === false ? "opacity-50" : ""}`}>
                  {isAdmin && (
                    <td className="p-3">
                      <input type="checkbox" checked={selectedStaff.has(s.id)} onChange={() => toggleStaff(s.id)} className="cursor-pointer" data-testid={`select-staff-${s.id}`} />
                    </td>
                  )}
                  <td className="p-3 font-mono text-xs text-[var(--brand)]" data-testid={`staff-empcode-${s.id}`}>{s.employee_code || "—"}</td>
                  <td className="p-3 font-medium">
                    {s.name}
                    {s.is_active === false && <span className="ml-2 text-xs text-[var(--muted)]">(archived)</span>}
                  </td>
                  <td className="p-3" data-testid={`staff-today-${s.id}`}>
                    <StaffTodayChip status={s.today_status} />
                  </td>
                  <td className="p-3">{s.designation}</td>
                  <td className="p-3 text-[var(--muted)] text-xs">{s.email || "—"}</td>
                  <td className="p-3 text-[var(--muted)] text-xs">{s.mobile || "—"}</td>
                  <td className="p-3 text-[var(--muted)] text-xs">
                    {s.bank_name ? `${s.bank_name}${s.bank_account_no ? " · ****" + s.bank_account_no.slice(-4) : ""}` : "—"}
                    {s.bank_account_no && (
                      <span className={`ml-1 text-[9px] font-bold uppercase ${s.bank_verified ? "text-[var(--success)]" : "text-amber-700"}`}>
                        {s.bank_verified ? "✓ verified" : "unverified"}
                      </span>
                    )}
                  </td>
                  <td className="p-3 num">{inr(s.monthly_salary)}</td>
                  <td className="p-3 num">{inr(s.per_day_rate)}</td>
                  {(canManageStaff || canViewStaffFull) && (
                    <td className="p-3 text-right no-print">
                      <div className="flex justify-end gap-1">
                        {s.offer_letter_id && canManageStaff && (
                          <Button
                            size="sm" variant="outline"
                            onClick={() => window.open(`${api.defaults.baseURL}/offer-letters/${s.offer_letter_id}/download`, "_blank")}
                            className="rounded-none h-8 px-2"
                            data-testid={`staff-offer-download-${s.id}`}
                            title="Download last offer letter (PDF)"
                          ><FileDown size={14} /></Button>
                        )}
                        <Button
                          size="sm" variant="outline"
                          onClick={() => sendOfferLetter(s)}
                          className="rounded-none h-8 px-2"
                          data-testid={`staff-offer-send-${s.id}`}
                          title="Generate & email offer letter"
                          style={{ display: canManageStaff ? undefined : "none" }}
                        ><Mail size={14} /></Button>
                        {isAdmin && (
                          <Button
                            size="sm" variant="outline"
                            onClick={() => generateLogin(s)}
                            className={`rounded-none h-8 px-2 ${s.user_id ? "text-emerald-700 border-emerald-300" : ""}`}
                            data-testid={`staff-genlogin-${s.id}`}
                            title={s.user_id ? "Login exists — click to reset password + re-email" : "Generate login ID + password and email to staff"}
                          ><KeyRound size={14} /></Button>
                        )}
                        {canManageStaff && s.bank_account_no && !s.bank_verified && (
                          <Button
                            size="sm" variant="outline"
                            onClick={() => verifyBank(s)}
                            className="rounded-none h-8 px-2 text-amber-700 border-amber-300 bg-amber-50"
                            data-testid={`staff-verify-bank-${s.id}`}
                            title="Bank details submitted — click to verify"
                          ><ShieldAlert size={14} /></Button>
                        )}
                        {s.bank_verified && (
                          <span className="inline-flex items-center h-8 px-2 rounded-none border border-emerald-300 bg-emerald-50 text-emerald-700" title="Bank verified">
                            <ShieldCheck size={14} />
                          </span>
                        )}
                        <Button
                          size="sm" variant="outline"
                          onClick={() => nav(`/hrms/staff/${s.id}/salary`)}
                          className="rounded-none h-8 px-2"
                          data-testid={`staff-salary-${s.id}`}
                          title="Open salary detail"
                        ><User size={14} /></Button>
                        {canViewStaffFull && (
                          <Button
                            size="sm" variant="outline"
                            onClick={() => setViewStaffId(s.id)}
                            className="rounded-none h-8 px-2"
                            data-testid={`staff-view-${s.id}`}
                            title="View full details (bank, documents, contact)"
                          ><Eye size={14} /></Button>
                        )}
                        {canManageStaff && (
                          <Button size="sm" variant="outline" onClick={() => openEditStaff(s)} className="rounded-none h-8 px-2" data-testid={`staff-edit-${s.id}`} title="Edit"><Pencil size={14} /></Button>
                        )}
                        {canDeleteStaff && (
                          <Button size="sm" variant="outline" onClick={() => deleteStaff(s)} className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50" data-testid={`staff-delete-${s.id}`} title="Delete"><Trash2 size={14} /></Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody></table></div>
        </TabsContent>

        {/* Attendance */}
        <TabsContent value="attendance" className="mt-4 space-y-4">
          <div className="swiss-card p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="overline">Date</Label>
              <Input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} className="rounded-none w-40" data-testid="att-date" />
            </div>
            {canMarkAttendance && (
              <>
                <Button variant="outline" onClick={() => markAll("present")} className="rounded-none" data-testid="att-mark-all-present">Mark all Present</Button>
                <Button variant="outline" onClick={() => markAll("absent")} className="rounded-none">Mark all Absent</Button>
                <Button onClick={saveAttendance} className="brand-btn rounded-none ml-auto gap-2" data-testid="att-save"><CalendarCheck size={16} /> Save Attendance</Button>
              </>
            )}
          </div>

          <div className="swiss-card p-4">
            {(dayPaidOff.isHoliday || dayPaidOff.isWeeklyOff) && (
              <div
                className={`mb-3 px-3 py-2 border rounded-none flex items-center gap-2 text-sm ${dayPaidOff.isHoliday ? "bg-indigo-50 border-indigo-300 text-indigo-800" : "bg-purple-50 border-purple-300 text-purple-800"}`}
                data-testid="paid-off-banner"
              >
                <span className="font-bold uppercase text-xs">
                  {dayPaidOff.isHoliday ? "🎉 Holiday" : "🏖 Weekly Off"}
                </span>
                <span>
                  {attDate} — Paid day. Attendance mark karne ki zaroorat nahi hai. Salary deduction nahi hogi.
                </span>
              </div>
            )}
            {staff.length === 0 ? (
              <div className="text-center py-12 overline">No staff yet</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="att-thumbnail-grid">
                {staff.map((s) => {
                  // Phase 37 — Weekly Off / Holiday auto-overrides the status
                  // so admins can't accidentally mark absent on paid days.
                  const paidOffKind = dayPaidOff.isHoliday ? "holiday" : dayPaidOff.isWeeklyOff ? "weekly_off" : null;
                  const status = paidOffKind || attMap[s.id] || "";
                  const badgeCls = {
                    present:    "bg-emerald-50 text-emerald-700 border-emerald-300",
                    absent:     "bg-red-50 text-red-700 border-red-300",
                    half:       "bg-amber-50 text-amber-700 border-amber-300",
                    leave:      "bg-blue-50 text-blue-700 border-blue-300",
                    weekly_off: "bg-purple-50 text-purple-700 border-purple-300",
                    holiday:    "bg-indigo-50 text-indigo-700 border-indigo-300",
                  }[status] || "bg-gray-50 text-[var(--muted)] border-[var(--border)]";
                  const statusLabel = {
                    present: "Present", absent: "Absent", half: "Half Day", leave: "Leave",
                    weekly_off: "Weekly Off", holiday: "Holiday",
                  }[status] || "—";
                  const initials = (s.name || "?").split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]?.toUpperCase()).join("");
                  const avatarBg = {
                    present:    "bg-emerald-100 text-emerald-700",
                    absent:     "bg-red-100 text-red-700",
                    half:       "bg-amber-100 text-amber-700",
                    leave:      "bg-blue-100 text-blue-700",
                    weekly_off: "bg-purple-100 text-purple-700",
                    holiday:    "bg-indigo-100 text-indigo-700",
                  }[status] || "bg-gray-100 text-[var(--brand)]";
                  const stripeColor = {
                    present: "#10b981", absent: "#ef4444", half: "#f59e0b", leave: "#3b82f6",
                    weekly_off: "#a855f7", holiday: "#6366f1",
                  }[status];
                  return (
                    <div
                      key={s.id}
                      className={`border rounded-none p-3 flex items-center gap-3 hover:shadow-sm transition-shadow ${status ? "border-l-4" : "border-l-4 border-l-transparent"}`}
                      style={stripeColor ? { borderLeftColor: stripeColor } : undefined}
                      data-testid={`att-card-${s.id}`}
                    >
                      <div className={`w-11 h-11 flex items-center justify-center font-bold text-sm ${avatarBg} rounded-none flex-shrink-0`}>
                        {initials || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate" title={s.name}>{s.name}</div>
                        <div className="text-xs text-[var(--muted)] truncate" title={s.designation}>{s.designation || "—"}</div>
                        {s.employee_code && (
                          <div className="text-[10px] font-mono text-[var(--brand)] mt-0.5">{s.employee_code}</div>
                        )}
                      </div>
                      <div className="flex-shrink-0 min-w-[100px]">
                        {paidOffKind ? (
                          <span className={`inline-block w-full text-center text-[10px] font-bold uppercase px-2 py-1 border ${badgeCls}`} data-testid={`att-paidoff-${s.id}`}>
                            {statusLabel}
                          </span>
                        ) : canMarkAttendance ? (
                          <Select value={attMap[s.id] || ""} onValueChange={(v) => setAtt(s.id, v)}>
                            <SelectTrigger
                              className={`rounded-none h-9 text-xs font-semibold border ${badgeCls}`}
                              data-testid={`att-status-${s.id}`}
                            >
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="present">🟢 Present</SelectItem>
                              <SelectItem value="absent">🔴 Absent</SelectItem>
                              <SelectItem value="half">🟡 Half Day</SelectItem>
                              <SelectItem value="leave">🔵 Leave (Paid)</SelectItem>
                              <SelectItem value="unpaid_leave">⚪ Unpaid Leave</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className={`inline-block w-full text-center text-[10px] font-bold uppercase px-2 py-1 border ${badgeCls}`}>
                            {statusLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="swiss-card overflow-x-auto">
            <div className="px-3 pt-3 overline">Recent (last 30 days from {attDate})</div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Staff</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Punch In</th>
                <th className="text-left p-3">Punch Out</th>
                <th className="text-left p-3">Hours</th>
                <th className="text-left p-3">Source</th>
                <th className="text-left p-3">Location</th>
                <th className="text-left p-3">Selfie</th>
              </tr></thead>
              <tbody>
                {attRecent.length === 0 ? <tr><td colSpan={9} className="text-center py-8 overline">No records</td></tr> : attRecent.map((a) => {
                  // Format "HH:mm" from an ISO timestamp in the user's locale.
                  const fmtTime = (iso) => {
                    if (!iso) return "—";
                    try {
                      const d = new Date(iso);
                      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
                    } catch { return "—"; }
                  };
                  // Hours worked between check-in and check-out (or now if still punched in today).
                  let hoursLabel = "—";
                  if (a.check_in_at) {
                    const start = new Date(a.check_in_at);
                    const end = a.check_out_at ? new Date(a.check_out_at) : null;
                    if (end && end > start) {
                      const mins = Math.round((end - start) / 60000);
                      const h = Math.floor(mins / 60);
                      const m = mins % 60;
                      hoursLabel = `${h}h ${m}m`;
                    } else if (!end) {
                      hoursLabel = "In progress";
                    }
                  }
                  return (
                  <tr key={a.id || `${a.staff_id}-${a.date}`} className="border-b border-[var(--border)] hover:bg-gray-50">
                    <td className="p-3 num">{a.date}</td>
                    <td className="p-3">{sName(a.staff_id)}</td>
                    <td className="p-3"><span className="overline">{a.status}</span></td>
                    <td className="p-3 num text-xs" data-testid={`att-in-${a.id || a.staff_id}`}>{fmtTime(a.check_in_at)}</td>
                    <td className="p-3 num text-xs" data-testid={`att-out-${a.id || a.staff_id}`}>{fmtTime(a.check_out_at)}</td>
                    <td className="p-3 num text-xs font-semibold text-[var(--brand)]" data-testid={`att-hours-${a.id || a.staff_id}`}>{hoursLabel}</td>
                    <td className="p-3 overline text-xs">{a.marked_via || "—"}</td>
                    <td className="p-3">
                      {a.latitude != null && a.longitude != null ? (
                        <a href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline text-xs">
                          📍 {a.latitude.toFixed(4)}, {a.longitude.toFixed(4)}
                        </a>
                      ) : <span className="text-[var(--muted)] text-xs">—</span>}
                    </td>
                    <td className="p-3">
                      {a.selfie_path ? (
                        <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.selfie_path)}`} target="_blank" rel="noreferrer">
                          <img src={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.selfie_path)}`} alt="selfie" className="w-10 h-10 object-cover border border-[var(--border)]" />
                        </a>
                      ) : <span className="text-[var(--muted)] text-xs">—</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Calendar (Month) View */}
          <div className="swiss-card p-4 space-y-4" data-testid="att-calendar">
            <div className="flex flex-wrap items-end gap-3">
              <div className="overline font-heading font-bold text-base text-[var(--brand)]">Calendar View</div>
              <div className="ml-auto flex flex-wrap items-end gap-3">
                <div>
                  <Label className="overline">Staff</Label>
                  <Select value={calStaffId} onValueChange={setCalStaffId}>
                    <SelectTrigger className="rounded-none w-56" data-testid="cal-staff"><SelectValue placeholder="Select staff" /></SelectTrigger>
                    <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — {s.designation}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline">Month</Label>
                  <Input type="number" min={1} max={12} value={calMonth} onChange={(e) => setCalMonth(+e.target.value || 1)} className="rounded-none w-20" data-testid="cal-month" />
                </div>
                <div>
                  <Label className="overline">Year</Label>
                  <Input type="number" value={calYear} onChange={(e) => setCalYear(+e.target.value || new Date().getFullYear())} className="rounded-none w-24" data-testid="cal-year" />
                </div>
              </div>
            </div>

            {!calStaffId ? (
              <div className="overline text-center py-8 border border-dashed border-[var(--border)]">Select a staff member to view the monthly calendar.</div>
            ) : (() => {
              const firstDow = new Date(calYear, calMonth - 1, 1).getDay();
              const lastDay = new Date(calYear, calMonth, 0).getDate();
              const cells = [];
              for (let i = 0; i < firstDow; i++) cells.push(null);
              for (let d = 1; d <= lastDay; d++) {
                const mm = String(calMonth).padStart(2,"0");
                const dd = String(d).padStart(2,"0");
                cells.push({ day: d, dateStr: `${calYear}-${mm}-${dd}` });
              }
              while (cells.length % 7 !== 0) cells.push(null);
              const statusClasses = {
                present: "bg-[var(--success)] text-white",
                absent: "bg-[var(--danger)] text-white",
                half: "bg-[var(--warning)] text-[#3d2f00]",
                leave: "bg-[var(--brand)] text-white",
              };
              const statusLetter = { present: "P", absent: "A", half: "H", leave: "L" };
              const counts = { present: 0, absent: 0, half: 0, leave: 0 };
              Object.values(calMap).forEach((s) => { if (counts[s] !== undefined) counts[s] += 1; });
              const daysPresent = counts.present + counts.half * 0.5;

              return (
                <>
                  <div className="grid grid-cols-7 gap-1 text-xs font-medium text-[var(--muted)] overline">
                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
                      <div key={d} className="text-center py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {cells.map((c, i) => {
                      if (!c) return <div key={`pad-${i}`} className="h-16 border border-transparent" />;
                      const status = calMap[c.dateStr];
                      const cls = status ? statusClasses[status] : "bg-white text-[var(--ink)]";
                      const letter = status ? statusLetter[status] : "";
                      const clickable = canMarkAttendance;
                      return (
                        <button
                          type="button"
                          key={c.dateStr}
                          disabled={!clickable}
                          onClick={() => cycleDay(c.dateStr)}
                          data-testid={`cal-day-${c.dateStr}`}
                          title={status ? `${c.dateStr} — ${status}` : c.dateStr + (clickable ? " (click to mark)" : "")}
                          className={`h-16 border border-[var(--border)] flex flex-col items-start p-1.5 transition-colors ${cls} ${clickable ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
                        >
                          <span className="text-xs font-medium">{c.day}</span>
                          {letter && <span className="text-lg font-black tracking-tight mt-auto self-end leading-none">{letter}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-[var(--border)] text-xs">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[var(--success)] inline-block" /> Present <span className="num font-semibold">{counts.present}</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[var(--danger)] inline-block" /> Absent <span className="num font-semibold">{counts.absent}</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[var(--warning)] inline-block" /> Half <span className="num font-semibold">{counts.half}</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[var(--brand)] inline-block" /> Leave <span className="num font-semibold">{counts.leave}</span></div>
                    <div className="ml-auto overline">Days Present: <span className="num font-bold text-[var(--ink)]">{daysPresent}</span> / {lastDay}</div>
                  </div>
                  {canMarkAttendance && (
                    <div className="overline text-[var(--muted)]">Tip: click a day to cycle Present → Absent → Half → Leave.</div>
                  )}
                </>
              );
            })()}
          </div>
        </TabsContent>

        {/* Leaves */}
        <TabsContent value="leaves" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Dialog open={openL} onOpenChange={setOpenL}>
              <DialogTrigger asChild>
                <Button className="brand-btn rounded-none gap-2" data-testid="btn-new-leave"><CalendarDays size={16} /> Apply Leave</Button>
              </DialogTrigger>
              <DialogContent className="rounded-none">
                <DialogHeader><DialogTitle className="font-heading">Apply Leave</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Staff</Label>
                    <Select value={lForm.staff_id} onValueChange={async (v) => {
                      setLForm({ ...lForm, staff_id: v });
                      // Fetch balances for the picked staff (admin/hr can see anyone)
                      try {
                        const yr = new Date().getFullYear();
                        const r = await api.get(`/leave-balances?staff_id=${v}&year=${yr}`);
                        setMyBalances(r.data || []);
                      } catch { setMyBalances([]); }
                    }}>
                      <SelectTrigger className="rounded-none" data-testid="leave-staff"><SelectValue placeholder="Select staff" /></SelectTrigger>
                      <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — {s.designation}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div><Label>Leave Type</Label>
                    <Select value={lForm.leave_type_id} onValueChange={(v) => setLForm({ ...lForm, leave_type_id: v })}>
                      <SelectTrigger className="rounded-none" data-testid="leave-type"><SelectValue placeholder="Pick type (auto-deducts balance on approve)" /></SelectTrigger>
                      <SelectContent>
                        {leaveTypes.map((t) => {
                          const bal = myBalances.find((b) => b.leave_type_id === t.id);
                          return (
                            <SelectItem key={t.id} value={t.id}>
                              {t.code} — {t.name}{bal ? ` · ${bal.balance}/${bal.allocated} left` : " · no balance"}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {lForm.staff_id && lForm.leave_type_id && (() => {
                      const bal = myBalances.find((b) => b.leave_type_id === lForm.leave_type_id);
                      return bal ? (
                        <div className="text-[10px] text-[var(--muted)] mt-1 num">Available: <b>{bal.balance}</b> of {bal.allocated} ({bal.used} used)</div>
                      ) : (
                        <div className="text-[10px] text-amber-700 mt-1">⚠ No allocation for this type / year — HR can add in HR Settings → Leave Allocation</div>
                      );
                    })()}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>From</Label><Input type="date" value={lForm.start_date} onChange={(e) => setLForm({ ...lForm, start_date: e.target.value })} className="rounded-none" data-testid="leave-from" /></div>
                    <div><Label>To</Label><Input type="date" value={lForm.end_date} onChange={(e) => setLForm({ ...lForm, end_date: e.target.value })} className="rounded-none" data-testid="leave-to" /></div>
                  </div>
                  <div><Label>Reason</Label><Textarea value={lForm.reason} onChange={(e) => setLForm({ ...lForm, reason: e.target.value })} className="rounded-none" rows={2} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenL(false)} className="rounded-none">Cancel</Button>
                  <Button onClick={applyLeave} className="brand-btn rounded-none" data-testid="leave-save">Submit</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="swiss-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
                <th className="text-left p-3">Staff</th>
                <th className="text-left p-3">From</th>
                <th className="text-left p-3">To</th>
                <th className="text-left p-3">Reason</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3 w-44">Actions</th>
              </tr></thead>
              <tbody>
                {leaves.length === 0 ? <tr><td colSpan={6} className="text-center py-8 overline">No leave requests</td></tr> : leaves.map((l) => (
                  <tr key={l.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                    <td className="p-3 font-medium">{sName(l.staff_id)}</td>
                    <td className="p-3 num">{l.start_date}</td>
                    <td className="p-3 num">{l.end_date}</td>
                    <td className="p-3 text-[var(--muted)]">{l.reason || "—"}</td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 text-xs border ${
                        l.status === "approved" ? "border-[var(--success)] text-[var(--success)]" :
                        l.status === "rejected" ? "border-[var(--danger)] text-[var(--danger)]" :
                        "border-[var(--warning)] text-[#9a7a00]"
                      }`}>{l.status}</span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex gap-1 flex-wrap justify-end">
                        {l.chain_snapshot?.length && (
                          <Button size="sm" variant="ghost" onClick={() => setTrackTimeline({ type: "leave", id: l.id })} className="rounded-none h-8 px-2 text-[var(--brand)] gap-1" title="Track approval chain" data-testid={`track-leave-${l.id}`}><GitMerge size={12} /> Track</Button>
                        )}
                        {l.status === "pending" && canMarkAttendance && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => decideLeave(l.id, "approved")} className="rounded-none h-8 px-2 text-[var(--success)]" data-testid={`leave-approve-${l.id}`}><Check size={14} /></Button>
                            <Button size="sm" variant="ghost" onClick={() => decideLeave(l.id, "rejected")} className="rounded-none h-8 px-2 text-[var(--danger)]" data-testid={`leave-reject-${l.id}`}><X size={14} /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ============================================================
            Payroll — Redesigned enterprise-finance layout (Phase 56)
            ONLY UI/UX changes. Every existing handler + API call preserved.
            ============================================================ */}
        <TabsContent value="payroll" className="mt-4 space-y-5" data-testid="tab-payroll-panel">
          {/* --- Header: single month selector + primary actions --- */}
          {(isAdmin || isAccountant || user?.role === "hr") && (
            <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="payroll-header">
              <div className="flex flex-wrap items-start gap-4 justify-between">
                <div className="flex-1 min-w-[240px]">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Payroll</div>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <PayrollPeriodPicker month={pMonth} year={pYear} onChange={(m, y) => { setPMonth(m); setPYear(y); }} />
                    <span className="text-sm text-slate-500">· Monthly salary processing</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button onClick={runPayroll} className="rounded-md bg-blue-600 hover:bg-blue-700 text-white h-9 px-4 gap-1.5" data-testid="run-payroll">
                    <TrendingUp size={14} /> Run Payroll
                  </Button>
                  {(isAdmin || user?.role === "hr") && !currentBatch && (
                    <Button
                      onClick={finalisePayroll}
                      className="rounded-md bg-white border border-purple-500 text-purple-700 hover:bg-purple-50 h-9 px-4 gap-1.5"
                      data-testid="finalise-payroll"
                      title="Locks payroll & sends to Approval workflow"
                    >
                      <ShieldCheck size={14} /> Finalise Payroll
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="rounded-md h-9 px-4 gap-1.5" data-testid="payroll-export-menu">
                        <Download size={14} /> Export
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-md">
                      <DropdownMenuItem onClick={() => downloadBankCsv(pMonth, pYear)} data-testid="bank-csv-btn">Bank Transfer CSV</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => downloadHRReport("attendance", pMonth, pYear)} data-testid="rep-attendance-btn">Attendance CSV</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => downloadHRReport("payroll", pMonth, pYear)} data-testid="rep-payroll-btn">Payroll CSV</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => downloadHRReport("consolidated", pMonth, pYear)} data-testid="rep-consolidated-btn">Consolidated CSV</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          )}

          {/* --- Summary cards + progress + attention --- */}
          <PayrollSummary payroll={payroll} total={payrollTotal} />

          {/* --- Payroll batch status card (existing, kept intact) --- */}
          {currentBatch && (
            <PayrollBatchStatusCard batch={currentBatch} onOpen={() => setOpenBatchId(currentBatch.id)} />
          )}

          {/* --- Filter bar with quick chips + search + status --- */}
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-3" data-testid="payroll-filterbar">
            <Input
              type="search"
              placeholder="Search employee…"
              value={payrollQ}
              onChange={(e) => { setPayrollQ(e.target.value); setPayrollPage(0); }}
              className="rounded-md w-56 h-9 text-sm"
              data-testid="payroll-search"
            />
            <Select value={payrollStatus} onValueChange={(v) => { setPayrollStatus(v); setPayrollPage(0); }}>
              <SelectTrigger className="rounded-md w-36 h-9 text-sm" data-testid="payroll-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            {/* Quick chip filters — client-side view filters that reuse existing payroll state */}
            <QuickFilterChips
              value={payrollQuickFilter}
              onChange={(v) => setPayrollQuickFilter(v)}
              counts={_countPayroll(payroll)}
            />
            <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none text-slate-600" data-testid="hide-zero-toggle" title="Hide staff whose attendance is 0 for the whole month">
              <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
              <span>Hide zero-attendance</span>
            </label>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500" data-testid="payroll-count">Showing {payroll.length} of {payrollTotal}</span>
              <Button size="sm" variant="outline" onClick={() => setPayrollPage((p) => Math.max(0, p - 1))} disabled={payrollPage === 0} className="rounded-md h-8" data-testid="payroll-prev">Prev</Button>
              <span className="text-xs">Page {payrollPage + 1} / {Math.max(1, Math.ceil(payrollTotal / PAGE))}</span>
              <Button size="sm" variant="outline" onClick={() => setPayrollPage((p) => p + 1)} disabled={(payrollPage + 1) * PAGE >= payrollTotal} className="rounded-md h-8" data-testid="payroll-next">Next</Button>
            </div>
          </div>

          {/* --- Employee payroll table --- */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    <th className="text-left p-3 w-8"></th>
                    <th className="text-left p-3">Employee</th>
                    <th className="text-left p-3">Attendance</th>
                    <th className="text-right p-3">Gross</th>
                    <th className="text-right p-3">Deductions</th>
                    <th className="text-right p-3">Net Pay</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3 w-40 no-print">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filtered = _applyPayrollFilters(payroll, hideZero, payrollQuickFilter);
                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={8} className="text-center py-10 text-slate-500">
                            {hideZero && payroll.length > 0
                              ? `${payroll.length} zero-attendance rows hidden — toggle "Hide zero-attendance" off to view them.`
                              : "No payroll rows for this period. Click Run Payroll to generate."}
                          </td>
                        </tr>
                      );
                    }
                    return filtered.map((p) => (
                      <PayrollTableRow
                        key={p.id}
                        p={p}
                        sName={sName}
                        isAdmin={isAdmin}
                        isAccountant={isAccountant}
                        userRole={user?.role}
                        canManageStaff={canManageStaff}
                        expanded={expandedPayrollId === p.id}
                        onToggleExpand={() => setExpandedPayrollId(expandedPayrollId === p.id ? null : p.id)}
                        onSalary={() => nav(`/hrms/staff/${p.staff_id}/salary?month=${p.month}&year=${p.year}`)}
                        onRecalc={() => recalcPayroll(p.id)}
                        onPrint={() => printPayslip(p)}
                        onSlipGenerate={() => generateSlip(p.id)}
                        onSlipDownload={() => downloadSlip(p.id, p.slip_filename)}
                        onSlipRelease={() => releaseSlip(p.id, !p.slip_released_at)}
                        onEdit={() => openEditPayroll(p)}
                        onPay={() => payPayroll(p.id)}
                        onEditPaid={() => reopenAndEditPayroll(p)}
                        onDelete={() => deletePayrollRow(p)}
                      />
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          {/* Edit Payslip Dialog */}
          <Dialog open={payrollOpen} onOpenChange={(o) => { setPayrollOpen(o); if (!o) setEditingPayroll(null); }}>
            <DialogContent className="rounded-none max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-heading">Edit Payslip — {editingPayroll?.staff_name} · {editingPayroll?.month}/{editingPayroll?.year}</DialogTitle></DialogHeader>
              {editingPayroll && (
                <div className="space-y-4">
                  {/* Earnings */}
                  <div>
                    <div className="overline text-[var(--brand)] mb-2">Earnings</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Days Present</Label><Input type="number" step="0.5" value={payrollForm.days_present} onChange={(e) => setPayrollForm({ ...payrollForm, days_present: e.target.value })} className="rounded-none" data-testid="pf-days" /></div>
                      <div><Label>Basic</Label><Input type="number" value={payrollForm.basic} onChange={(e) => setPayrollForm({ ...payrollForm, basic: e.target.value })} className="rounded-none" data-testid="pf-basic" /></div>
                      <div><Label>HRA</Label><Input type="number" value={payrollForm.hra} onChange={(e) => setPayrollForm({ ...payrollForm, hra: e.target.value })} className="rounded-none" /></div>
                      <div><Label>DA</Label><Input type="number" value={payrollForm.da} onChange={(e) => setPayrollForm({ ...payrollForm, da: e.target.value })} className="rounded-none" /></div>
                      <div><Label>Conveyance</Label><Input type="number" value={payrollForm.conveyance} onChange={(e) => setPayrollForm({ ...payrollForm, conveyance: e.target.value })} className="rounded-none" /></div>
                      <div><Label>Bonus</Label><Input type="number" value={payrollForm.bonus} onChange={(e) => setPayrollForm({ ...payrollForm, bonus: e.target.value })} className="rounded-none" /></div>
                      <div className="col-span-2"><Label>Incentive</Label><Input type="number" value={payrollForm.incentive} onChange={(e) => setPayrollForm({ ...payrollForm, incentive: e.target.value })} className="rounded-none" /></div>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div>
                    <div className="overline text-[var(--brand)] mb-2">Deductions</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>PF</Label><Input type="number" value={payrollForm.pf_deduction} onChange={(e) => setPayrollForm({ ...payrollForm, pf_deduction: e.target.value })} className="rounded-none" /></div>
                      <div><Label>ESI</Label><Input type="number" value={payrollForm.esi_deduction} onChange={(e) => setPayrollForm({ ...payrollForm, esi_deduction: e.target.value })} className="rounded-none" /></div>
                      <div className="col-span-2"><Label>Late Penalty <span className="text-[10px] text-[var(--muted)]">(auto-computed; you can override)</span></Label><Input type="number" value={payrollForm.late_deduction} onChange={(e) => setPayrollForm({ ...payrollForm, late_deduction: e.target.value })} className="rounded-none" data-testid="pf-late" /></div>
                      {editingPayroll.late_buckets && (
                        <div className="col-span-2 text-[10px] text-[var(--muted)] -mt-1">
                          Late buckets: &lt;2h × {editingPayroll.late_buckets.minor || 0} · 2-6h × {editingPayroll.late_buckets.half_day || 0} · ≥6h × {editingPayroll.late_buckets.full_day || 0} = {editingPayroll.late_days || 0} day(s) deducted
                        </div>
                      )}
                    </div>
                    {/* Other deductions line items */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                        <Label className="overline">Other Deductions</Label>
                        <Button size="sm" variant="outline" onClick={() => setPayrollForm({ ...payrollForm, other_deductions: [...(payrollForm.other_deductions || []), { label: "", amount: 0 }] })} className="rounded-none h-7 px-2 gap-1 text-xs"><Plus size={12} /> Add</Button>
                      </div>
                      <div className="space-y-2 mt-2">
                        {(payrollForm.other_deductions || []).map((li, i) => (
                          <div key={i} className="flex gap-2 items-center">
                            <Input value={li.label} onChange={(e) => {
                              const arr = [...payrollForm.other_deductions];
                              arr[i] = { ...arr[i], label: e.target.value };
                              setPayrollForm({ ...payrollForm, other_deductions: arr });
                            }} placeholder="e.g. Loan recovery" className="rounded-none flex-1" />
                            <Input type="number" value={li.amount} onChange={(e) => {
                              const arr = [...payrollForm.other_deductions];
                              arr[i] = { ...arr[i], amount: e.target.value };
                              setPayrollForm({ ...payrollForm, other_deductions: arr });
                            }} className="rounded-none w-32" />
                            <Button size="sm" variant="outline" onClick={() => {
                              const arr = (payrollForm.other_deductions || []).filter((_, j) => j !== i);
                              setPayrollForm({ ...payrollForm, other_deductions: arr });
                            }} className="rounded-none h-9 px-2 text-[var(--danger)] hover:bg-red-50"><Trash2 size={14} /></Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Live recalculation preview */}
                  {(() => {
                    const n = (v) => parseFloat(v) || 0;
                    const earn = ["basic", "hra", "da", "conveyance", "bonus", "incentive"].reduce((a, k) => a + n(payrollForm[k]), 0);
                    const otherSum = (payrollForm.other_deductions || []).reduce((a, li) => a + n(li.amount), 0);
                    const ded = n(payrollForm.pf_deduction) + n(payrollForm.esi_deduction) + n(payrollForm.late_deduction) + otherSum;
                    return (
                      <div className="bg-gray-50 border border-[var(--border)] p-3 grid grid-cols-3 gap-2 text-sm">
                        <div><div className="overline text-[10px]">Gross</div><div className="font-heading font-bold text-lg">{inr(earn)}</div></div>
                        <div><div className="overline text-[10px]">Deductions</div><div className="font-heading font-bold text-lg text-[var(--danger)]">{inr(ded)}</div></div>
                        <div><div className="overline text-[10px]">Net</div><div className="font-heading font-black text-xl text-[var(--success)]" data-testid="pf-net-preview">{inr(earn - ded)}</div></div>
                      </div>
                    );
                  })()}

                  <div><Label>Remarks (optional)</Label><Input value={payrollForm.remarks || ""} onChange={(e) => setPayrollForm({ ...payrollForm, remarks: e.target.value })} placeholder="e.g. Bonus for project completion" className="rounded-none" /></div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPayrollOpen(false)} className="rounded-none">Cancel</Button>
                <Button onClick={savePayroll} className="brand-btn rounded-none" data-testid="pf-save">Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>

      <ApprovalTimelineModal
        type={trackTimeline.type}
        requestId={trackTimeline.id}
        onClose={() => setTrackTimeline({ type: null, id: null })}
        canAct={isAdmin || user?.role === "hr" || user?.role === "manager" || isAccountant}
        onAfterAct={loadAll}
      />

      <BulkDeleteDialog
        open={bulkStaffOpen}
        onClose={() => setBulkStaffOpen(false)}
        count={selectedStaff.size}
        itemLabel="staff"
        mode="archive"
        busy={bulkStaffBusy}
        onConfirm={bulkArchiveStaff}
        warning="Linked login access will be disabled. Attendance, payroll & leave history are preserved for reports."
      />

      {/* Attachments viewer — opened by clicking the paperclip chip on any reimbursement row */}
      <Dialog open={!!viewAttachments} onOpenChange={(o) => !o && setViewAttachments(null)}>
        <DialogContent className="rounded-none max-w-2xl" data-testid="reimb-attach-modal">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Attachments — {viewAttachments && sName(viewAttachments.staff_id)} · {viewAttachments ? inr(viewAttachments.amount) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {viewAttachments?.description && (
              <div className="text-xs bg-gray-50 border border-[var(--border)] p-2">
                <div className="overline">Description</div>
                <div className="mt-1">{viewAttachments.description}</div>
              </div>
            )}
            {(viewAttachments?.attachments || []).length === 0 ? (
              <div className="text-sm text-[var(--muted)] py-6 text-center">No attachments</div>
            ) : (
              <ul className="space-y-2">
                {viewAttachments.attachments.map((a) => {
                  const url = `${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(a.path)}`;
                  const isImg = (a.content_type || "").startsWith("image/");
                  const isPdf = (a.content_type || "").includes("pdf") || (a.filename || "").toLowerCase().endsWith(".pdf");
                  return (
                    <li key={a.id} className="border border-[var(--border)] p-2" data-testid={`view-attach-item-${a.id}`}>
                      <div className="flex items-center justify-between gap-3">
                        <a href={url} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline text-sm inline-flex items-center gap-2 truncate">
                          <Paperclip size={12} /> {a.filename}
                        </a>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-[var(--muted)]">{(a.size / 1024).toFixed(0)} KB</span>
                          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)] hover:underline inline-flex items-center gap-1"><Download size={12} /> Download</a>
                        </div>
                      </div>
                      {isImg && (
                        <img src={url} alt={a.filename} className="mt-2 max-h-72 border border-[var(--border)] object-contain w-full bg-gray-50" />
                      )}
                      {isPdf && (
                        <iframe src={url} title={a.filename} className="mt-2 w-full h-72 border border-[var(--border)] bg-white" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewAttachments(null)} className="rounded-none" data-testid="reimb-attach-close">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read-only Staff Full-Details dialog — accessible to Accountant + HR + Admin + Manager
          so they can view bank / documents / contact / joining info without an Edit permission. */}
      <StaffFullDetailsDialog
        staffId={viewStaffId}
        onClose={() => setViewStaffId(null)}
        staffList={staff}
      />

      {/* Phase 55 — Payroll batch detail dialog (approve/pay/reopen depending on role + status) */}
      <PayrollBatchDialog
        batchId={openBatchId}
        onClose={() => { setOpenBatchId(null); loadBatches(); loadAll(); }}
        currentUser={user}
      />
    </div>
  );
}

function StaffDocsView({ staffId }) {
  const [docs, setDocs] = useState([]);
  const load = async () => {
    try { const r = await api.get(`/staff/${staffId}/documents`); setDocs(r.data || []); }
    catch { /* best-effort */ }
  };
  useEffect(() => { load(); }, [staffId]);
  const remove = async (id) => {
    if (!window.confirm("Delete this document?")) return;
    try { await api.delete(`/staff-documents/${id}`); load(); toast.success("Deleted"); }
    catch (e) { toast.error(formatError(e)); }
  };
  return (
    <div className="space-y-2 pt-4 border-t border-[var(--border)]">
      <div className="overline text-[var(--brand)]">Documents <span className="overline text-[10px] text-[var(--muted)]">({docs.length} uploaded by staff)</span></div>
      {docs.length === 0 ? (
        <div className="text-xs text-[var(--muted)] py-2">No documents uploaded by staff yet. They can upload from the mobile app → Salary tab.</div>
      ) : (
        <div className="border border-[var(--border)] divide-y divide-[var(--border)] max-h-48 overflow-y-auto">
          {docs.map((d) => (
            <div key={d.id} className="p-2 text-sm flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{d.title}</div>
                <div className="text-[10px] text-[var(--muted)] capitalize">{d.doc_type} · {new Date(d.uploaded_at).toLocaleDateString()}</div>
              </div>
              <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(d.file_path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] text-xs hover:underline">View</a>
              <button onClick={() => remove(d.id)} className="text-[var(--danger)] hover:bg-red-50 p-1" title="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   STAFF FULL-DETAILS DIALOG — read-only view for Accountant / HR / Admin / Manager.
   Shows all persisted info (identity, contact, joining/exit, bank, documents,
   emergency contact) without triggering an edit permission gate.
   ============================================================ */
function StaffFullDetailsDialog({ staffId, onClose, staffList }) {
  const [row, setRow] = useState(null);
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!staffId) { setRow(null); setDocs([]); return; }
    // Prefer the row already in memory to avoid an unnecessary roundtrip.
    const local = (staffList || []).find((x) => x.id === staffId);
    if (local) setRow(local);
    setBusy(true);
    (async () => {
      try {
        // Documents live on their own collection — fetch them (Accountant now allowed).
        const d = await api.get(`/staff/${staffId}/documents`);
        setDocs(d.data || []);
      } catch { /* best effort */ }
      finally { setBusy(false); }
    })();
  }, [staffId, staffList]);

  const s = row || {};
  const dash = (v) => (v == null || v === "" ? "—" : v);
  const money = (v) => (v ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(+v) : "—");
  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");

  return (
    <Dialog open={!!staffId} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="rounded-none max-w-3xl" data-testid="staff-view-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2 text-lg">
            {s.name || "Staff details"}
            {s.employee_code && <span className="text-xs font-mono text-[var(--brand)]">{s.employee_code}</span>}
            {s.bank_verified && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase border bg-emerald-50 text-emerald-700 border-emerald-300">
                <ShieldCheck size={11} /> Bank Verified
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--muted)]">
            Read-only view of {s.name || "staff"}&apos;s complete record — identity, contact, bank, and uploaded documents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1" data-testid="staff-view-body">
          {/* Identity */}
          <div>
            <div className="overline text-[10px] mb-2">Identity</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <ViewField label="Employee Code" value={dash(s.employee_code)} mono testid="view-empcode" />
              <ViewField label="Name" value={dash(s.name)} />
              <ViewField label="Designation" value={dash(s.designation)} />
              <ViewField label="Joining Date" value={fmtDate(s.joining_date)} />
              <ViewField label="Exit Date" value={fmtDate(s.exit_date)} />
              <ViewField label="Status" value={s.exit_date ? <span className="text-red-700 font-semibold">Exited</span> : <span className="text-emerald-700 font-semibold">Active</span>} />
            </div>
          </div>

          {/* Contact */}
          <div>
            <div className="overline text-[10px] mb-2">Contact</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <ViewField label="Email" value={dash(s.email)} testid="view-email" />
              <ViewField label="Mobile" value={dash(s.mobile)} testid="view-mobile" />
              <ViewField label="Date of Birth" value={fmtDate(s.date_of_birth)} />
              <ViewField label="Gender" value={dash(s.gender)} />
              <ViewField label="PAN" value={dash(s.pan)} mono />
              <ViewField label="Aadhaar (last 4)" value={dash(s.aadhaar_last4)} mono />
              <div className="col-span-2 md:col-span-3">
                <ViewField label="Address" value={dash(s.address)} multiline />
              </div>
              <ViewField label="Emergency Contact" value={dash(s.emergency_contact_name)} />
              <ViewField label="Emergency Mobile" value={dash(s.emergency_contact_mobile)} />
            </div>
          </div>

          {/* Salary + Center */}
          <div>
            <div className="overline text-[10px] mb-2">Salary &amp; Center</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <ViewField label="Monthly Salary" value={money(s.monthly_salary)} testid="view-salary" />
              <ViewField label="Per-Day Rate" value={money(s.per_day_rate)} />
              <ViewField label="Center" value={dash(s.center_name || s.center_id)} />
            </div>
          </div>

          {/* Bank */}
          <div>
            <div className="overline text-[10px] mb-2 flex items-center gap-2">
              Bank Details
              {s.bank_verified ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase border bg-emerald-50 text-emerald-700 border-emerald-300">
                  <ShieldCheck size={10} /> Verified
                </span>
              ) : (s.bank_account_no || s.ifsc) ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase border bg-amber-50 text-amber-700 border-amber-300">
                  <ShieldAlert size={10} /> Pending Verification
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <ViewField label="Account Holder" value={dash(s.account_holder_name)} testid="view-holder" />
              <ViewField label="Bank Name" value={dash(s.bank_name)} testid="view-bankname" />
              <ViewField label="Account Number" value={dash(s.bank_account_no)} mono testid="view-accno" />
              <ViewField label="IFSC" value={dash(s.ifsc)} mono testid="view-ifsc" />
              <ViewField label="UPI ID" value={dash(s.upi_id)} />
              {s.bank_verified && (
                <ViewField label="Verified On" value={fmtDate(s.bank_verified_at)} />
              )}
            </div>
          </div>

          {/* Documents (read-only) */}
          <div>
            <div className="overline text-[10px] mb-2 flex items-center gap-2">
              Documents <span className="text-[10px] text-[var(--muted)] normal-case">({docs.length} uploaded)</span>
              {busy && <span className="text-[10px] text-[var(--muted)] normal-case">loading…</span>}
            </div>
            {docs.length === 0 ? (
              <div className="text-xs text-[var(--muted)] py-2">No documents uploaded yet.</div>
            ) : (
              <div className="border border-[var(--border)] divide-y divide-[var(--border)] max-h-56 overflow-y-auto" data-testid="view-docs-list">
                {docs.map((d) => (
                  <div key={d.id} className="p-2 text-sm flex items-center justify-between gap-2" data-testid={`view-doc-${d.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{d.title || d.filename}</div>
                      <div className="text-[10px] text-[var(--muted)] capitalize">
                        {d.doc_type || "document"} · uploaded {new Date(d.uploaded_at).toLocaleDateString()}
                      </div>
                    </div>
                    <a
                      href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(d.file_path)}`}
                      target="_blank" rel="noreferrer"
                      className="text-[var(--brand)] text-xs hover:underline inline-flex items-center gap-1"
                    >
                      <Eye size={12} /> View
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-none" data-testid="staff-view-close">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewField({ label, value, mono, multiline, testid }) {
  return (
    <div data-testid={testid}>
      <div className="overline text-[9px]">{label}</div>
      <div className={`text-sm mt-0.5 ${mono ? "font-mono" : ""} ${multiline ? "whitespace-pre-wrap" : "truncate"}`}>{value}</div>
    </div>
  );
}

/* ============================================================
   PAYROLL BATCH WORKFLOW COMPONENTS (Phase 55)
   ============================================================ */
const BATCH_STATUS_TONE = {
  pending_approval: { cls: "bg-amber-100 text-amber-700 border-amber-300", label: "Pending Approval" },
  approved:        { cls: "bg-blue-100 text-blue-700 border-blue-300",   label: "Approved" },
  pending_payment: { cls: "bg-indigo-100 text-indigo-700 border-indigo-300", label: "Accounts Pending Payment" },
  processing:      { cls: "bg-cyan-100 text-cyan-700 border-cyan-300",   label: "Processing" },
  paid:            { cls: "bg-emerald-100 text-emerald-700 border-emerald-300", label: "Paid" },
  rejected:        { cls: "bg-red-100 text-red-700 border-red-300",       label: "Rejected" },
  reopened:        { cls: "bg-orange-100 text-orange-700 border-orange-300", label: "Reopened" },
};

function PayrollBatchStatusCard({ batch, onOpen }) {
  const tone = BATCH_STATUS_TONE[batch.status] || { cls: "bg-gray-100 text-gray-700 border-gray-300", label: batch.status };
  const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  return (
    <div className="swiss-card p-4 border-l-4 border-purple-500" data-testid="payroll-batch-status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="overline text-[10px]">Payroll Batch · {String(batch.month).padStart(2, "0")}/{batch.year}</div>
            <div className="text-xs mt-0.5">
              <span className="font-heading font-bold text-sm">{batch.staff_count} staff</span>
              <span className="text-[var(--muted)]"> · Net {inr(batch.net_payable)}</span>
              {batch.finalised_by_name && <span className="text-[var(--muted)]"> · Finalised by {batch.finalised_by_name}</span>}
            </div>
          </div>
          <span className={`inline-block text-[10px] font-bold uppercase px-2 py-0.5 border ${tone.cls}`} data-testid="batch-status-chip">{tone.label}</span>
        </div>
        <Button onClick={onOpen} size="sm" className="rounded-none brand-btn" data-testid="open-payroll-batch">
          <Receipt size={12} className="mr-1" /> Open Batch
        </Button>
      </div>
    </div>
  );
}

function PayrollBatchDialog({ batchId, onClose, currentUser }) {
  const [batch, setBatch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ method: "neft", payment_date: new Date().toISOString().slice(0, 10), utr: "", remarks: "" });
  const [bankAccounts, setBankAccounts] = useState([]);

  const load = React.useCallback(async () => {
    if (!batchId) { setBatch(null); return; }
    try {
      const { data } = await api.get(`/payroll-batches/${batchId}`);
      setBatch(data);
    } catch (e) { toast.error(formatError(e)); }
  }, [batchId]);

  useEffect(() => {
    if (!batchId) return;
    load();
    api.get("/bank-accounts").then((r) => setBankAccounts(r.data || [])).catch(() => {});
  }, [batchId, load]);

  if (!batchId) return null;
  const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const tone = batch ? (BATCH_STATUS_TONE[batch.status] || { cls: "bg-gray-100 text-gray-700 border-gray-300", label: batch.status }) : null;
  const isAdmin = currentUser?.role === "admin";
  const isAccountant = currentUser?.role === "accountant";
  const canPay = (isAdmin || isAccountant) && batch?.status === "pending_payment";
  const canReopen = isAdmin && ["paid", "pending_payment", "approved", "rejected", "processing"].includes(batch?.status);

  const submitPay = async () => {
    if (!payForm.payment_date) { toast.error("Payment date is required"); return; }
    setBusy(true);
    try {
      await api.post(`/payroll-batches/${batchId}/pay`, payForm);
      toast.success("Payment recorded — transaction created");
      setPayOpen(false);
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const submitReopen = async () => {
    const reason = window.prompt("Reason for reopening this batch? (audit trail)", "") || "";
    if (!window.confirm(
      batch.status === "paid"
        ? "This will REVERSE the linked transaction and unlock all payroll rows so HR can re-edit. Continue?"
        : "This will unlock all payroll rows so HR can re-edit. Continue?"
    )) return;
    setBusy(true);
    try {
      await api.post(`/payroll-batches/${batchId}/reopen`, { reason, reverse_transaction: true });
      toast.success("Batch reopened — rows unlocked");
      onClose?.();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!batchId} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="rounded-none max-w-4xl" data-testid="payroll-batch-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2 text-lg">
            Payroll Batch · {batch ? `${String(batch.month).padStart(2, "0")}/${batch.year}` : "…"}
            {batch && tone && (
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 border ${tone.cls}`} data-testid="batch-detail-status">{tone.label}</span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--muted)]">
            Approval workflow, staff-wise breakdown and payment audit for the selected batch.
          </DialogDescription>
        </DialogHeader>

        {!batch ? (
          <div className="py-8 text-center text-sm text-[var(--muted)]">Loading…</div>
        ) : (
          <div className="space-y-4 max-h-[68vh] overflow-y-auto pr-1">
            {/* Totals strip */}
            <div className="grid grid-cols-4 gap-0 border border-[var(--border)] bg-white" data-testid="batch-totals">
              <TotalCell label="Staff Count" value={batch.staff_count} tone="bg-slate-50" />
              <TotalCell label="Gross" value={inr(batch.gross)} tone="bg-slate-50" />
              <TotalCell label="Deductions" value={`- ${inr(batch.deductions)}`} tone="bg-red-50 text-red-800" />
              <TotalCell label="Net Payable" value={inr(batch.net_payable)} tone="bg-emerald-50 text-emerald-800" bold />
            </div>

            {/* Payment info (if paid) */}
            {batch.payment && (
              <div className="swiss-card p-3 border-l-4 border-emerald-500" data-testid="batch-payment-details">
                <div className="overline text-[10px] mb-1">Payment Details</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div><div className="overline text-[9px]">Method</div><div className="uppercase font-semibold">{batch.payment.method}</div></div>
                  <div><div className="overline text-[9px]">Date</div><div>{batch.payment.payment_date}</div></div>
                  <div><div className="overline text-[9px]">UTR / Ref</div><div className="font-mono">{batch.payment.utr || "—"}</div></div>
                  <div><div className="overline text-[9px]">Txn ID</div><div className="font-mono truncate text-[10px]">{batch.transaction_id || "—"}</div></div>
                  {batch.payment.remarks && <div className="col-span-2 md:col-span-4"><div className="overline text-[9px]">Remarks</div><div>{batch.payment.remarks}</div></div>}
                </div>
              </div>
            )}

            {/* Staff-wise table */}
            <div>
              <div className="overline text-[10px] mb-2">Staff-wise Breakdown</div>
              <div className="max-h-64 overflow-y-auto border border-[var(--border)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-[var(--border)] overline text-[10px]">
                    <tr>
                      <th className="text-left p-2">Emp Code</th>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Bank A/c</th>
                      <th className="text-right p-2">Gross</th>
                      <th className="text-right p-2">Deduct</th>
                      <th className="text-right p-2">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(batch.rows || []).map((r) => (
                      <tr key={r.id} className="border-b border-[var(--border)]" data-testid={`batch-row-${r.id}`}>
                        <td className="p-2 font-mono text-[10px]">{r.employee_code || "—"}</td>
                        <td className="p-2">{r.staff_name || r.staff_id?.slice(0, 8)}</td>
                        <td className="p-2 font-mono text-[10px]">{r.bank_account_no_masked || "—"} <span className="text-[var(--muted)]">{r.ifsc || ""}</span></td>
                        <td className="p-2 text-right num">{inr(r.gross)}</td>
                        <td className="p-2 text-right num text-red-600">-{inr(r.deductions)}</td>
                        <td className="p-2 text-right num font-semibold">{inr(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audit log */}
            <div>
              <div className="overline text-[10px] mb-2">Audit Trail</div>
              <div className="border border-[var(--border)] divide-y divide-[var(--border)] max-h-40 overflow-y-auto" data-testid="batch-audit">
                {(batch.audit_log || []).map((a, i) => (
                  <div key={i} className="p-2 text-xs flex items-start gap-2">
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-slate-100 text-slate-700">{a.action}</span>
                    <div className="flex-1">
                      <div className="font-medium">{a.by_name || a.by} <span className="text-[var(--muted)] font-normal">· {new Date(a.at).toLocaleString()}</span></div>
                      <div className="text-[var(--muted)]">
                        {a.old_status} → <span className="font-semibold text-slate-700">{a.new_status}</span>
                        {a.remarks && <span> · {a.remarks}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose} className="rounded-none" data-testid="batch-close">Close</Button>
          {canReopen && (
            <Button onClick={submitReopen} disabled={busy} variant="outline" className="rounded-none border-orange-500 text-orange-700 hover:bg-orange-50" data-testid="batch-reopen">
              <RefreshCw size={13} className="mr-1" /> Reopen (Admin)
            </Button>
          )}
          {canPay && (
            <Button onClick={() => setPayOpen(true)} disabled={busy} className="rounded-none bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="batch-pay-open">
              <Wallet size={13} className="mr-1" /> Process Payment
            </Button>
          )}
        </DialogFooter>

        {/* Payment sub-dialog */}
        <Dialog open={payOpen} onOpenChange={setPayOpen}>
          <DialogContent className="rounded-none max-w-md" data-testid="batch-pay-dialog">
            <DialogHeader>
              <DialogTitle className="font-heading">Record Payroll Payment</DialogTitle>
              <DialogDescription className="text-xs text-[var(--muted)]">
                {batch ? `Net payable ${inr(batch.net_payable)} for ${batch.staff_count} staff.` : ""} This creates a Transaction entry linked to this batch and marks each employee as paid.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="overline">Payment Method</Label>
                  <Select value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v })}>
                    <SelectTrigger className="rounded-none h-10" data-testid="pay-method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="neft">NEFT</SelectItem>
                      <SelectItem value="rtgs">RTGS</SelectItem>
                      <SelectItem value="imps">IMPS</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline">Payment Date</Label>
                  <Input type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} className="rounded-none h-10" data-testid="pay-date" />
                </div>
              </div>
              <div>
                <Label className="overline">Bank Account (debit)</Label>
                <Select value={payForm.bank_account_id || "__none"} onValueChange={(v) => setPayForm({ ...payForm, bank_account_id: v === "__none" ? "" : v })}>
                  <SelectTrigger className="rounded-none h-10" data-testid="pay-bank"><SelectValue placeholder="Optional — select bank/cash account" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— None —</SelectItem>
                    {bankAccounts.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name} · {b.account_number ? `****${b.account_number.slice(-4)}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="overline">Transaction / UTR Reference</Label>
                <Input value={payForm.utr} onChange={(e) => setPayForm({ ...payForm, utr: e.target.value })} placeholder="e.g. UTR12345678" className="rounded-none h-10 font-mono" data-testid="pay-utr" />
              </div>
              <div>
                <Label className="overline">Remarks</Label>
                <Textarea value={payForm.remarks} onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })} rows={2} className="rounded-none" data-testid="pay-remarks" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayOpen(false)} className="rounded-none">Cancel</Button>
              <Button onClick={submitPay} disabled={busy} className="rounded-none bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="pay-submit">Record Payment</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

const TotalCell = ({ label, value, tone, bold }) => (
  <div className={`px-3 py-2 ${tone || ""}`}>
    <div className="overline text-[9px]">{label}</div>
    <div className={`text-lg font-heading ${bold ? "font-black" : "font-bold"} num mt-0.5`}>{value}</div>
  </div>
);

/* ============================================================
   PAYROLL REDESIGN COMPONENTS (Phase 56)
   Pure UI/UX — every call reuses existing handlers + state.
   ============================================================ */

// Month picker as a single dropdown-like control (fixes the "July selected but
// August data" confusion the user reported).
const _MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function PayrollPeriodPicker({ month, year, onChange }) {
  const label = `${_MONTHS[month - 1]} ${year}`;
  const years = [];
  for (let y = year + 1; y >= year - 3; y--) years.push(y);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center gap-2 text-2xl font-heading font-black tracking-tight text-slate-900 hover:text-blue-700 transition-colors"
          data-testid="payroll-period-picker"
        >
          {label}
          <ChevronDown size={20} className="text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="rounded-md p-2 min-w-[260px]" data-testid="payroll-period-menu">
        <div className="grid grid-cols-4 gap-1 mb-2">
          {_MONTHS.map((m, i) => (
            <button
              key={m}
              onClick={() => onChange(i + 1, year)}
              className={`h-8 rounded text-xs font-semibold ${(i + 1 === month) ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
              data-testid={`period-month-${i + 1}`}
            >{m}</button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1 border-t border-slate-100 pt-2">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => onChange(month, y)}
              className={`h-8 rounded text-xs font-semibold ${(y === year) ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
              data-testid={`period-year-${y}`}
            >{y}</button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Compact ₹ formatting for KPI cards — "8.42L", "1.24Cr" etc.
function _inrCompact(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
}

function _payrollStage(p) {
  // Derive a UI stage from raw payroll fields + attendance signals.
  if (p.status === "paid") return "paid";
  const present = (p.present_days ?? p.days_present) || 0;
  const paidLv = p.paid_leave_days || 0;
  const half = p.half_days || 0;
  const workedFraction = present + paidLv + half;
  if (workedFraction === 0) return "issue"; // zero-attendance draft
  if (p.unmarked_absent_days > 0) return "issue"; // missing punches
  if ((p.deductions || 0) > (p.gross || 0)) return "issue"; // deductions > gross
  if (p.slip_released_at) return "ready";
  if (p.locked || p.batch_status === "pending_approval") return "review";
  return "pending"; // draft, still editable
}

function _countPayroll(rows) {
  const c = { all: rows.length, issues: 0, pending: 0, ready: 0, paid: 0 };
  for (const p of rows) {
    const s = _payrollStage(p);
    if (s === "issue") c.issues++;
    else if (s === "pending" || s === "review") c.pending++;
    else if (s === "ready") c.ready++;
    else if (s === "paid") c.paid++;
  }
  return c;
}

function _applyPayrollFilters(rows, hideZero, quick) {
  let out = rows;
  if (hideZero) {
    out = out.filter((p) => {
      const present = (p.present_days ?? p.days_present) || 0;
      const paidLv = p.paid_leave_days || 0;
      const hasAny = present + paidLv + (p.half_days || 0) > 0;
      return hasAny || p.status !== "draft";
    });
  }
  if (quick && quick !== "all") {
    out = out.filter((p) => {
      const s = _payrollStage(p);
      if (quick === "issues") return s === "issue";
      if (quick === "pending") return s === "pending" || s === "review";
      if (quick === "ready") return s === "ready";
      if (quick === "paid") return s === "paid";
      return true;
    });
  }
  return out;
}

function QuickFilterChips({ value, onChange, counts }) {
  const chips = [
    { key: "all",     label: "All",         count: counts.all,     tone: "bg-slate-100 text-slate-700" },
    { key: "issues",  label: "Issues",      count: counts.issues,  tone: "bg-red-50 text-red-700" },
    { key: "pending", label: "Pending",     count: counts.pending, tone: "bg-amber-50 text-amber-800" },
    { key: "ready",   label: "Ready to Pay",count: counts.ready,   tone: "bg-blue-50 text-blue-700" },
    { key: "paid",    label: "Paid",        count: counts.paid,    tone: "bg-emerald-50 text-emerald-700" },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="payroll-quick-chips">
      {chips.map((c) => {
        const active = value === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onChange(c.key)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${active ? "bg-slate-900 text-white border-slate-900" : `${c.tone} border-transparent hover:border-slate-300`}`}
            data-testid={`chip-${c.key}`}
          >
            {c.label}
            <span className={`px-1.5 py-0 rounded-full text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-white/70 text-slate-700"}`}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function PayrollSummary({ payroll, total }) {
  const totalStaff = total;
  const processed = payroll.filter((p) => p.status === "paid").length;
  const rowsForCounts = payroll;
  const c = _countPayroll(rowsForCounts);
  const gross = rowsForCounts.reduce((s, p) => s + (p.gross || 0), 0);
  const net = rowsForCounts.reduce((s, p) => s + (p.net || 0), 0);
  const pct = totalStaff > 0 ? Math.round((processed / totalStaff) * 100) : 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="payroll-summary-cards">
      <SummaryTile label="Total Employees" value={totalStaff} tone="text-slate-900" ring="ring-slate-200" testid="kpi-total" />
      <SummaryTile label="Processed"        value={processed} tone="text-emerald-700" ring="ring-emerald-200" testid="kpi-processed" />
      <SummaryTile label="Pending"          value={c.pending} tone="text-amber-700"  ring="ring-amber-200"  testid="kpi-pending" />
      <SummaryTile label="Attendance Issues" value={c.issues}  tone="text-red-700"     ring="ring-red-200"     testid="kpi-issues" />
      <SummaryTile label="Gross Payroll"    value={_inrCompact(gross)} tone="text-slate-900" ring="ring-slate-200" testid="kpi-gross" hint={`Total gross across ${payroll.length} rows`} />
      <SummaryTile label="Net Payable"      value={_inrCompact(net)}   tone="text-blue-700"  ring="ring-blue-200"  testid="kpi-net" hint="Sum of net pay across rows" />
      <div className="col-span-full bg-white border border-slate-200 rounded-lg p-4" data-testid="payroll-progress">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Payroll Processing</div>
            <div className="text-lg font-heading font-bold text-slate-900">{pct}% Complete <span className="text-sm text-slate-500 font-normal">· {processed} of {totalStaff} employees</span></div>
          </div>
          {c.issues > 0 && (
            <div className="inline-flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded-md">
              <AlertCircle size={14} className="mt-[1px]" />
              <span>
                <b>{c.issues}</b> employee{c.issues === 1 ? "" : "s"} need attention — attendance or salary issues detected.
              </span>
            </div>
          )}
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone, ring, testid, hint }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-lg p-3 ring-1 ring-inset ${ring}`} data-testid={testid} title={hint}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-2xl font-heading font-black leading-tight mt-1 ${tone}`}>{value}</div>
    </div>
  );
}

// Status pill mapped to enterprise-grade labels.
function PayrollStatusPill({ p }) {
  const s = _payrollStage(p);
  const map = {
    paid:    { cls: "bg-emerald-100 text-emerald-800 border-emerald-200", label: "Paid" },
    ready:   { cls: "bg-blue-100 text-blue-800 border-blue-200",         label: "Ready to Pay" },
    issue:   { cls: "bg-red-100 text-red-800 border-red-200",             label: "Issue" },
    review:  { cls: "bg-indigo-100 text-indigo-800 border-indigo-200",   label: "Pending Review" },
    pending: { cls: "bg-amber-100 text-amber-800 border-amber-200",       label: "Draft" },
  };
  const e = map[s] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${e.cls}`} data-testid={`status-pill-${p.id}`}>
      {e.label}
    </span>
  );
}

// Attendance display — "X / Y days" + issue chip.
function AttendanceCell({ p }) {
  const present = (p.present_days ?? p.days_present) || 0;
  const working = p.working_days || 0;
  const unmarked = p.unmarked_absent_days || 0;
  const paidLv = p.paid_leave_days || 0;
  const unpaidLv = p.unpaid_leave_days || 0;
  const late = p.late_days || 0;
  const hasIssue = unmarked > 0 || (present + paidLv + (p.half_days || 0) === 0 && p.status === "draft");
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-900 num">{present} / {working} <span className="text-slate-500 font-normal">days</span></span>
        {hasIssue ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded" title="Missing attendance / zero-day">
            <AlertCircle size={10} /> {unmarked > 0 ? `${unmarked} Unmarked` : "Zero attendance"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700" title="All days accounted for">
            <CheckCircle2 size={10} /> Complete
          </span>
        )}
      </div>
      {(paidLv || unpaidLv || late) ? (
        <div className="text-[10px] text-slate-500 mt-0.5 flex gap-2">
          {paidLv > 0 && <span>PL {paidLv}</span>}
          {unpaidLv > 0 && <span className="text-amber-700">LOP {unpaidLv}</span>}
          {late > 0 && <span className="text-orange-600">Late {late}</span>}
        </div>
      ) : null}
    </div>
  );
}

function PayrollTableRow(props) {
  const {
    p, sName, isAdmin, isAccountant, userRole, canManageStaff, expanded, onToggleExpand,
    onSalary, onRecalc, onPrint, onSlipGenerate, onSlipDownload, onSlipRelease,
    onEdit, onPay, onEditPaid, onDelete,
  } = props;
  const stage = _payrollStage(p);
  const isPaid = p.status === "paid";
  const isIssue = stage === "issue";
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors" data-testid={`payroll-row-${p.id}`}>
        <td className="p-3">
          <button
            onClick={onToggleExpand}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-200 text-slate-500"
            data-testid={`expand-payroll-${p.id}`}
            aria-label={expanded ? "Collapse row" : "Expand row"}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="p-3">
          <div className="font-semibold text-slate-900">{p.staff_name || sName(p.staff_id)}</div>
          <div className="text-[10px] text-slate-500 font-mono">{p.employee_code || ""}</div>
        </td>
        <td className="p-3"><AttendanceCell p={p} /></td>
        <td className="p-3 text-right"><span className="text-sm text-slate-900 num">{inr(p.gross)}</span></td>
        <td className="p-3 text-right"><span className="text-sm num text-red-600">{p.deductions ? `− ${inr(p.deductions)}` : "—"}</span></td>
        <td className="p-3 text-right"><span className="text-base font-heading font-bold text-slate-900 num">{inr(p.net)}</span></td>
        <td className="p-3"><PayrollStatusPill p={p} /></td>
        <td className="p-3 text-right no-print">
          <div className="flex items-center justify-end gap-1.5">
            {isPaid ? (
              <Button size="sm" variant="outline" onClick={onSalary} className="rounded-md h-8 px-3 text-xs" data-testid={`view-detail-${p.id}`}>
                View Payroll
              </Button>
            ) : isIssue ? (
              <Button
                size="sm"
                onClick={onSalary}
                className="rounded-md h-8 px-3 text-xs bg-red-50 border border-red-300 text-red-700 hover:bg-red-100"
                data-testid={`resolve-issues-${p.id}`}
                title="Attendance or salary issue — resolve before paying"
              >
                <AlertCircle size={12} className="mr-1" /> Resolve Issues
              </Button>
            ) : (
              (isAdmin || isAccountant || userRole === "hr") && (
                <Button size="sm" onClick={onPay} className="rounded-md h-8 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white" data-testid={`pay-payroll-${p.id}`}>
                  Pay
                </Button>
              )
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-100"
                  aria-label="More actions"
                  data-testid={`row-menu-${p.id}`}
                >
                  <MoreVertical size={14} className="text-slate-600" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-md">
                <DropdownMenuItem onClick={onSalary} data-testid={`menu-salary-${p.id}`}><User size={13} className="mr-2" /> Salary Breakdown</DropdownMenuItem>
                <DropdownMenuItem onClick={onPrint} data-testid={`payslip-pdf-${p.id}`}><FileText size={13} className="mr-2" /> Print Payslip</DropdownMenuItem>
                {p.status === "draft" && canManageStaff && (
                  <DropdownMenuItem onClick={onRecalc} data-testid={`recalc-payroll-${p.id}`}><TrendingUp size={13} className="mr-2" /> Recalculate</DropdownMenuItem>
                )}
                {(isAdmin || isAccountant || userRole === "hr") && !p.slip_id && (
                  <DropdownMenuItem onClick={onSlipGenerate} data-testid={`slip-gen-${p.id}`}><Receipt size={13} className="mr-2" /> Generate Slip</DropdownMenuItem>
                )}
                {p.slip_id && (
                  <DropdownMenuItem onClick={onSlipDownload} data-testid={`slip-dl-${p.id}`}><FileDown size={13} className="mr-2" /> Download Slip</DropdownMenuItem>
                )}
                {p.slip_id && (isAdmin || userRole === "hr") && (
                  <DropdownMenuItem onClick={onSlipRelease} data-testid={`slip-release-${p.id}`}>
                    <Mail size={13} className="mr-2" /> {p.slip_released_at ? "Un-release Slip" : "Release Slip"}
                  </DropdownMenuItem>
                )}
                {!isPaid && canManageStaff && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onEdit} data-testid={`edit-payroll-${p.id}`}><Pencil size={13} className="mr-2" /> Edit Payroll</DropdownMenuItem>
                  </>
                )}
                {isPaid && isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onEditPaid} className="text-orange-700" data-testid={`edit-paid-${p.id}`}>
                      <Pencil size={13} className="mr-2" /> Reopen + Edit (Admin)
                    </DropdownMenuItem>
                  </>
                )}
                {isAdmin && (
                  <DropdownMenuItem onClick={onDelete} className="text-red-700" data-testid={`delete-payroll-${p.id}`}>
                    <Trash2 size={13} className="mr-2" /> Delete Row
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/60 border-b border-slate-200" data-testid={`payroll-expand-${p.id}`}>
          <td></td>
          <td colSpan={7} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Salary Breakdown</div>
                <dl className="text-xs space-y-1.5">
                  <BreakRow label="Basic" value={inr(p.basic)} />
                  {p.hra ? <BreakRow label="HRA" value={inr(p.hra)} /> : null}
                  {p.da ? <BreakRow label="DA" value={inr(p.da)} /> : null}
                  {p.conveyance ? <BreakRow label="Conveyance" value={inr(p.conveyance)} /> : null}
                  {p.bonus ? <BreakRow label="Bonus" value={inr(p.bonus)} /> : null}
                  {p.incentive ? <BreakRow label="Incentive" value={inr(p.incentive)} /> : null}
                  <BreakRow label="Gross Salary" value={inr(p.gross)} bold />
                  {p.pf ? <BreakRow label="PF" value={`− ${inr(p.pf)}`} tone="text-red-600" /> : null}
                  {p.esi ? <BreakRow label="ESI" value={`− ${inr(p.esi)}`} tone="text-red-600" /> : null}
                  {p.tds ? <BreakRow label="TDS" value={`− ${inr(p.tds)}`} tone="text-red-600" /> : null}
                  {p.other_deduction ? <BreakRow label="Other" value={`− ${inr(p.other_deduction)}`} tone="text-red-600" /> : null}
                  {p.advance_recovery ? <BreakRow label="Advance Recovery" value={`− ${inr(p.advance_recovery)}`} tone="text-red-600" /> : null}
                  <BreakRow label="Total Deductions" value={p.deductions ? `− ${inr(p.deductions)}` : "—"} tone="text-red-700" bold />
                  <BreakRow label="Net Salary" value={inr(p.net)} bold big />
                </dl>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Attendance Summary</div>
                <dl className="text-xs space-y-1.5">
                  <BreakRow label="Present"  value={p.present_days ?? p.days_present ?? 0} />
                  <BreakRow label="Working days" value={p.working_days || "—"} />
                  <BreakRow label="Half day" value={p.half_days || 0} />
                  <BreakRow label="Paid leave" value={p.paid_leave_days || 0} />
                  <BreakRow label="LOP (unpaid leave)" value={p.unpaid_leave_days || 0} tone={p.unpaid_leave_days ? "text-amber-700" : ""} />
                  <BreakRow label="Late" value={p.late_days || 0} tone={p.late_days ? "text-orange-600" : ""} />
                  <BreakRow label="Unmarked / Absent" value={p.unmarked_absent_days || 0} tone={p.unmarked_absent_days ? "text-red-700" : ""} />
                  <BreakRow label="Payable days" value={p.payable_days ?? "—"} bold />
                </dl>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function BreakRow({ label, value, bold, big, tone }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "border-t border-slate-200 pt-1.5 mt-1" : ""}`}>
      <dt className={`text-slate-600 ${bold ? "font-semibold text-slate-800" : ""}`}>{label}</dt>
      <dd className={`num ${bold ? "font-heading font-bold" : ""} ${big ? "text-base text-slate-900" : ""} ${tone || ""}`}>{value}</dd>
    </div>
  );
}

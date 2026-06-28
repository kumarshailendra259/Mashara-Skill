import React, { useEffect, useRef, useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Check, X, CalendarCheck, CalendarDays, Upload, Trash2, Paperclip, Pencil, Download, FileText, GitMerge, Archive } from "lucide-react";
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

export default function HRMS() {
  const { t } = useLang();
  const { user } = useAuth();
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
    user_id: "", email: "", mobile: "",
    center_id: "", shift_id: "",
    date_of_birth: "", gender: "", address: "",
    pan: "", aadhaar_last4: "",
    emergency_contact_name: "", emergency_contact_mobile: "",
    bank_account_no: "", bank_name: "", ifsc: "", account_holder_name: "",
    create_login: false,
  };
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [editingStaffId, setEditingStaffId] = useState(null);

  const [openR, setOpenR] = useState(false);
  const [rForm, setRForm] = useState({ staff_id: "", amount: "", date: new Date().toISOString().slice(0,10), category: "", description: "", attachments: [] });
  const reimbFileRef = useRef(null);
  const [reimbUploading, setReimbUploading] = useState(false);

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

  const canMarkAttendance = isAdmin || user?.role === "manager" || user?.role === "center_manager";

  const loadAll = () => Promise.all([
    api.get("/staff"), api.get("/reimbursements"), api.get("/payroll"), api.get("/leaves"),
    api.get("/entities/center"), api.get("/shifts").catch(() => ({ data: [] })),
    api.get("/leave-types").catch(() => ({ data: [] })),
  ]).then(([s, r, p, lv, c, sh, lt]) => {
    setStaff(s.data); setReimbs(r.data); setPayroll(p.data); setLeaves(lv.data);
    setCenters(c.data); setShifts(sh.data); setLeaveTypes(lt.data);
  });

  useEffect(() => { loadAll(); }, []);

  // Load attendance for selected date
  useEffect(() => {
    if (!attDate) return;
    api.get(`/attendance?start=${attDate}&end=${attDate}`).then((res) => {
      const m = {};
      (res.data || []).forEach((a) => { m[a.staff_id] = a.status; });
      setAttMap(m);
    }).catch(() => {});
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
    });
    setOpenS(true);
  };

  const openAddStaff = () => {
    setEditingStaffId(null);
    setStaffForm(emptyStaffForm);
    setOpenS(true);
  };

  const deleteStaff = async (s) => {
    if (!window.confirm(`Delete staff "${s.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/staff/${s.id}`);
      toast.success("Deleted");
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
    try { const r = await api.post(`/payroll/run?month=${pMonth}&year=${pYear}`); loadAll(); toast.success(`Created ${r.data.created}`); }
    catch (e) { toast.error(formatError(e)); }
  };

  const payPayroll = async (id) => {
    try { await api.patch(`/payroll/${id}/pay`); loadAll(); toast.success("Paid"); }
    catch (e) { toast.error(formatError(e)); }
  };

  const sName = (id) => staff.find((s) => s.id === id)?.name || "—";

  return (
    <div className="space-y-5" data-testid="hrms-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">HRMS · Payroll</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">HRMS &amp; Payroll</h1>
        </div>
        <PrintButton />
      </div>

      <Tabs defaultValue="reimb">
        <TabsList className="rounded-none bg-transparent border-b border-[var(--border)] p-0 h-auto">
          <TabsTrigger value="reimb" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand)] data-[state=active]:text-[var(--brand)] px-4 py-2">Reimbursements</TabsTrigger>
          <TabsTrigger value="staff" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand)] data-[state=active]:text-[var(--brand)] px-4 py-2">Staff</TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand)] data-[state=active]:text-[var(--brand)] px-4 py-2" data-testid="tab-attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leaves" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand)] data-[state=active]:text-[var(--brand)] px-4 py-2" data-testid="tab-leaves">Leaves</TabsTrigger>
          <TabsTrigger value="payroll" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand)] data-[state=active]:text-[var(--brand)] px-4 py-2">Payroll</TabsTrigger>
        </TabsList>

        {/* Reimbursements */}
        <TabsContent value="reimb" className="mt-4 space-y-4">
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
                    <td className="p-3 text-[var(--muted)]">{r.category || "—"}{r.attachments?.length ? <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--brand)] border border-[var(--brand)] px-1 py-0.5" title={`${r.attachments.length} attachments`}><Paperclip size={10} /> {r.attachments.length}</span> : null}</td>
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
          {canManageStaff && (
            <div className="flex justify-end gap-2">
              {isAdmin && selectedStaff.size > 0 && (
                <Button onClick={() => setBulkStaffOpen(true)} variant="outline" className="rounded-none gap-2 border-[var(--danger)] text-[var(--danger)] hover:bg-red-50" data-testid="bulk-archive-staff">
                  <Archive size={14} /> Archive ({selectedStaff.size})
                </Button>
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
                    <div className="pt-4 border-t border-[var(--border)]">
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
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Designation</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Mobile</th>
              <th className="text-left p-3">Bank</th>
              <th className="text-right p-3">Salary</th>
              <th className="text-right p-3">Per-Day</th>
              {canManageStaff && <th className="text-right p-3 no-print">Actions</th>}
            </tr></thead><tbody>
              {staff.length === 0 ? <tr><td colSpan={(canManageStaff ? 8 : 7) + (isAdmin ? 1 : 0)} className="text-center py-8 overline">No staff yet</td></tr> : staff.map((s) => (
                <tr key={s.id} className={`border-b border-[var(--border)] hover:bg-gray-50 ${s.is_active === false ? "opacity-50" : ""}`}>
                  {isAdmin && (
                    <td className="p-3">
                      <input type="checkbox" checked={selectedStaff.has(s.id)} onChange={() => toggleStaff(s.id)} className="cursor-pointer" data-testid={`select-staff-${s.id}`} />
                    </td>
                  )}
                  <td className="p-3 font-medium">
                    {s.name}
                    {s.is_active === false && <span className="ml-2 text-xs text-[var(--muted)]">(archived)</span>}
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
                  {canManageStaff && (
                    <td className="p-3 text-right no-print">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => openEditStaff(s)} className="rounded-none h-8 px-2" data-testid={`staff-edit-${s.id}`} title="Edit"><Pencil size={14} /></Button>
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

          <div className="swiss-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
                <th className="text-left p-3">Staff</th>
                <th className="text-left p-3">Designation</th>
                <th className="text-left p-3 w-64">Status</th>
              </tr></thead>
              <tbody>
                {staff.length === 0 ? <tr><td colSpan={3} className="text-center py-8 overline">No staff yet</td></tr> : staff.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                    <td className="p-3 font-medium">{s.name}</td>
                    <td className="p-3 text-[var(--muted)]">{s.designation}</td>
                    <td className="p-3">
                      {canMarkAttendance ? (
                        <Select value={attMap[s.id] || ""} onValueChange={(v) => setAtt(s.id, v)}>
                          <SelectTrigger className="rounded-none h-9" data-testid={`att-status-${s.id}`}><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="present">Present</SelectItem>
                            <SelectItem value="absent">Absent</SelectItem>
                            <SelectItem value="half">Half Day</SelectItem>
                            <SelectItem value="leave">Leave</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="overline">{attMap[s.id] || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="swiss-card overflow-x-auto">
            <div className="px-3 pt-3 overline">Recent (last 30 days from {attDate})</div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Staff</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Source</th>
                <th className="text-left p-3">Location</th>
                <th className="text-left p-3">Selfie</th>
              </tr></thead>
              <tbody>
                {attRecent.length === 0 ? <tr><td colSpan={6} className="text-center py-8 overline">No records</td></tr> : attRecent.map((a) => (
                  <tr key={a.id || `${a.staff_id}-${a.date}`} className="border-b border-[var(--border)] hover:bg-gray-50">
                    <td className="p-3 num">{a.date}</td>
                    <td className="p-3">{sName(a.staff_id)}</td>
                    <td className="p-3"><span className="overline">{a.status}</span></td>
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
                ))}
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

        {/* Payroll */}
        <TabsContent value="payroll" className="mt-4 space-y-4">
          {(isAdmin || isAccountant) && (
            <div className="swiss-card p-4 flex items-end gap-3 flex-wrap">
              <div><Label className="overline">Month</Label><Input type="number" min={1} max={12} value={pMonth} onChange={(e) => setPMonth(+e.target.value)} className="rounded-none w-24" /></div>
              <div><Label className="overline">Year</Label><Input type="number" value={pYear} onChange={(e) => setPYear(+e.target.value)} className="rounded-none w-28" /></div>
              <Button onClick={runPayroll} className="brand-btn rounded-none" data-testid="run-payroll">Run Payroll</Button>
              <Button onClick={() => downloadBankCsv(pMonth, pYear)} variant="outline" className="rounded-none gap-2" data-testid="bank-csv-btn"><Download size={14} /> Bank Transfer CSV</Button>
            </div>
          )}
          <div className="swiss-card overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3">Period</th><th className="text-left p-3">Staff</th>
              <th className="text-right p-3">Days</th><th className="text-right p-3">Late Days</th>
              <th className="text-right p-3">Gross</th><th className="text-right p-3">Deduct</th>
              <th className="text-right p-3">Net</th><th className="text-left p-3">Status</th>
              <th className="text-right p-3 w-32 no-print">Action</th>
            </tr></thead><tbody>
              {payroll.length === 0 ? <tr><td colSpan={9} className="text-center py-8 overline">No payroll yet</td></tr> : payroll.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                  <td className="p-3 num">{p.month}/{p.year}</td>
                  <td className="p-3">{p.staff_name || sName(p.staff_id)}</td>
                  <td className="p-3 num">{p.days_present} / {p.working_days}</td>
                  <td className="p-3 num text-xs">
                    {p.late_days ? (
                      <span title={`<2h: ${p.late_buckets?.minor || 0} · 2-6h: ${p.late_buckets?.half_day || 0} · ≥6h: ${p.late_buckets?.full_day || 0}`}>{p.late_days}</span>
                    ) : "—"}
                  </td>
                  <td className="p-3 num">{inr(p.gross)}</td>
                  <td className="p-3 num text-[var(--danger)]">{p.deductions ? inr(p.deductions) : "—"}</td>
                  <td className="p-3 num font-medium">{inr(p.net)}</td>
                  <td className="p-3"><span className={`inline-block px-2 py-0.5 text-xs border ${p.status === "paid" ? "border-[var(--success)] text-[var(--success)]" : "border-[var(--warning)] text-[#9a7a00]"}`}>{p.status}</span></td>
                  <td className="p-3 text-right no-print">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" onClick={() => printPayslip(p)} className="rounded-none h-8 px-2" title="Download payslip" data-testid={`payslip-pdf-${p.id}`}><FileText size={14} /></Button>
                      {p.status !== "paid" && canManageStaff && (
                        <Button size="sm" variant="outline" onClick={() => openEditPayroll(p)} className="rounded-none h-8 px-2" data-testid={`edit-payroll-${p.id}`} title="Edit"><Pencil size={14} /></Button>
                      )}
                      {p.status !== "paid" && (isAdmin || isAccountant) && (
                        <Button size="sm" onClick={() => payPayroll(p.id)} className="brand-btn rounded-none h-8 px-3" data-testid={`pay-payroll-${p.id}`}>Pay</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody></table></div>

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

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ArrowLeft, User, Briefcase, Building2, CalendarCheck, CalendarDays,
  Wallet, FileText, TrendingUp, Clock, ChevronLeft, ChevronRight, Mail,
} from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dash = (v) => (v == null || v === "" ? "—" : v);
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const EMP_TYPE = { full_time: "Full Time", part_time: "Part Time", contract: "Contract" };
const GENDER = { male: "Male", female: "Female", other: "Other", m: "Male", f: "Female" };

function Field({ label, value, testid }) {
  return (
    <div>
      <div className="overline text-[10px] text-[var(--muted)] mb-0.5">{label}</div>
      <div className="text-sm" data-testid={testid}>{value == null || value === "" ? "—" : value}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="section-empty">
      <Icon size={40} className="text-[var(--muted)] mb-3 opacity-50" />
      <div className="font-heading text-base">{title}</div>
      <div className="text-sm text-[var(--muted)] mt-1 max-w-sm">{subtitle}</div>
    </div>
  );
}

export default function StaffProfile() {
  const { sid } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const role = user?.role;
  const canViewSalary = ["admin", "hr", "accountant", "partner", "manager", "senior_manager"].includes(role);
  const canViewDocs = ["admin", "hr", "manager", "accountant"].includes(role);
  const canViewPII = ["admin", "hr", "accountant", "manager"].includes(role);

  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("basic");

  // section data
  const now = new Date();
  const [attMonth, setAttMonth] = useState(now.getMonth());
  const [attYear, setAttYear] = useState(now.getFullYear());
  const [attendance, setAttendance] = useState(null);
  const [leaves, setLeaves] = useState(null);
  const [payroll, setPayroll] = useState(null);
  const [docs, setDocs] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api.get(`/staff/${sid}/profile`);
        setS(r.data);
      } catch (e) {
        toast.error(formatError(e));
        setS(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [sid]);

  const loadAttendance = useCallback(async () => {
    const start = `${attYear}-${String(attMonth + 1).padStart(2, "0")}-01`;
    const endDate = new Date(attYear, attMonth + 1, 0).getDate();
    const end = `${attYear}-${String(attMonth + 1).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
    try {
      const r = await api.get(`/attendance`, { params: { staff_id: sid, start, end } });
      setAttendance(r.data || []);
    } catch (e) { toast.error(formatError(e)); setAttendance([]); }
  }, [sid, attMonth, attYear]);

  useEffect(() => { if (section === "attendance") loadAttendance(); }, [section, loadAttendance]);

  useEffect(() => {
    if (section === "leave" && leaves === null) {
      api.get(`/leaves`, { params: { staff_id: sid } }).then((r) => setLeaves(r.data || [])).catch((e) => { toast.error(formatError(e)); setLeaves([]); });
    }
    if (section === "payroll" && canViewSalary && payroll === null) {
      api.get(`/payroll`, { params: { staff_id: sid } }).then((r) => setPayroll(r.data || [])).catch((e) => { toast.error(formatError(e)); setPayroll([]); });
    }
    if (section === "documents" && canViewDocs && docs === null) {
      api.get(`/staff/${sid}/documents`).then((r) => setDocs(r.data || [])).catch((e) => { toast.error(formatError(e)); setDocs([]); });
    }
  }, [section, sid, leaves, payroll, docs, canViewSalary, canViewDocs]);

  if (loading) return <div className="p-8 text-sm text-[var(--muted)]">Loading profile…</div>;
  if (!s) return (
    <div className="p-8">
      <Button variant="outline" onClick={() => nav(-1)} className="rounded-none gap-2 mb-4"><ArrowLeft size={16} /> Back</Button>
      <div className="text-sm text-[var(--muted)]">Staff not found or you don't have access.</div>
    </div>
  );

  const isInactive = s.is_active === false || s.active === false;
  const reason = (s.exit_reason || "").toLowerCase();
  const empStatus = !isInactive ? "Active" : reason.includes("terminat") ? "Terminated" : reason.includes("resign") ? "Resigned" : "Inactive";
  const statusTone = empStatus === "Active" ? "text-emerald-700 bg-emerald-50 border-emerald-300"
    : empStatus === "Inactive" ? "text-slate-600 bg-slate-50 border-slate-300"
    : "text-red-700 bg-red-50 border-red-300";
  const initials = (s.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const empType = EMP_TYPE[s.employment_type] || "—";
  const gender = GENDER[(s.gender || "").toLowerCase()] || dash(s.gender);
  const roleLabel = s.user_role ? s.user_role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : dash(s.designation);

  const SECTIONS = [
    { id: "basic", label: "Basic Information", icon: User },
    { id: "hr", label: "HR Information", icon: Briefcase },
    { id: "mapping", label: "Center & Role Mapping", icon: Building2 },
    { id: "attendance", label: "Attendance", icon: CalendarCheck },
    { id: "leave", label: "Leave", icon: CalendarDays },
    ...(canViewSalary ? [{ id: "payroll", label: "Payroll", icon: Wallet }] : []),
    ...(canViewDocs ? [{ id: "documents", label: "Documents", icon: FileText }] : []),
    { id: "performance", label: "Performance", icon: TrendingUp },
    { id: "timeline", label: "Activity Timeline", icon: Clock },
  ];

  const attSummary = (attendance || []).reduce((acc, r) => {
    const st = r.effective_status || r.status || "absent";
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="staff-profile-page">
      <Button variant="outline" onClick={() => nav("/hrms")} className="rounded-none gap-2 mb-4" data-testid="profile-back"><ArrowLeft size={16} /> Back to HRMS</Button>

      {/* Header */}
      <div className="swiss-card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-5 mb-5">
        {s.photo_url ? (
          <img src={s.photo_url} alt={s.name} className="w-24 h-24 object-cover border border-[var(--border)]" data-testid="profile-photo" />
        ) : (
          <div className="w-24 h-24 flex items-center justify-center bg-[var(--brand)] text-white text-2xl font-heading" data-testid="profile-photo-fallback">{initials}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-heading truncate" data-testid="profile-name">{dash(s.name)}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 mt-2 text-sm">
            <div><span className="text-[var(--muted)]">Employee ID: </span><span className="font-mono text-[var(--brand)]">{dash(s.employee_code)}</span></div>
            <div><span className="text-[var(--muted)]">Center: </span>{dash(s.center_name)}</div>
            <div><span className="text-[var(--muted)]">Role: </span>{roleLabel}</div>
            <div className="flex items-center gap-1">
              <span className="text-[var(--muted)]">Status: </span>
              <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase border ${statusTone}`} data-testid="profile-status">{empStatus}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
        {/* Section nav */}
        <div className="swiss-card p-2 h-max md:sticky md:top-4">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const active = section === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setSection(sec.id)}
                data-testid={`profile-tab-${sec.id}`}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${active ? "bg-[var(--brand)] text-white" : "hover:bg-gray-50 text-[var(--fg)]"}`}
              >
                <Icon size={15} /> {sec.label}
              </button>
            );
          })}
        </div>

        {/* Section content */}
        <div className="swiss-card p-5 min-h-[320px]" data-testid={`profile-section-${section}`}>
          {section === "basic" && (
            <div>
              <div className="overline text-[var(--brand)] mb-4">Basic Information</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Full Name" value={dash(s.name)} testid="basic-name" />
                <Field label="Gender" value={gender} testid="basic-gender" />
                <Field label="Date of Birth" value={fmtDate(s.date_of_birth)} testid="basic-dob" />
                <Field label="Mobile" value={dash(s.mobile)} testid="basic-mobile" />
                <Field label="Email" value={dash(s.email)} testid="basic-email" />
                <Field label="Address" value={dash(s.address)} testid="basic-address" />
                {canViewPII && <Field label="PAN" value={dash(s.pan)} testid="basic-pan" />}
                {canViewPII && <Field label="Aadhaar (last 4)" value={dash(s.aadhaar_last4)} testid="basic-aadhaar" />}
                <Field label="Emergency Contact" value={dash(s.emergency_contact_name)} />
                <Field label="Emergency Mobile" value={dash(s.emergency_contact_mobile)} />
              </div>
            </div>
          )}

          {section === "hr" && (
            <div>
              <div className="overline text-[var(--brand)] mb-4">HR Information</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Designation" value={dash(s.designation)} testid="hr-designation" />
                <Field label="Department" value={dash(s.department)} testid="hr-department" />
                <Field label="Employment Type" value={empType} testid="hr-emptype" />
                <Field label="Employment Status" value={empStatus} testid="hr-status" />
                <Field label="Joining Date" value={fmtDate(s.joining_date)} testid="hr-joining" />
                <Field label="Exit / Last Working Date" value={fmtDate(s.exit_date)} testid="hr-exit" />
                <Field label="Reporting Manager" value={dash(s.reports_to_name)} testid="hr-reporting" />
                {s.exit_reason && <Field label="Exit Reason" value={s.exit_reason} />}
              </div>
            </div>
          )}

          {section === "mapping" && (
            <div>
              <div className="overline text-[var(--brand)] mb-4">Center &amp; Role Mapping</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Center" value={dash(s.center_name)} testid="map-center" />
                <Field label="System Role" value={roleLabel} testid="map-role" />
                <Field label="Employee ID" value={dash(s.employee_code)} testid="map-empid" />
                <Field label="Has Login" value={s.user_id ? "Yes" : "No"} testid="map-haslogin" />
                <Field label="Mapped Since" value={fmtDate(s.joining_date)} />
              </div>
            </div>
          )}

          {section === "attendance" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="overline text-[var(--brand)]">Attendance</div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="rounded-none h-8 w-8 p-0" data-testid="att-prev"
                    onClick={() => { const d = new Date(attYear, attMonth - 1, 1); setAttMonth(d.getMonth()); setAttYear(d.getFullYear()); }}><ChevronLeft size={15} /></Button>
                  <span className="text-sm font-medium min-w-[90px] text-center">{MONTHS[attMonth]} {attYear}</span>
                  <Button size="sm" variant="outline" className="rounded-none h-8 w-8 p-0" data-testid="att-next"
                    onClick={() => { const d = new Date(attYear, attMonth + 1, 1); setAttMonth(d.getMonth()); setAttYear(d.getFullYear()); }}><ChevronRight size={15} /></Button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[["present", "Present", "border-emerald-200 bg-emerald-50"], ["absent", "Absent", "border-red-200 bg-red-50"], ["half", "Half Day", "border-amber-200 bg-amber-50"], ["leave", "Leave", "border-blue-200 bg-blue-50"]].map(([k, lbl, tone]) => (
                  <div key={k} className={`border p-3 ${tone}`}>
                    <div className="text-2xl font-heading">{attSummary[k] || 0}</div>
                    <div className="overline text-[10px]">{lbl}</div>
                  </div>
                ))}
              </div>
              {(attendance || []).length === 0 ? (
                <div className="text-sm text-[var(--muted)] py-4">No attendance records for this month.</div>
              ) : (
                <div className="border border-[var(--border)] divide-y divide-[var(--border)] max-h-80 overflow-y-auto">
                  {(attendance || []).map((r) => (
                    <div key={r.id || r.date} className="p-2 flex items-center justify-between text-sm">
                      <span>{fmtDate(r.date)}</span>
                      <span className="capitalize font-medium">{r.effective_status || r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === "leave" && (
            <div>
              <div className="overline text-[var(--brand)] mb-4">Leave Requests</div>
              {(leaves || []).length === 0 ? (
                <div className="text-sm text-[var(--muted)] py-4">No leave requests found.</div>
              ) : (
                <div className="border border-[var(--border)] divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
                  {(leaves || []).map((l) => (
                    <div key={l.id} className="p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{fmtDate(l.start_date || l.from_date)} → {fmtDate(l.end_date || l.to_date)}</span>
                        <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase border ${l.status === "approved" ? "text-emerald-700 bg-emerald-50 border-emerald-300" : l.status === "rejected" ? "text-red-700 bg-red-50 border-red-300" : "text-amber-700 bg-amber-50 border-amber-300"}`}>{l.status || "pending"}</span>
                      </div>
                      {l.reason && <div className="text-[var(--muted)] text-xs mt-1">{l.reason}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === "payroll" && canViewSalary && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="overline text-[var(--brand)]">Payroll</div>
                <Button size="sm" variant="outline" className="rounded-none gap-1" data-testid="payroll-salary-detail"
                  onClick={() => nav(`/hrms/staff/${sid}/salary`)}><Wallet size={14} /> Salary Detail</Button>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-5">
                <Field label="Monthly Salary" value={s.monthly_salary != null ? inr(s.monthly_salary) : "—"} testid="payroll-monthly" />
                <Field label="Per-Day Rate" value={s.per_day_rate != null ? inr(s.per_day_rate) : "—"} testid="payroll-perday" />
              </div>
              {(payroll || []).length === 0 ? (
                <div className="text-sm text-[var(--muted)] py-4">No payslips generated yet.</div>
              ) : (
                <div className="border border-[var(--border)] divide-y divide-[var(--border)] max-h-80 overflow-y-auto">
                  {(payroll || []).map((p) => (
                    <div key={p.id} className="p-3 flex items-center justify-between text-sm">
                      <span className="font-medium">{MONTHS[(p.month || 1) - 1]} {p.year}</span>
                      <span>{inr(p.net_payable ?? p.net_pay ?? p.net)}</span>
                      <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase border ${p.status === "paid" ? "text-emerald-700 bg-emerald-50 border-emerald-300" : "text-slate-600 bg-slate-50 border-slate-300"}`}>{p.status || "draft"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === "documents" && canViewDocs && (
            <div>
              <div className="overline text-[var(--brand)] mb-4">Documents</div>
              {(docs || []).length === 0 ? (
                <div className="text-sm text-[var(--muted)] py-4">No documents uploaded.</div>
              ) : (
                <div className="border border-[var(--border)] divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
                  {(docs || []).map((d) => (
                    <div key={d.id} className="p-3 flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{d.title}</div>
                        <div className="text-[10px] text-[var(--muted)] capitalize">{d.doc_type} · {fmtDate(d.uploaded_at)}</div>
                      </div>
                      <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(d.file_path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] text-xs hover:underline shrink-0">View</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === "performance" && (
            <EmptyState icon={TrendingUp} title="Performance — Coming Soon" subtitle="Performance reviews, ratings and warning letters will appear here once the module is enabled." />
          )}

          {section === "timeline" && (
            <EmptyState icon={Clock} title="Activity Timeline — Coming Soon" subtitle="A chronological feed of this employee's key events (attendance, leaves, transfers, payroll) will be shown here." />
          )}
        </div>
      </div>
    </div>
  );
}

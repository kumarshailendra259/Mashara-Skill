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
import { Plus, Check, X, CalendarCheck, CalendarDays, Upload, Trash2, Paperclip } from "lucide-react";

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

  const [openS, setOpenS] = useState(false);
  const [staffForm, setStaffForm] = useState({ name: "", designation: "", reports_to_id: "", monthly_salary: 0, per_day_rate: 0, joining_date: "", user_id: "" });

  const [openR, setOpenR] = useState(false);
  const [rForm, setRForm] = useState({ staff_id: "", amount: "", date: new Date().toISOString().slice(0,10), category: "", description: "", attachments: [] });
  const reimbFileRef = useRef(null);
  const [reimbUploading, setReimbUploading] = useState(false);

  const [pMonth, setPMonth] = useState(new Date().getMonth() + 1);
  const [pYear, setPYear] = useState(new Date().getFullYear());

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
  const [lForm, setLForm] = useState({ staff_id: "", start_date: new Date().toISOString().slice(0,10), end_date: new Date().toISOString().slice(0,10), reason: "" });

  const canMarkAttendance = isAdmin || user?.role === "manager" || user?.role === "center_manager";

  const loadAll = () => Promise.all([
    api.get("/staff"), api.get("/reimbursements"), api.get("/payroll"), api.get("/leaves"),
  ]).then(([s, r, p, lv]) => { setStaff(s.data); setReimbs(r.data); setPayroll(p.data); setLeaves(lv.data); });

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
      setLForm({ staff_id: "", start_date: new Date().toISOString().slice(0,10), end_date: new Date().toISOString().slice(0,10), reason: "" });
      const lv = await api.get("/leaves");
      setLeaves(lv.data);
      toast.success("Leave applied");
    } catch (e) { toast.error(formatError(e)); }
  };

  const decideLeave = async (lid, decision) => {
    try {
      await api.patch(`/leaves/${lid}?decision=${decision}`);
      const lv = await api.get("/leaves");
      setLeaves(lv.data);
      toast.success(decision === "approved" ? "Approved" : "Rejected");
    } catch (e) { toast.error(formatError(e)); }
  };

  const saveStaff = async () => {
    try { await api.post("/staff", { ...staffForm, monthly_salary: +staffForm.monthly_salary, per_day_rate: +staffForm.per_day_rate, reports_to_id: staffForm.reports_to_id || null, user_id: staffForm.user_id || null }); setOpenS(false); loadAll(); toast.success("Saved"); }
    catch (e) { toast.error(formatError(e)); }
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
      <div>
        <div className="overline">HRMS · Payroll</div>
        <h1 className="font-heading font-black tracking-tight text-3xl mt-1">HRMS &amp; Payroll</h1>
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
                      <div className="inline-flex gap-1">
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
          {(isAdmin || user?.role === "manager") && (
            <div className="flex justify-end">
              <Dialog open={openS} onOpenChange={setOpenS}>
                <DialogTrigger asChild><Button className="brand-btn rounded-none gap-2" data-testid="btn-new-staff"><Plus size={16} /> Add Staff</Button></DialogTrigger>
                <DialogContent className="rounded-none">
                  <DialogHeader><DialogTitle className="font-heading">Add Staff</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><Label>Name</Label><Input value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} className="rounded-none" /></div>
                    <div><Label>Designation</Label><Input value={staffForm.designation} onChange={(e) => setStaffForm({ ...staffForm, designation: e.target.value })} className="rounded-none" /></div>
                    <div><Label>Reports To</Label>
                      <Select value={staffForm.reports_to_id || "__none"} onValueChange={(v) => setStaffForm({ ...staffForm, reports_to_id: v === "__none" ? "" : v })}>
                        <SelectTrigger className="rounded-none"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent><SelectItem value="__none">—</SelectItem>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                      </Select></div>
                    <div><Label>Monthly Salary</Label><Input type="number" value={staffForm.monthly_salary} onChange={(e) => setStaffForm({ ...staffForm, monthly_salary: e.target.value })} className="rounded-none" /></div>
                    <div><Label>Per-Day Rate</Label><Input type="number" value={staffForm.per_day_rate} onChange={(e) => setStaffForm({ ...staffForm, per_day_rate: e.target.value })} className="rounded-none" /></div>
                    <div><Label>Joining Date</Label><Input type="date" value={staffForm.joining_date} onChange={(e) => setStaffForm({ ...staffForm, joining_date: e.target.value })} className="rounded-none" /></div>
                    <div><Label>Linked User ID (optional)</Label><Input value={staffForm.user_id} onChange={(e) => setStaffForm({ ...staffForm, user_id: e.target.value })} placeholder="User UUID for login mapping" className="rounded-none" /></div>
                  </div>
                  <DialogFooter><Button variant="outline" onClick={() => setOpenS(false)} className="rounded-none">Cancel</Button><Button onClick={saveStaff} className="brand-btn rounded-none" data-testid="staff-save">Save</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <div className="swiss-card overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3">Name</th><th className="text-left p-3">Designation</th><th className="text-left p-3">Reports To</th>
              <th className="text-right p-3">Salary</th><th className="text-right p-3">Per-Day</th>
            </tr></thead><tbody>
              {staff.length === 0 ? <tr><td colSpan={5} className="text-center py-8 overline">No staff yet</td></tr> : staff.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3">{s.designation}</td>
                  <td className="p-3 text-[var(--muted)]">{sName(s.reports_to_id)}</td>
                  <td className="p-3 num">{inr(s.monthly_salary)}</td>
                  <td className="p-3 num">{inr(s.per_day_rate)}</td>
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
              </tr></thead>
              <tbody>
                {attRecent.length === 0 ? <tr><td colSpan={3} className="text-center py-8 overline">No records</td></tr> : attRecent.map((a) => (
                  <tr key={a.id || `${a.staff_id}-${a.date}`} className="border-b border-[var(--border)] hover:bg-gray-50">
                    <td className="p-3 num">{a.date}</td>
                    <td className="p-3">{sName(a.staff_id)}</td>
                    <td className="p-3"><span className="overline">{a.status}</span></td>
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
                    <Select value={lForm.staff_id} onValueChange={(v) => setLForm({ ...lForm, staff_id: v })}>
                      <SelectTrigger className="rounded-none" data-testid="leave-staff"><SelectValue placeholder="Select staff" /></SelectTrigger>
                      <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — {s.designation}</SelectItem>)}</SelectContent>
                    </Select></div>
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
                      {l.status === "pending" && canMarkAttendance && (
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => decideLeave(l.id, "approved")} className="rounded-none h-8 px-2 text-[var(--success)]" data-testid={`leave-approve-${l.id}`}><Check size={14} /></Button>
                          <Button size="sm" variant="ghost" onClick={() => decideLeave(l.id, "rejected")} className="rounded-none h-8 px-2 text-[var(--danger)]" data-testid={`leave-reject-${l.id}`}><X size={14} /></Button>
                        </div>
                      )}
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
            <div className="swiss-card p-4 flex items-end gap-3">
              <div><Label className="overline">Month</Label><Input type="number" min={1} max={12} value={pMonth} onChange={(e) => setPMonth(+e.target.value)} className="rounded-none w-24" /></div>
              <div><Label className="overline">Year</Label><Input type="number" value={pYear} onChange={(e) => setPYear(+e.target.value)} className="rounded-none w-28" /></div>
              <Button onClick={runPayroll} className="brand-btn rounded-none" data-testid="run-payroll">Run Payroll</Button>
            </div>
          )}
          <div className="swiss-card overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3">Period</th><th className="text-left p-3">Staff</th>
              <th className="text-right p-3">Days</th><th className="text-right p-3">Gross</th>
              <th className="text-right p-3">Net</th><th className="text-left p-3">Status</th>
              <th className="text-right p-3 w-28">Action</th>
            </tr></thead><tbody>
              {payroll.length === 0 ? <tr><td colSpan={7} className="text-center py-8 overline">No payroll yet</td></tr> : payroll.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                  <td className="p-3 num">{p.month}/{p.year}</td>
                  <td className="p-3">{p.staff_name || sName(p.staff_id)}</td>
                  <td className="p-3 num">{p.days_present} / {p.working_days}</td>
                  <td className="p-3 num">{inr(p.gross)}</td>
                  <td className="p-3 num font-medium">{inr(p.net)}</td>
                  <td className="p-3"><span className={`inline-block px-2 py-0.5 text-xs border ${p.status === "paid" ? "border-[var(--success)] text-[var(--success)]" : "border-[var(--warning)] text-[#9a7a00]"}`}>{p.status}</span></td>
                  <td className="p-3 text-right">
                    {p.status !== "paid" && (isAdmin || isAccountant) && (
                      <Button size="sm" variant="ghost" onClick={() => payPayroll(p.id)} className="rounded-none h-8 px-2 text-[var(--brand)] font-medium" data-testid={`pay-payroll-${p.id}`}>Pay</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

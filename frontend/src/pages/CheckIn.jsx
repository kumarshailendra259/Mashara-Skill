import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Camera, MapPin, CheckCircle2, LogOut, RefreshCw, Home, CalendarDays, Plane,
  Receipt, Wallet, Plus, Clock, LogIn as LogInIcon, Calendar, AlertCircle, Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ApprovalTimelineModal from "@/components/ApprovalTimelineModal";

const STATUS_OPTIONS = [
  { v: "present", label: "Present" },
  { v: "half", label: "Half Day" },
  { v: "leave", label: "On Leave" },
];

const TABS = [
  { v: "home", label: "Home", icon: Home },
  { v: "attendance", label: "Attendance", icon: CalendarDays },
  { v: "leave", label: "Leave", icon: Plane },
  { v: "reimburse", label: "Claims", icon: Receipt },
  { v: "salary", label: "Salary", icon: Wallet },
];

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function CheckIn() {
  const { user, loading, login, logout } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("home");

  // Login state
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [busyLogin, setBusyLogin] = useState(false);

  // Summary (loaded on mount)
  const [summary, setSummary] = useState(null);

  const loadSummary = async () => {
    try {
      const { data } = await api.get("/me/summary");
      setSummary(data);
    } catch {/* best-effort */}
  };

  useEffect(() => { if (user && user !== false) loadSummary(); }, [user]);

  const doLogin = async (e) => {
    e.preventDefault();
    setBusyLogin(true);
    const r = await login(email, pwd);
    setBusyLogin(false);
    if (!r.ok) toast.error(r.error);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-white"><div className="overline">Loading…</div></div>;
  }

  // ---- Mobile login form ----
  if (!user || user === false) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg)]" data-testid="checkin-login">
        <div className="px-5 py-6 bg-[var(--brand)] text-white">
          <div className="overline opacity-80">Mashara Skills · Staff App</div>
          <h1 className="font-heading font-black text-2xl mt-1 leading-tight">Welcome</h1>
          <p className="text-xs opacity-80 mt-1">Sign in with your staff account to access the mobile app.</p>
        </div>
        <form onSubmit={doLogin} className="p-5 space-y-4 max-w-md w-full mx-auto">
          <div className="space-y-2">
            <Label className="overline">Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-none h-12 text-base" autoFocus data-testid="checkin-email" />
          </div>
          <div className="space-y-2">
            <Label className="overline">Password</Label>
            <Input type="password" required value={pwd} onChange={(e) => setPwd(e.target.value)} className="rounded-none h-12 text-base" data-testid="checkin-password" />
          </div>
          <Button type="submit" disabled={busyLogin} className="brand-btn rounded-none w-full h-12 text-base" data-testid="checkin-login-btn">
            {busyLogin ? "Signing in…" : "Sign In"}
          </Button>
          <button type="button" onClick={() => nav("/")} className="block w-full text-center text-sm text-[var(--muted)] hover:underline">
            Open full portal →
          </button>
        </form>
      </div>
    );
  }

  // ---- Not mapped to staff ----
  if (summary && !summary.staff) {
    return (
      <div className="min-h-screen p-5 bg-[var(--bg)]" data-testid="checkin-not-staff">
        <div className="swiss-card p-6 max-w-md mx-auto text-center">
          <div className="font-heading font-bold text-lg">No staff profile linked</div>
          <p className="text-sm text-[var(--muted)] mt-2">Your login is active, but admin hasn&apos;t linked you to a staff record yet. Please contact your admin.</p>
          <Button onClick={() => logout()} variant="outline" className="rounded-none mt-4 gap-2"><LogOut size={14} /> Sign out</Button>
        </div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-24" data-testid="checkin-page">
      {/* Header */}
      <div className="px-5 py-5 bg-[var(--brand)] text-white sticky top-0 z-10">
        <div className="flex items-start justify-between">
          <div>
            <div className="overline opacity-80">Mashara Skills · Staff App</div>
            <h1 className="font-heading font-black text-2xl mt-1 leading-tight" data-testid="checkin-greeting">Hi, {summary?.staff?.name || user.name}</h1>
            <p className="text-xs opacity-90 mt-1">{today}</p>
          </div>
          <button onClick={() => logout()} className="opacity-80 hover:opacity-100 mt-1" title="Sign out" data-testid="checkin-logout">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="p-4 max-w-md mx-auto">
        {tab === "home" && <HomeTab summary={summary} reload={loadSummary} setTab={setTab} />}
        {tab === "attendance" && <AttendanceTab />}
        {tab === "leave" && <LeaveTab staffId={summary?.staff?.id} />}
        {tab === "reimburse" && <ReimburseTab staffId={summary?.staff?.id} />}
        {tab === "salary" && <SalaryTab />}
      </div>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--border)] flex justify-around py-2 shadow-lg z-10" data-testid="checkin-tabbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.v;
          return (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 ${active ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}
              data-testid={`tab-${t.v}`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.7} />
              <span className={`text-[10px] ${active ? "font-bold" : "font-medium"}`}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ============================================================
   HOME TAB — Today's check-in/out + quick stats + holidays
   ============================================================ */
function HomeTab({ summary, reload, setTab }) {
  const att = summary?.today;
  const checkedIn = !!att?.check_in_at || !!att?.marked_at;
  const checkedOut = !!att?.check_out_at;
  const stats = summary?.month_stats || {};
  const upcoming = summary?.upcoming_holidays || [];

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="swiss-card p-4 border-l-4 border-[var(--brand)]" data-testid="home-status-card">
        <div className="overline">Today&apos;s Status</div>
        {!checkedIn ? (
          <div className="mt-2">
            <div className="font-heading font-bold text-lg">Not checked in</div>
            <p className="text-sm text-[var(--muted)] mt-1">Tap below to mark your attendance.</p>
          </div>
        ) : (
          <div className="mt-2">
            <div className="font-heading font-bold text-lg flex items-center gap-2">
              <CheckCircle2 size={20} className="text-[var(--success)]" />
              <span className="uppercase">{att?.status || "present"}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
              <div>
                <div className="overline">Check In</div>
                <div className="font-medium">{fmtDate(att?.check_in_at || att?.marked_at)}</div>
              </div>
              <div>
                <div className="overline">Check Out</div>
                <div className="font-medium">{checkedOut ? fmtDate(att?.check_out_at) : "—"}</div>
              </div>
            </div>
            {att?.latitude != null && (
              <a href={`https://www.google.com/maps?q=${att.latitude},${att.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline mt-3">
                <MapPin size={12} /> View location
              </a>
            )}
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {!checkedIn && (
            <Button onClick={() => setTab("attendance")} className="brand-btn rounded-none gap-2 col-span-2" data-testid="quick-check-in">
              <LogInIcon size={16} /> Check In
            </Button>
          )}
          {checkedIn && !checkedOut && (
            <Button onClick={() => setTab("attendance")} variant="outline" className="rounded-none col-span-2 gap-2" data-testid="quick-check-out">
              <Clock size={16} /> Check Out
            </Button>
          )}
        </div>
      </div>

      {/* Month stats */}
      <div className="swiss-card p-4">
        <div className="overline">This Month</div>
        <div className="grid grid-cols-4 gap-2 mt-3 text-center">
          <Stat label="Present" value={stats.present || 0} color="text-[var(--success)]" />
          <Stat label="Half" value={stats.half || 0} color="text-amber-600" />
          <Stat label="Leave" value={stats.leave || 0} color="text-blue-600" />
          <Stat label="Absent" value={stats.absent || 0} color="text-[var(--danger)]" />
        </div>
      </div>

      {/* Pending counts */}
      <div className="grid grid-cols-2 gap-3">
        <QuickStat label="Pending Leaves" value={summary?.pending_counts?.leaves || 0} onClick={() => setTab("leave")} />
        <QuickStat label="Pending Claims" value={summary?.pending_counts?.reimbursements || 0} onClick={() => setTab("reimburse")} />
      </div>

      {/* Upcoming holidays */}
      <div className="swiss-card p-4">
        <div className="overline flex items-center gap-2"><Calendar size={12} /> Upcoming Holidays</div>
        {upcoming.length === 0 ? (
          <div className="text-sm text-[var(--muted)] mt-2">No holidays in the next few weeks.</div>
        ) : (
          <ul className="mt-2 space-y-2">
            {upcoming.map((h) => (
              <li key={h.id} className="flex items-start gap-3 text-sm">
                <div className="bg-[var(--brand)] text-white text-[10px] font-bold uppercase px-2 py-1 leading-tight text-center min-w-[44px]">
                  <div>{new Date(h.date).toLocaleDateString(undefined, { month: "short" })}</div>
                  <div className="text-base leading-none mt-0.5">{new Date(h.date).getDate()}</div>
                </div>
                <div className="flex-1">
                  <div className="font-medium">{h.name}</div>
                  <div className="text-xs text-[var(--muted)] capitalize">{h.type || "holiday"}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button variant="outline" onClick={reload} className="rounded-none w-full gap-2"><RefreshCw size={14} /> Refresh</Button>
    </div>
  );
}

const Stat = ({ label, value, color = "" }) => (
  <div>
    <div className={`text-2xl font-heading font-black ${color}`}>{value}</div>
    <div className="overline text-[9px]">{label}</div>
  </div>
);

const QuickStat = ({ label, value, onClick }) => (
  <button onClick={onClick} className="swiss-card p-3 text-left hover:bg-gray-50">
    <div className="overline">{label}</div>
    <div className="text-2xl font-heading font-black mt-1">{value}</div>
  </button>
);

/* ============================================================
   ATTENDANCE TAB — Check in/out + history list + holidays badge
   ============================================================ */
function AttendanceTab() {
  const [todayInfo, setTodayInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [myReg, setMyReg] = useState([]);
  const [coords, setCoords] = useState(null);
  const [locErr, setLocErr] = useState("");
  const [selfie, setSelfie] = useState(null);
  const [status, setStatus] = useState("present");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingSelfie, setUploadingSelfie] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [regForm, setRegForm] = useState({ date: "", status: "present", reason: "" });
  const selfieRef = useRef(null);

  const load = async () => {
    try {
      const [t, h, hol, reg] = await Promise.all([
        api.get("/attendance/today"),
        api.get("/attendance/my"),
        api.get("/holidays"),
        api.get("/regularisations/my").catch(() => ({ data: [] })),
      ]);
      setTodayInfo(t.data);
      setHistory(h.data || []);
      setHolidays(hol.data || []);
      setMyReg(reg.data || []);
    } catch {/* best-effort */}
  };

  useEffect(() => { load(); }, []);

  const captureLocation = () => {
    setLocErr("");
    if (!navigator.geolocation) { setLocErr("Geolocation not supported"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        toast.success("Location captured");
      },
      (err) => { setLocErr(err.message || "Location denied"); toast.error(err.message || "Location permission denied"); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const onSelfieChange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploadingSelfie(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const reader = new FileReader();
      reader.onload = () => setSelfie({ ...data, preview: reader.result });
      reader.readAsDataURL(f);
    } catch (err) { toast.error(formatError(err)); }
    finally { setUploadingSelfie(false); if (selfieRef.current) selfieRef.current.value = ""; }
  };

  const doCheckIn = async () => {
    if (!coords) { toast.error("Capture location first"); return; }
    if (!selfie) { toast.error("Take a selfie first"); return; }
    setSubmitting(true);
    try {
      await api.post("/attendance/self", {
        status, latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
        selfie_path: selfie.path, selfie_filename: selfie.filename,
      });
      toast.success("Checked in");
      setCoords(null); setSelfie(null);
      await load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSubmitting(false); }
  };

  const doCheckOut = async () => {
    if (!coords) { toast.error("Capture location first"); return; }
    setSubmitting(true);
    try {
      await api.post("/attendance/checkout", {
        latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
        selfie_path: selfie?.path, selfie_filename: selfie?.filename,
      });
      toast.success("Checked out");
      setCoords(null); setSelfie(null);
      await load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSubmitting(false); }
  };

  const att = todayInfo?.attendance;
  const checkedIn = !!att?.check_in_at || !!att?.marked_at;
  const checkedOut = !!att?.check_out_at;
  const holidayMap = Object.fromEntries(holidays.map((h) => [h.date, h]));

  return (
    <div className="space-y-4">
      {/* Action card */}
      <div className="swiss-card p-4">
        <div className="overline">{!checkedIn ? "Step 1 of 3" : (!checkedOut ? "Check Out" : "Done for the day")}</div>
        <div className="font-heading font-bold text-lg mt-1">
          {!checkedIn ? "Mark Check-In" : (!checkedOut ? "Mark Check-Out" : "Attendance complete ✓")}
        </div>

        {!checkedOut && (
          <div className="mt-3 space-y-3">
            {/* Location */}
            <div className="border border-[var(--border)] p-3 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium flex items-center gap-2"><MapPin size={14} /> Location</div>
                {coords && <CheckCircle2 className="text-[var(--success)]" size={18} />}
              </div>
              {coords ? (
                <div className="text-xs text-[var(--muted)] mt-1">{coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)} · ±{Math.round(coords.accuracy)}m</div>
              ) : (
                <Button size="sm" onClick={captureLocation} className="brand-btn rounded-none mt-2 w-full" data-testid="att-capture-loc">Get Location</Button>
              )}
              {locErr && <div className="text-xs text-[var(--danger)] mt-1">{locErr}</div>}
            </div>

            {/* Selfie (mandatory for check-in, optional for check-out) */}
            <div className="border border-[var(--border)] p-3 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium flex items-center gap-2"><Camera size={14} /> Selfie {!checkedIn && <span className="text-[var(--danger)]">*</span>}</div>
                {selfie && <CheckCircle2 className="text-[var(--success)]" size={18} />}
              </div>
              {selfie?.preview ? (
                <img src={selfie.preview} alt="selfie" className="mt-2 w-full max-h-48 object-cover border border-[var(--border)]" />
              ) : (
                <Button size="sm" onClick={() => selfieRef.current?.click()} disabled={uploadingSelfie} variant="outline" className="rounded-none mt-2 w-full" data-testid="att-take-selfie">
                  {uploadingSelfie ? "Uploading…" : "Take Selfie"}
                </Button>
              )}
              <input ref={selfieRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onSelfieChange} />
            </div>

            {/* Status (only for check-in) */}
            {!checkedIn && (
              <div className="border border-[var(--border)] p-3 bg-gray-50">
                <div className="text-sm font-medium mb-2">Status</div>
                <div className="grid grid-cols-3 gap-2">
                  {STATUS_OPTIONS.map((o) => (
                    <button key={o.v} onClick={() => setStatus(o.v)} className={`text-sm py-2 border ${status === o.v ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--border)] bg-white"}`}>{o.label}</button>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={checkedIn ? doCheckOut : doCheckIn} disabled={submitting} className="brand-btn rounded-none w-full h-12 gap-2" data-testid={checkedIn ? "att-checkout-submit" : "att-checkin-submit"}>
              {submitting ? "Saving…" : (checkedIn ? <><Clock size={16} /> Check Out</> : <><LogInIcon size={16} /> Check In</>)}
            </Button>
          </div>
        )}

        {checkedOut && (
          <div className="text-sm text-[var(--muted)] mt-2">In: {fmtDate(att?.check_in_at || att?.marked_at)} · Out: {fmtDate(att?.check_out_at)}</div>
        )}
      </div>

      {/* History list */}
      <div className="swiss-card p-4">
        <div className="flex items-center justify-between">
          <div className="overline">Recent Attendance</div>
          <Dialog open={regOpen} onOpenChange={setRegOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="rounded-none h-8 px-2 gap-1 text-xs" data-testid="reg-open"><AlertCircle size={12} /> Regularise</Button>
            </DialogTrigger>
            <DialogContent className="rounded-none max-w-sm">
              <DialogHeader><DialogTitle className="font-heading">Regularise Attendance</DialogTitle></DialogHeader>
              <p className="text-xs text-[var(--muted)]">If you forgot to check in on a past day, submit a request — HR will review and mark it.</p>
              <div className="space-y-3">
                <div><Label className="overline">Date Missed</Label><Input type="date" value={regForm.date} max={new Date().toISOString().slice(0,10)} onChange={(e) => setRegForm({ ...regForm, date: e.target.value })} className="rounded-none h-11" data-testid="reg-date" /></div>
                <div><Label className="overline">Status Requested</Label>
                  <Select value={regForm.status} onValueChange={(v) => setRegForm({ ...regForm, status: v })}>
                    <SelectTrigger className="rounded-none h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="present">Present</SelectItem>
                      <SelectItem value="half">Half Day</SelectItem>
                      <SelectItem value="leave">Leave</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="overline">Reason</Label><Textarea value={regForm.reason} onChange={(e) => setRegForm({ ...regForm, reason: e.target.value })} placeholder="Why was attendance missed?" className="rounded-none" rows={3} data-testid="reg-reason" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRegOpen(false)} className="rounded-none">Cancel</Button>
                <Button onClick={async () => {
                  if (!regForm.date || !regForm.reason.trim()) { toast.error("Date and reason required"); return; }
                  try {
                    await api.post("/regularisations", regForm);
                    setRegOpen(false);
                    setRegForm({ date: "", status: "present", reason: "" });
                    load();
                    toast.success("Submitted — pending HR review");
                  } catch (e) { toast.error(formatError(e)); }
                }} className="brand-btn rounded-none" data-testid="reg-submit">Submit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {myReg.filter((r) => r.status === "pending").length > 0 && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 mt-2">
            {myReg.filter((r) => r.status === "pending").length} regularisation request(s) pending HR review
          </div>
        )}
        {history.length === 0 ? (
          <div className="text-sm text-[var(--muted)] mt-2">No history yet.</div>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {history.slice(0, 30).map((r) => {
              const h = holidayMap[r.date];
              return (
                <li key={r.id} className="py-2 text-sm flex items-center justify-between">
                  <div>
                    <div className="font-medium">{new Date(r.date).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}</div>
                    <div className="text-xs text-[var(--muted)]">
                      In: {r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : (r.marked_at ? new Date(r.marked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—")}
                      {" · "}Out: {r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                      {h && <span className="ml-1 text-blue-600">· {h.name}</span>}
                    </div>
                  </div>
                  <span className={`text-xs uppercase font-bold px-2 py-1 ${
                    r.status === "present" ? "bg-green-100 text-green-700" :
                    r.status === "absent" ? "bg-red-100 text-red-700" :
                    r.status === "half" ? "bg-amber-100 text-amber-700" :
                    "bg-blue-100 text-blue-700"
                  }`}>{r.status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   LEAVE TAB — Apply + my list
   ============================================================ */
function LeaveTab({ staffId }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [trackId, setTrackId] = useState(null);

  const load = async () => {
    try { const { data } = await api.get("/leaves/my"); setList(data || []); } catch {/* best-effort */}
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!staffId) { toast.error("Staff record not linked yet"); return; }
    if (!form.start_date || !form.end_date) { toast.error("Pick dates"); return; }
    setSubmitting(true);
    try {
      await api.post("/leaves", { staff_id: staffId, ...form });
      toast.success("Leave applied");
      setForm({ start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), reason: "" });
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="swiss-card p-4">
        <div className="font-heading font-bold text-lg">Apply for Leave</div>
        <div className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="overline">From</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="rounded-none h-11" data-testid="leave-start" /></div>
            <div><Label className="overline">To</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="rounded-none h-11" data-testid="leave-end" /></div>
          </div>
          <div>
            <Label className="overline">Reason</Label>
            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Family function" className="rounded-none" rows={3} data-testid="leave-reason" />
          </div>
          <Button onClick={submit} disabled={submitting} className="brand-btn rounded-none w-full h-12 gap-2" data-testid="leave-submit">
            <Plus size={16} /> {submitting ? "Submitting…" : "Submit Leave"}
          </Button>
        </div>
      </div>

      <div className="swiss-card p-4">
        <div className="overline">My Leaves</div>
        {list.length === 0 ? (
          <div className="text-sm text-[var(--muted)] mt-2">No leave requests yet.</div>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {list.map((l) => (
              <li key={l.id} className="py-3 text-sm">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium">{new Date(l.start_date).toLocaleDateString(undefined, { day: "2-digit", month: "short" })} → {new Date(l.end_date).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</div>
                    {l.reason && <div className="text-xs text-[var(--muted)] mt-0.5">{l.reason}</div>}
                    {l.current_level > 0 && l.chain_snapshot?.length && (
                      <button onClick={() => setTrackId(l.id)} className="text-[10px] text-[var(--brand)] mt-1 font-medium hover:underline" data-testid={`track-leave-${l.id}`}>
                        Track approval · Level {l.current_level} of {l.chain_snapshot.length} →
                      </button>
                    )}
                  </div>
                  <span className={`text-xs uppercase font-bold px-2 py-1 ${
                    l.status === "approved" ? "bg-green-100 text-green-700" :
                    l.status === "rejected" ? "bg-red-100 text-red-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{l.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ApprovalTimelineModal type="leave" requestId={trackId} onClose={() => setTrackId(null)} />
    </div>
  );
}

/* ============================================================
   REIMBURSE TAB — Apply + my list
   ============================================================ */
function ReimburseTab({ staffId }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ amount: "", date: new Date().toISOString().slice(0, 10), category: "", description: "", attachments: [] });
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [trackId, setTrackId] = useState(null);
  const fileRef = useRef(null);

  const load = async () => {
    try { const { data } = await api.get("/reimbursements/my"); setList(data || []); } catch {/* best-effort */}
  };
  useEffect(() => { load(); }, []);

  const upload = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((s) => ({ ...s, attachments: [...s.attachments, data] }));
      toast.success("Attached");
    } catch (err) { toast.error(formatError(err)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const submit = async () => {
    if (!staffId) { toast.error("Staff record not linked yet"); return; }
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    setSubmitting(true);
    try {
      await api.post("/reimbursements", { staff_id: staffId, amount: amt, date: form.date, category: form.category, description: form.description, attachments: form.attachments });
      toast.success("Claim submitted");
      setForm({ amount: "", date: new Date().toISOString().slice(0, 10), category: "", description: "", attachments: [] });
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="swiss-card p-4">
        <div className="font-heading font-bold text-lg">New Reimbursement Claim</div>
        <div className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="overline">Amount (₹)</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" className="rounded-none h-11" data-testid="reimb-amount" /></div>
            <div><Label className="overline">Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-none h-11" data-testid="reimb-date" /></div>
          </div>
          <div>
            <Label className="overline">Category</Label>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Travel, Food, Phone" className="rounded-none h-11" />
          </div>
          <div>
            <Label className="overline">Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was the expense for?" className="rounded-none" rows={2} data-testid="reimb-desc" />
          </div>
          <div>
            <Label className="overline">Bill / Receipt</Label>
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} variant="outline" className="rounded-none w-full gap-2 mt-1"><Camera size={14} /> {uploading ? "Uploading…" : "Attach Photo / PDF"}</Button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={upload} />
            {form.attachments.length > 0 && <div className="text-xs text-[var(--muted)] mt-1">{form.attachments.length} file(s) attached</div>}
          </div>
          <Button onClick={submit} disabled={submitting} className="brand-btn rounded-none w-full h-12 gap-2" data-testid="reimb-submit">
            <Plus size={16} /> {submitting ? "Submitting…" : "Submit Claim"}
          </Button>
        </div>
      </div>

      <div className="swiss-card p-4">
        <div className="overline">My Claims</div>
        {list.length === 0 ? (
          <div className="text-sm text-[var(--muted)] mt-2">No claims yet.</div>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {list.map((r) => (
              <li key={r.id} className="py-3 text-sm">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium">{inr(r.amount)} <span className="text-xs text-[var(--muted)] font-normal">· {r.category || "—"}</span></div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">{new Date(r.date).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</div>
                    {r.description && <div className="text-xs mt-1">{r.description}</div>}
                    {r.current_level > 0 && r.chain_snapshot?.length && (
                      <button onClick={() => setTrackId(r.id)} className="text-[10px] text-[var(--brand)] mt-1 font-medium hover:underline" data-testid={`track-claim-${r.id}`}>
                        Track approval · Level {r.current_level} of {r.chain_snapshot.length} →
                      </button>
                    )}
                  </div>
                  <span className={`text-xs uppercase font-bold px-2 py-1 ${
                    r.status === "paid" ? "bg-green-100 text-green-700" :
                    r.status === "rejected" ? "bg-red-100 text-red-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{r.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ApprovalTimelineModal type="reimbursement" requestId={trackId} onClose={() => setTrackId(null)} />
    </div>
  );
}

/* ============================================================
   SALARY TAB — Profile + Bank Verification + Documents + Payroll history
   ============================================================ */
function SalaryTab() {
  const [data, setData] = useState(null);
  const [docs, setDocs] = useState([]);
  const [docForm, setDocForm] = useState({ doc_type: "aadhaar", title: "", notes: "" });
  const [uploading, setUploading] = useState(false);
  const docRef = useRef(null);

  const load = async () => {
    try {
      const [r, d] = await Promise.all([api.get("/payroll/my"), api.get("/staff-documents/my").catch(() => ({ data: [] }))]);
      setData(r.data);
      setDocs(d.data || []);
    } catch {/* best-effort */}
  };
  useEffect(() => { load(); }, []);

  const uploadDoc = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!docForm.title.trim()) { toast.error("Enter a title first (e.g., Aadhaar Front)"); if (docRef.current) docRef.current.value = ""; return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const up = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await api.post("/staff-documents", { doc_type: docForm.doc_type, title: docForm.title.trim(), notes: docForm.notes || null, file_path: up.data.path, file_name: up.data.filename });
      setDocForm({ doc_type: "aadhaar", title: "", notes: "" });
      toast.success("Document uploaded");
      load();
    } catch (err) { toast.error(formatError(err)); }
    finally { setUploading(false); if (docRef.current) docRef.current.value = ""; }
  };

  const removeDoc = async (id) => {
    if (!window.confirm("Delete this document?")) return;
    try { await api.delete(`/staff-documents/${id}`); load(); toast.success("Deleted"); } catch (e) { toast.error(formatError(e)); }
  };

  if (!data) return <div className="overline text-center py-8 text-[var(--muted)]">Loading…</div>;
  const s = data.staff || {};
  const rows = data.payroll || [];
  const ytd = rows.filter((r) => r.year === new Date().getFullYear()).reduce((acc, r) => acc + (r.net || 0), 0);

  const printMobilePayslip = (p, staffRow) => {
    const monthName = new Date(p.year, p.month - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const w = window.open("", "_blank");
    if (!w) { toast.error("Popup blocked"); return; }
    const earn = [["Basic", p.basic], ["HRA", p.hra], ["DA", p.da], ["Conveyance", p.conveyance], ["Bonus", p.bonus], ["Incentive", p.incentive]].filter(([, v]) => v && v > 0);
    const ded = [["PF", p.pf_deduction], ["ESI", p.esi_deduction], ["Late", p.late_deduction], ...((p.other_deductions || []).map((li) => [li.label, li.amount]))].filter(([, v]) => v && v > 0);
    const rowsHtml = (arr) => arr.map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${k}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${inr(v)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Payslip ${monthName}</title>
      <style>body{font-family:Helvetica,Arial,sans-serif;color:#111;max-width:680px;margin:24px auto;padding:0 16px}h1{font-size:20px;margin:0 0 4px}.meta{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px}h3{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:8px}table{width:100%;border-collapse:collapse;font-size:12px}.total{font-weight:700;border-top:2px solid #111}.net{font-size:22px;font-weight:900;margin-top:20px;padding:14px;background:#f0f9f3;border-left:4px solid #16a34a}@media print{body{margin:0}}</style></head><body>
      <div class="meta">Mashara Skills · Payslip</div>
      <h1>${staffRow.name || ""}</h1>
      <div style="font-size:11px;color:#444">${staffRow.designation || ""} · ${monthName} · ${p.days_present || 0} days</div>
      <div class="grid">
        <div><h3>Earnings</h3><table>${rowsHtml(earn) || '<tr><td colspan="2" style="padding:6px 10px;color:#999">—</td></tr>'}<tr class="total"><td style="padding:8px 10px">Gross</td><td style="padding:8px 10px;text-align:right">${inr(p.gross || 0)}</td></tr></table></div>
        <div><h3>Deductions</h3><table>${rowsHtml(ded) || '<tr><td colspan="2" style="padding:6px 10px;color:#999">—</td></tr>'}<tr class="total"><td style="padding:8px 10px">Total</td><td style="padding:8px 10px;text-align:right">${inr(p.deductions || 0)}</td></tr></table></div>
      </div>
      <div class="net">Net Pay <span style="float:right">${inr(p.net || 0)}</span></div>
      <div style="margin-top:32px;font-size:9px;color:#999;text-align:center">Generated ${new Date().toLocaleString("en-IN")}</div>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="swiss-card p-4 border-l-4 border-[var(--brand)]">
        <div className="overline">Salary Profile</div>
        <div className="font-heading font-bold text-2xl mt-1">{inr(s.monthly_salary || 0)}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5">Monthly salary · Per-day rate: {inr(s.per_day_rate || 0)}</div>
        <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
          <div><div className="overline">Bank</div><div className="font-medium">{s.bank_name || "—"}</div></div>
          <div><div className="overline">A/C</div><div className="font-medium">{s.bank_account_no_masked || "—"}</div></div>
        </div>
        {/* Bank verification status */}
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          {!s.bank_account_no_masked ? (
            <div className="text-xs text-[var(--muted)]">No bank details on file. Ask HR to add for payroll.</div>
          ) : s.bank_verified ? (
            <div className="flex items-center gap-2 text-xs text-[var(--success)]">
              <CheckCircle2 size={14} /> Bank verified by HR{s.bank_verified_at ? ` · ${new Date(s.bank_verified_at).toLocaleDateString()}` : ""}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5">
              <AlertCircle size={14} /> Pending verification by HR
            </div>
          )}
        </div>
      </div>

      <div className="swiss-card p-4">
        <div className="overline">Year-to-Date Earned</div>
        <div className="font-heading font-bold text-2xl mt-1 text-[var(--success)]">{inr(ytd)}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5">Across {rows.filter((r) => r.year === new Date().getFullYear()).length} payslip(s) in {new Date().getFullYear()}</div>
      </div>

      {/* Documents section */}
      <div className="swiss-card p-4">
        <div className="overline">My Documents</div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div>
            <Label className="overline text-[10px]">Type</Label>
            <Select value={docForm.doc_type} onValueChange={(v) => setDocForm({ ...docForm, doc_type: v })}>
              <SelectTrigger className="rounded-none h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aadhaar">Aadhaar</SelectItem>
                <SelectItem value="pan">PAN Card</SelectItem>
                <SelectItem value="education">Education Certificate</SelectItem>
                <SelectItem value="experience">Experience Letter</SelectItem>
                <SelectItem value="photo">Photograph</SelectItem>
                <SelectItem value="bank_proof">Bank Proof (cheque/passbook)</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="overline text-[10px]">Title</Label>
            <Input value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} placeholder="e.g. Aadhaar Front" className="rounded-none h-10" data-testid="doc-title" />
          </div>
        </div>
        <Button onClick={() => docRef.current?.click()} disabled={uploading} variant="outline" className="rounded-none w-full mt-2 gap-2" data-testid="doc-upload-btn">
          <Camera size={14} /> {uploading ? "Uploading…" : "Take Photo / Pick File"}
        </Button>
        <input ref={docRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadDoc} />

        {docs.length === 0 ? (
          <div className="text-sm text-[var(--muted)] mt-3 text-center">No documents uploaded yet.</div>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {docs.map((d) => (
              <li key={d.id} className="py-2 text-sm flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.title}</div>
                  <div className="text-[10px] text-[var(--muted)] capitalize">{d.doc_type} · {new Date(d.uploaded_at).toLocaleDateString()}</div>
                </div>
                <a href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(d.file_path)}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] text-xs hover:underline">View</a>
                <Button size="sm" variant="outline" onClick={() => removeDoc(d.id)} className="rounded-none h-8 w-8 p-0 text-[var(--danger)] hover:bg-red-50"><Trash2 size={14} /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="swiss-card p-4">
        <div className="overline">Payslip History</div>
        {rows.length === 0 ? (
          <div className="text-sm text-[var(--muted)] mt-2">No payslips yet.</div>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {rows.map((r) => (
              <li key={r.id} className="py-3 text-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{new Date(r.year, r.month - 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">{r.days_present || 0} days{r.late_days ? ` · ${r.late_days} late day(s)` : ""}</div>
                    {(r.basic || r.hra || r.bonus) && (
                      <div className="text-[10px] text-[var(--muted)] mt-1 leading-tight">
                        Earn: {[
                          r.basic ? `Basic ${inr(r.basic)}` : null,
                          r.hra ? `HRA ${inr(r.hra)}` : null,
                          r.da ? `DA ${inr(r.da)}` : null,
                          r.conveyance ? `Conv ${inr(r.conveyance)}` : null,
                          r.bonus ? `Bonus ${inr(r.bonus)}` : null,
                          r.incentive ? `Inct ${inr(r.incentive)}` : null,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {(r.pf_deduction || r.esi_deduction || r.late_deduction || (r.other_deductions || []).length > 0) && (
                      <div className="text-[10px] text-[var(--danger)] mt-0.5 leading-tight">
                        Deduct: {[
                          r.pf_deduction ? `PF ${inr(r.pf_deduction)}` : null,
                          r.esi_deduction ? `ESI ${inr(r.esi_deduction)}` : null,
                          r.late_deduction ? `Late ${inr(r.late_deduction)}` : null,
                          ...((r.other_deductions || []).map((li) => `${li.label} ${inr(li.amount)}`)),
                        ].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-heading font-bold">{inr(r.net || 0)}</div>
                    <span className={`text-xs uppercase font-bold px-2 py-0.5 ${r.status === "paid" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{r.status}</span>
                    <button onClick={() => printMobilePayslip(r, s)} className="block mt-1 text-[10px] text-[var(--brand)] hover:underline" data-testid={`payslip-pdf-mob-${r.id}`}>Download</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ApprovalTimelineModal moved to /components/ApprovalTimelineModal.jsx for reuse */

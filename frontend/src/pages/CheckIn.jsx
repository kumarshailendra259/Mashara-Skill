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
  Bell, ChevronLeft, ChevronRight, Megaphone, Menu,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent,
} from "@/components/ui/sheet";
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

// Desktop sidebar entries — includes items that only make sense on wider screens
// (My Team, Reports, Notifications, Settings). Mobile keeps the compact bottom
// tab bar so we don't overwhelm small screens.
const SIDEBAR_ITEMS = [
  { v: "home", label: "Dashboard", icon: Home },
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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
      <div className="min-h-screen flex flex-col bg-[var(--bg)] relative overflow-hidden" data-testid="checkin-login">
        {/* Immersive brand hero */}
        <div
          className="relative px-5 pt-8 pb-16 text-white overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, #0b1f4d 0%, #1E3A8A 45%, #2E64C7 100%)",
          }}
        >
          {/* Decorative blobs */}
          <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-blue-400/25 blur-3xl pointer-events-none" aria-hidden />
          <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-indigo-500/25 blur-3xl pointer-events-none" aria-hidden />
          {/* City silhouette (SVG) */}
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage:
                "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22200%22><g fill=%22white%22><rect x=%22450%22 y=%2260%22 width=%2220%22 height=%22140%22/><rect x=%22475%22 y=%2290%22 width=%2225%22 height=%22110%22/><rect x=%22505%22 y=%2245%22 width=%2222%22 height=%22155%22/><rect x=%22535%22 y=%2280%22 width=%2218%22 height=%22120%22/><rect x=%22560%22 y=%2255%22 width=%2225%22 height=%22145%22/></g></svg>')",
              backgroundRepeat: "no-repeat", backgroundPosition: "right bottom",
            }}
            aria-hidden
          />
          {/* Grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.07] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
            aria-hidden
          />

          <div className="relative flex items-center gap-3 mb-6">
            <div className="h-11 w-11 bg-white text-[#0b1f4d] flex items-center justify-center font-heading font-black text-xl shadow-lg">M</div>
            <div className="leading-tight">
              <div className="font-heading font-black text-sm">MASHARA SKILLS</div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-white/70">Staff App</div>
            </div>
          </div>

          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.28em] text-white/70 mb-2">Welcome back</div>
            <h1 className="font-heading font-black text-3xl leading-[1.1] tracking-tight">
              Sign in to<br />
              <span className="text-blue-300">start your shift.</span>
            </h1>
            <p className="text-xs opacity-80 mt-3 max-w-xs">
              Mark attendance, apply leave, raise claims and view your salary — all in one place.
            </p>
          </div>
        </div>

        {/* Card lifts up over hero */}
        <form
          onSubmit={doLogin}
          className="relative -mt-10 px-5 pb-8 max-w-md w-full mx-auto"
        >
          <div className="bg-white shadow-2xl border border-gray-100 p-5 space-y-4">
            <div className="space-y-2">
              <Label className="overline">Email</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-none h-12 text-base" autoFocus data-testid="checkin-email" />
            </div>
            <div className="space-y-2">
              <Label className="overline">Password</Label>
              <Input type="password" required value={pwd} onChange={(e) => setPwd(e.target.value)} className="rounded-none h-12 text-base" data-testid="checkin-password" />
            </div>
            <Button
              type="submit"
              disabled={busyLogin}
              className="rounded-none w-full h-12 text-base font-bold tracking-wide text-white"
              style={{ background: "linear-gradient(90deg, #2E64C7 0%, #1E3A8A 100%)" }}
              data-testid="checkin-login-btn"
            >
              {busyLogin ? "Signing in…" : "Sign In"}
            </Button>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => nav("/forgot-password", { state: { from: "/check-in" } })}
                className="text-sm text-[var(--brand)] hover:underline font-medium"
                data-testid="checkin-forgot-password"
              >
                Forgot password?
              </button>
              <button
                type="button"
                onClick={() => nav("/")}
                className="text-sm text-[var(--muted)] hover:underline"
              >
                Open full portal →
              </button>
            </div>
          </div>

          {/* Feature strip */}
          <div className="grid grid-cols-3 gap-2 mt-5 text-center">
            {[
              { label: "Geo Check-in", icon: MapPin },
              { label: "Leaves", icon: Plane },
              { label: "Salary", icon: Wallet },
            ].map((f) => (
              <div key={f.label} className="bg-white/70 backdrop-blur border border-gray-100 p-2.5 flex flex-col items-center gap-1 shadow-sm">
                <f.icon size={16} className="text-[var(--brand)]" />
                <span className="text-[10px] font-medium text-[var(--ink)]">{f.label}</span>
              </div>
            ))}
          </div>

          <div className="text-center text-[10px] text-[var(--muted)] mt-6">
            © {new Date().getFullYear()} Mashara Skills · Secure staff portal
          </div>
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

  const now = new Date();
  const today = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" });
  const hh = now.getHours();
  const greeting = hh < 12 ? "Good Morning" : hh < 17 ? "Good Afternoon" : "Good Evening";
  const wave = hh < 12 ? "☀️" : hh < 17 ? "👋" : "🌙";

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-24 md:pb-0 md:flex" data-testid="checkin-page">
      {/* Mobile drawer — mirrors desktop sidebar so users can navigate + logout easily on phone */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="p-0 w-72 max-w-[85vw] flex flex-col md:hidden" data-testid="checkin-mobile-drawer">
          <div className="px-5 py-5 border-b border-[var(--border)] flex items-center gap-3">
            <div className="h-9 w-9 bg-[var(--brand)] text-white flex items-center justify-center font-heading font-black text-lg">M</div>
            <div>
              <div className="font-heading font-black text-sm leading-tight">MASHARA SKILLS</div>
              <div className="overline text-[9px]">STAFF APP</div>
            </div>
          </div>
          {/* User summary card */}
          <div className="px-5 py-3 border-b border-[var(--border)] bg-blue-50/40">
            <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Signed in as</div>
            <div className="font-semibold text-sm mt-0.5 truncate">{summary?.staff?.name || user?.name || user?.email}</div>
            <div className="text-[11px] text-[var(--muted)] truncate">{user?.email}</div>
            {summary?.staff?.center_name && (
              <div className="mt-1 text-[11px] text-[var(--brand)] flex items-center gap-1"><MapPin size={11} />{summary.staff.center_name}</div>
            )}
          </div>
          <nav className="flex-1 py-3 overflow-y-auto">
            {SIDEBAR_ITEMS.map((s) => {
              const Icon = s.icon;
              const active = tab === s.v;
              return (
                <button
                  key={s.v}
                  onClick={() => { setTab(s.v); setDrawerOpen(false); }}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${active ? "bg-blue-50 text-[var(--brand)] border-l-4 border-[var(--brand)] font-bold" : "text-[var(--muted)] hover:bg-gray-50 border-l-4 border-transparent"}`}
                  data-testid={`drawer-${s.v}`}
                >
                  <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                  <span>{s.label}</span>
                </button>
              );
            })}
            {/* Bridge to the main workspace for admins / managers / partners */}
            {user?.role && !["staff", "center_staff"].includes(user.role) && (
              <button
                onClick={() => { setDrawerOpen(false); nav("/"); }}
                className="w-full flex items-center gap-3 px-5 py-2.5 text-sm text-[var(--muted)] hover:bg-gray-50 border-l-4 border-transparent"
                data-testid="drawer-goto-workspace"
              >
                <Home size={16} strokeWidth={1.8} />
                <span>Go to Workspace</span>
              </button>
            )}
          </nav>
          <div className="border-t border-[var(--border)]">
            <button
              onClick={() => { setDrawerOpen(false); logout(); }}
              className="w-full flex items-center gap-3 px-5 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
              data-testid="drawer-logout"
            >
              <LogOut size={16} strokeWidth={1.8} />
              <span>Sign out</span>
            </button>
          </div>
          <div className="px-5 py-3 border-t border-[var(--border)] text-[10px] text-[var(--muted)]">
            © {new Date().getFullYear()} Mashara Skills · v1.0
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar — only visible on lg+ (mobile falls back to bottom tab bar) */}
      <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col bg-white border-r border-[var(--border)] min-h-screen sticky top-0">
        <div className="px-5 py-5 border-b border-[var(--border)] flex items-center gap-3">
          <div className="h-9 w-9 bg-[var(--brand)] text-white flex items-center justify-center font-heading font-black text-lg">M</div>
          <div>
            <div className="font-heading font-black text-sm leading-tight">MASHARA SKILLS</div>
            <div className="overline text-[9px]">STAFF APP</div>
          </div>
        </div>
        <nav className="flex-1 py-4">
          {SIDEBAR_ITEMS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.v;
            return (
              <button
                key={t.v}
                onClick={() => setTab(t.v)}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${active ? "bg-blue-50 text-[var(--brand)] border-l-4 border-[var(--brand)] font-bold" : "text-[var(--muted)] hover:bg-gray-50 border-l-4 border-transparent"}`}
                data-testid={`sidebar-${t.v}`}
              >
                <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
        {/* Mobile app QR — static placeholder card matching the mockup */}
        <div className="mx-4 mb-4 border border-[var(--border)] bg-blue-50/50 p-3 text-center">
          <div className="text-[10px] font-bold text-[var(--brand)]">Mashara Skills Mobile App</div>
          <div className="text-[9px] text-[var(--muted)] mt-0.5">Scan to download our mobile app</div>
          <div className="mt-2 mx-auto w-20 h-20 bg-white border border-[var(--border)] flex items-center justify-center">
            {/* Inline SVG QR-code approximation — replace with real QR when app is published */}
            <svg viewBox="0 0 40 40" className="w-16 h-16">
              <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <rect x="28" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <rect x="2" y="28" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <rect x="14" y="14" width="4" height="4" fill="currentColor" />
              <rect x="22" y="14" width="4" height="4" fill="currentColor" />
              <rect x="14" y="22" width="4" height="4" fill="currentColor" />
              <rect x="22" y="22" width="4" height="4" fill="currentColor" />
            </svg>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] text-[10px] text-[var(--muted)]">
          © {new Date().getFullYear()} Mashara Skills<br />All rights reserved
        </div>
      </aside>

      {/* Main content column */}
      <div className="flex-1 min-w-0">
      {/* Blue gradient hero — matches the mockup with greeting, date+time,
          location and a motivational quote on the right. Radial city silhouette
          effect via a semi-transparent SVG overlay so the whole surface stays
          reads-clean on any brand-blue shade. */}
      <div className="relative overflow-hidden text-white bg-gradient-to-br from-[#2E64C7] via-[#1E4EAB] to-[#173B85] px-5 pt-5 pb-16 md:pb-20 lg:pb-24">
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22200%22><g fill=%22white%22><rect x=%22450%22 y=%2260%22 width=%2220%22 height=%22140%22/><rect x=%22475%22 y=%2290%22 width=%2225%22 height=%22110%22/><rect x=%22505%22 y=%2245%22 width=%2222%22 height=%22155%22/><rect x=%22535%22 y=%2280%22 width=%2218%22 height=%22120%22/><rect x=%22560%22 y=%2255%22 width=%2225%22 height=%22145%22/></g></svg>')",
            backgroundRepeat: "no-repeat", backgroundPosition: "right bottom",
          }}
        />
        {/* Top row: mobile logo + right-side actions (bell + avatar) */}
        <div className="relative flex items-center justify-between mb-3">
          <div className="md:hidden flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              data-testid="checkin-mobile-menu"
              className="h-8 w-8 -ml-1 flex items-center justify-center bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors"
            >
              <Menu size={18} />
            </button>
            <div className="h-7 w-7 bg-white/20 flex items-center justify-center font-black">M</div>
            <span className="font-heading font-black text-sm">MASHARA SKILLS</span>
          </div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-3">
            <button className="relative opacity-90 hover:opacity-100" title="Notifications" data-testid="header-bell">
              <Bell size={18} />
              <span className="absolute -top-1.5 -right-1.5 h-4 w-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">3</span>
            </button>
            <div className="hidden md:flex items-center gap-2 bg-white/10 px-2 py-1 rounded-full">
              <div className="h-6 w-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
                {(summary?.staff?.name || user.name || "U").slice(0, 1)}
              </div>
              <span className="text-sm">{summary?.staff?.name || user.name}</span>
            </div>
            <button onClick={() => logout()} className="opacity-90 hover:opacity-100" title="Sign out" data-testid="checkin-logout">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <div className="relative flex items-start justify-between max-w-6xl">
          <div>
            <div className="text-sm md:text-base opacity-90">{greeting},</div>
            <h1 className="font-heading font-black text-2xl md:text-4xl mt-0.5 leading-tight flex items-center gap-2" data-testid="checkin-greeting">
              {summary?.staff?.name || user.name} <span className="text-xl md:text-3xl">{wave}</span>
            </h1>
            <p className="text-xs md:text-sm opacity-90 mt-2 num" data-testid="checkin-datetime">
              {today} · {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </p>
            <div className="text-xs opacity-80 mt-1 flex items-center gap-1">
              <MapPin size={12} />
              <span>{summary?.staff?.center_name || summary?.staff?.center_id?.slice(0, 8) || "—"}</span>
            </div>
          </div>
          <div className="hidden md:flex items-center">
            <div className="text-right italic text-sm opacity-95 leading-tight">
              &ldquo;Discipline today<br />Success tomorrow&rdquo;
            </div>
          </div>
        </div>
      </div>

      {/* Tab content — pulls up over the hero so the top cards sit inside the
          gradient area like the mockup. */}
      <div className="p-4 md:p-6 max-w-none -mt-12 md:-mt-16 relative z-[5]">
        {tab === "home" && <HomeTab summary={summary} reload={loadSummary} setTab={setTab} />}
        {tab === "attendance" && <AttendanceTab />}
        {tab === "leave" && <LeaveTab staffId={summary?.staff?.id} />}
        {tab === "reimburse" && <ReimburseTab staffId={summary?.staff?.id} />}
        {tab === "salary" && <SalaryTab />}
      </div>
      </div>

      {/* Bottom tab bar — mobile only */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--border)] flex justify-around py-2 shadow-lg z-10" data-testid="checkin-tabbar">
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
  const allHolidays = summary?.all_holidays || [];
  const leaveBalances = summary?.leave_balances || [];
  const [showAllHolidays, setShowAllHolidays] = useState(false);
  const now = new Date();
  const nowLabel = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const totalMonth = (stats.present || 0) + (stats.half || 0) + (stats.leave || 0) + (stats.absent || 0);
  const attendancePct = totalMonth > 0 ? Math.round(((stats.present || 0) + (stats.half || 0) * 0.5) / totalMonth * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Top row: Ready for Work + This Month Attendance stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Ready for Work — green tinted card with big Check In button */}
        <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 p-5 relative overflow-hidden" data-testid="ready-for-work">
          <div className="absolute right-4 top-4 h-14 w-14 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
            <MapPin size={22} className="text-white" />
          </div>
          <div className="text-emerald-900 font-heading font-bold text-lg">
            {checkedIn && checkedOut ? "Day Complete" : checkedIn ? "You're checked in" : "Ready for Work?"}
          </div>
          <div className="text-xs text-[var(--muted)] mt-1">
            {checkedIn && !checkedOut ? "Punch out when your shift ends" : checkedIn && checkedOut ? "Great job today 👏" : "Mark your attendance and start your day"}
          </div>
          <div className="text-3xl font-heading font-black text-emerald-700 num mt-4">{nowLabel}</div>

          <div className="mt-3">
            {!checkedIn && (
              <Button onClick={() => setTab("attendance")} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-none gap-2 h-12 text-base font-bold" data-testid="quick-check-in">
                CHECK IN <LogInIcon size={18} />
              </Button>
            )}
            {checkedIn && !checkedOut && (
              <Button onClick={() => setTab("attendance")} className="w-full bg-amber-600 hover:bg-amber-700 text-white rounded-none gap-2 h-12 text-base font-bold" data-testid="quick-check-out">
                CHECK OUT <Clock size={18} />
              </Button>
            )}
            {checkedIn && checkedOut && (
              <div className="w-full h-12 flex items-center justify-center border border-emerald-300 bg-emerald-100 text-emerald-800 gap-2 font-bold">
                <CheckCircle2 size={18} /> Both punches recorded
              </div>
            )}
          </div>
          <div className="text-[10px] text-emerald-800/80 mt-2 flex items-center gap-1">
            <CheckCircle2 size={11} /> Location will be captured
          </div>
        </div>

        {/* This Month Attendance — 4 icon-cards + progress bar */}
        <div className="md:col-span-2 swiss-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="overline font-heading font-bold">This Month Attendance</div>
            <button onClick={() => setTab("attendance")} className="text-[10px] text-[var(--brand)] hover:underline font-bold" data-testid="view-att-details">View Details →</button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <MonthStatCard iconBg="bg-emerald-100" iconColor="text-emerald-600" iconChar="✓" label="Present" value={stats.present || 0} testid="ms-present" />
            <MonthStatCard iconBg="bg-amber-100" iconColor="text-amber-600" iconChar="◐" label="Half Day" value={stats.half || 0} testid="ms-half" />
            <MonthStatCard iconBg="bg-blue-100" iconColor="text-blue-600" iconChar="✈" label="Leave" value={stats.leave || 0} testid="ms-leave" />
            <MonthStatCard iconBg="bg-red-100" iconColor="text-red-600" iconChar="✕" label="Absent" value={stats.absent || 0} testid="ms-absent" />
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="overline">Attendance %</span>
              <span className="font-heading font-bold text-lg text-[var(--brand)]">{attendancePct}%</span>
            </div>
            <div className="h-2 w-full bg-gray-100 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500" style={{ width: `${attendancePct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Today's check-in details — visible only after check-in */}
      {checkedIn && (
        <div className="swiss-card p-4 border-l-4 border-emerald-500" data-testid="home-status-card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="overline text-xs">Check In</div>
              <div className="font-medium num">{fmtDate(att?.check_in_at || att?.marked_at)}</div>
            </div>
            <div>
              <div className="overline text-xs">Check Out</div>
              <div className="font-medium num">{checkedOut ? fmtDate(att?.check_out_at) : <span className="text-amber-700">Pending</span>}</div>
            </div>
            <div>
              <div className="overline text-xs">Status</div>
              <div className="font-medium uppercase">
                {checkedIn && checkedOut ? <span className="text-emerald-700">Present</span>
                  : <span className="text-amber-700">Incomplete (needs check-out)</span>}
              </div>
            </div>
            {att?.latitude != null && (
              <div>
                <div className="overline text-xs">Location</div>
                <a href={`https://www.google.com/maps?q=${att.latitude},${att.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline">
                  <MapPin size={12} /> Open map
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row 2: Leave Balance + Pending stats on left, quick actions grid on right */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Leave Balance */}
          <div className="swiss-card p-4" data-testid="leave-balances-card">
            <div className="flex items-center justify-between mb-3">
              <div className="overline flex items-center gap-2 font-heading font-bold"><Wallet size={12} /> Leave Balance</div>
              <button onClick={() => setTab("leave")} className="text-[10px] text-[var(--brand)] hover:underline font-bold">View All</button>
            </div>
            {leaveBalances.length === 0 ? (
              <div className="text-xs text-[var(--muted)] py-4">No allocations. Ask HR.</div>
            ) : (
              <div className="space-y-3">
                {leaveBalances.slice(0, 2).map((b) => {
                  const pct = b.allocated > 0 ? Math.round((b.balance / b.allocated) * 100) : 0;
                  return (
                    <div key={b.id} data-testid={`mob-bal-${b.leave_type_code}`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{b.leave_type_name || b.leave_type_code}</span>
                        <span className="text-[10px] text-[var(--muted)]">Days Left</span>
                      </div>
                      <div className="flex items-end justify-between mt-1">
                        <span className="text-2xl font-heading font-black text-emerald-700 num leading-none">{b.balance}</span>
                        <span className="text-[10px] text-[var(--muted)]">/ {b.allocated}</span>
                      </div>
                      <div className="h-1.5 w-full bg-gray-100 mt-1 overflow-hidden">
                        <div className={`h-full ${b.leave_type_color === "amber" ? "bg-amber-500" : b.leave_type_color === "green" ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pending Requests */}
          <div className="swiss-card p-4">
            <div className="overline font-heading font-bold mb-3">Pending</div>
            <button onClick={() => setTab("leave")} className="w-full flex items-center gap-3 p-3 border border-[var(--border)] hover:bg-gray-50 mb-2 text-left" data-testid="pending-leaves-card">
              <div className="h-10 w-10 bg-blue-100 flex items-center justify-center">
                <Plane size={18} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <div className="text-2xl font-heading font-black leading-none">{summary?.pending_counts?.leaves || 0}</div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">Leave Requests</div>
              </div>
              <span className="text-[var(--muted)]">›</span>
            </button>
            <button onClick={() => setTab("reimburse")} className="w-full flex items-center gap-3 p-3 border border-[var(--border)] hover:bg-gray-50 text-left" data-testid="pending-claims-card">
              <div className="h-10 w-10 bg-violet-100 flex items-center justify-center">
                <Receipt size={18} className="text-violet-600" />
              </div>
              <div className="flex-1">
                <div className="text-2xl font-heading font-black leading-none">{summary?.pending_counts?.reimbursements || 0}</div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">Claims</div>
              </div>
              <span className="text-[var(--muted)]">›</span>
            </button>
          </div>
        </div>

        {/* Quick actions grid on the right — 2x3 grid of icon buttons */}
        <div className="swiss-card p-4">
          <div className="overline font-heading font-bold mb-3">Quick Actions</div>
          <div className="grid grid-cols-3 gap-2">
            <QAction icon={<Plane size={16} className="text-emerald-600" />} bg="bg-emerald-50" label="Apply Leave" onClick={() => setTab("leave")} testid="qa-leave" />
            <QAction icon={<Receipt size={16} className="text-amber-600" />} bg="bg-amber-50" label="Raise Claim" onClick={() => setTab("reimburse")} testid="qa-claim" />
            <QAction icon={<CalendarDays size={16} className="text-blue-600" />} bg="bg-blue-50" label="Attendance" onClick={() => setTab("attendance")} testid="qa-att" />
            <QAction icon={<Wallet size={16} className="text-violet-600" />} bg="bg-violet-50" label="Salary Slip" onClick={() => setTab("salary")} testid="qa-salary" />
            <QAction icon={<Calendar size={16} className="text-pink-600" />} bg="bg-pink-50" label="Holidays" onClick={() => setShowAllHolidays(true)} testid="qa-holidays" />
            <QAction icon={<AlertCircle size={16} className="text-red-600" />} bg="bg-red-50" label="Help" onClick={() => toast.info("Contact HR for help")} testid="qa-help" />
          </div>
        </div>
      </div>

      {/* Row 3: Calendar + Today's Timeline + Monthly Overview donut */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MiniCalendar summary={summary} />
        <TodayTimeline att={att} />
        <MonthlyOverviewDonut stats={stats} totalMonth={totalMonth} />
      </div>

      {/* Row 4: Weekly bar chart + Notifications + News & Announcements */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <WeeklyAttendanceBars />
        <NotificationsCard setTab={setTab} />
        <NewsAnnouncementsCard />
      </div>

      {/* Legacy holidays block re-purposed as "Upcoming Holidays" card */}
      <div className="swiss-card p-4">
        <div className="flex items-center justify-between">
          <div className="overline flex items-center gap-2"><Calendar size={12} /> Holidays · {new Date().getFullYear()}</div>
          {allHolidays.length > 0 && (
            <button onClick={() => setShowAllHolidays((v) => !v)} className="text-[10px] text-[var(--brand)] hover:underline font-bold" data-testid="toggle-holidays">
              {showAllHolidays ? "SHOW UPCOMING" : `SEE ALL (${allHolidays.length})`}
            </button>
          )}
        </div>
        {(showAllHolidays ? allHolidays : upcoming).length === 0 ? (
          <div className="text-sm text-[var(--muted)] mt-2">No holidays configured.</div>
        ) : (
          <ul className="mt-2 space-y-2 max-h-[280px] overflow-y-auto pr-1">
            {(showAllHolidays ? allHolidays : upcoming).map((h) => {
              const d = new Date(h.date);
              const isPast = d < new Date(new Date().toDateString());
              return (
                <li key={h.id} className={`flex items-start gap-3 text-sm ${isPast ? "opacity-50" : ""}`} data-testid={`hol-${h.id}`}>
                  <div className="bg-[var(--brand)] text-white text-[10px] font-bold uppercase px-2 py-1 leading-tight text-center min-w-[44px]">
                    <div>{d.toLocaleDateString(undefined, { month: "short" })}</div>
                    <div className="text-base leading-none mt-0.5">{d.getDate()}</div>
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{h.name}</div>
                    <div className="text-xs text-[var(--muted)] capitalize">{h.type || "holiday"}{isPast ? " · past" : ""}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Button variant="outline" onClick={reload} className="rounded-none w-full gap-2"><RefreshCw size={14} /> Refresh</Button>
    </div>
  );
}

// Leave-badge palette mirrors LeaveAllocationTab.jsx for visual consistency.
const LEAVE_BADGE = {
  blue:    "bg-blue-50 text-[var(--brand)] border-blue-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber:   "bg-amber-50 text-amber-700 border-amber-200",
  purple:  "bg-purple-50 text-purple-700 border-purple-200",
  rose:    "bg-rose-50 text-rose-700 border-rose-200",
  indigo:  "bg-indigo-50 text-indigo-700 border-indigo-200",
  teal:    "bg-teal-50 text-teal-700 border-teal-200",
};

const Stat = ({ label, value, color = "" }) => (
  <div>
    <div className={`text-2xl font-heading font-black ${color}`}>{value}</div>
    <div className="overline text-[9px]">{label}</div>
  </div>
);

// -------- MOCKUP: mini calendar with attendance-coloured dots --------
function MiniCalendar({ summary }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = first.getDay(); // 0 = Sun
  const monthName = first.toLocaleString(undefined, { month: "long" });
  const statusByDay = summary?.month_attendance_by_day || {};
  const todayN = (year === now.getFullYear() && month === now.getMonth()) ? now.getDate() : null;

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const cellCls = (d) => {
    if (!d) return "";
    const st = statusByDay[String(d).padStart(2, "0")];
    if (d === todayN) return "bg-[var(--brand)] text-white font-bold";
    if (st === "present") return "bg-emerald-100 text-emerald-800";
    if (st === "half") return "bg-amber-100 text-amber-800";
    if (st === "leave") return "bg-blue-100 text-blue-800";
    if (st === "absent") return "bg-red-100 text-red-800";
    return "hover:bg-gray-50 text-[var(--foreground)]";
  };

  return (
    <div className="swiss-card p-4" data-testid="mini-calendar">
      <div className="flex items-center justify-between mb-3">
        <div className="font-heading font-bold text-sm">{monthName} {year}</div>
        <div className="flex gap-1">
          <button onClick={() => { const m = month - 1; if (m < 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m); }} className="p-1 hover:bg-gray-100"><ChevronLeft size={14} /></button>
          <button onClick={() => { const m = month + 1; if (m > 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m); }} className="p-1 hover:bg-gray-100"><ChevronRight size={14} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-center overline mb-1 text-[var(--muted)]">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => (
          <div key={i} className={`aspect-square flex items-center justify-center text-xs ${cellCls(d)}`}>{d || ""}</div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-3 text-[9px]">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400" /> Present</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-amber-400" /> Half</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-blue-400" /> Leave</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-red-400" /> Absent</span>
      </div>
    </div>
  );
}

// -------- MOCKUP: today's timeline of punch events --------
function TodayTimeline({ att }) {
  const fmt = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; }
  };
  // Compose the four punch events. Lunch break is derived if we can't detect one — we display
  // a neutral placeholder so the timeline layout stays consistent for staff without lunch tracking.
  const events = [
    { key: "in", label: "Check In", time: fmt(att?.check_in_at || att?.marked_at), status: att?.check_in_at ? "On Time" : "Pending", statusCls: att?.check_in_at ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-gray-50 border-[var(--border)] text-[var(--muted)]", dot: att?.check_in_at ? "bg-emerald-500" : "bg-gray-300" },
    { key: "lunch", label: "Lunch Break", time: "01:00 PM", status: att?.check_in_at ? "45 mins" : "—", statusCls: "bg-amber-50 border-amber-200 text-amber-800", dot: "bg-amber-500" },
    { key: "resume", label: "Resume Work", time: "01:45 PM", status: att?.check_in_at ? "Back" : "—", statusCls: "bg-blue-50 border-blue-200 text-blue-800", dot: "bg-blue-500" },
    { key: "out", label: "Check Out", time: fmt(att?.check_out_at), status: att?.check_out_at ? "Done" : "Pending", statusCls: att?.check_out_at ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-gray-50 border-[var(--border)] text-[var(--muted)]", dot: att?.check_out_at ? "bg-emerald-500" : "bg-gray-300" },
  ];
  return (
    <div className="swiss-card p-4" data-testid="today-timeline">
      <div className="font-heading font-bold text-sm mb-3">Today&apos;s Timeline</div>
      <div className="relative pl-4">
        {/* vertical connector line */}
        <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-gray-200" />
        <div className="space-y-4">
          {events.map((e) => (
            <div key={e.key} className="flex items-center gap-3 relative">
              <span className={`h-3 w-3 rounded-full ${e.dot} absolute -left-4 ring-2 ring-white`} />
              <div className="flex-1 flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium">{e.label}</div>
                  <div className="text-[10px] text-[var(--muted)] num">{e.time}</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 border ${e.statusCls}`}>{e.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -------- MOCKUP: monthly overview donut with % breakdown --------
function MonthlyOverviewDonut({ stats, totalMonth }) {
  const p = stats.present || 0, h = stats.half || 0, l = stats.leave || 0, a = stats.absent || 0;
  const total = Math.max(totalMonth, 1);
  const segs = [
    { key: "p", val: p / total, color: "#10b981", label: "Present" },
    { key: "h", val: h / total, color: "#f59e0b", label: "Half Day" },
    { key: "l", val: l / total, color: "#3b82f6", label: "Leave" },
    { key: "a", val: a / total, color: "#ef4444", label: "Absent" },
  ];
  // Convert each fraction into stroke-dasharray positions on a circle of circumference 2πr.
  const R = 30, C = 2 * Math.PI * R;
  let accum = 0;
  const paths = segs.map((s) => {
    const len = s.val * C;
    const el = <circle key={s.key} cx="40" cy="40" r={R} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-accum} transform="rotate(-90 40 40)" />;
    accum += len;
    return el;
  });
  const pct = Math.round((p / total) * 100);
  return (
    <div className="swiss-card p-4 flex flex-col" data-testid="monthly-overview">
      <div className="font-heading font-bold text-sm mb-3">Monthly Overview</div>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r={R} fill="none" stroke="#f1f5f9" strokeWidth="12" />
            {paths}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-lg font-heading font-black leading-none">{pct}%</div>
            <div className="text-[9px] text-[var(--muted)]">Present</div>
          </div>
        </div>
        <div className="flex-1 space-y-1.5 text-xs">
          {segs.map((s) => (
            <div key={s.key} className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="num font-semibold">{Math.round(s.val * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -------- MOCKUP: attendance overview (this week bar chart) --------
function WeeklyAttendanceBars() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    (async () => {
      // Fetch last 7 days of my attendance for the bar chart
      const end = new Date();
      const start = new Date(); start.setDate(start.getDate() - 6);
      try {
        const iso = (d) => d.toISOString().slice(0, 10);
        const { data } = await api.get(`/attendance/my?start=${iso(start)}&end=${iso(end)}`);
        setRows(data || []);
      } catch { /* keep empty */ }
    })();
  }, []);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const byDate = Object.fromEntries((rows || []).map((r) => [r.date, r]));
  const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: "short" });
  const hours = (r) => {
    if (!r?.check_in_at) return 0;
    const s = new Date(r.check_in_at);
    const e = r.check_out_at ? new Date(r.check_out_at) : new Date();
    return Math.max(0, (e - s) / (1000 * 60 * 60));
  };
  const dayHours = days.map((d) => hours(byDate[d.toISOString().slice(0, 10)]));
  const maxH = Math.max(9, ...dayHours);
  return (
    <div className="swiss-card p-4" data-testid="weekly-bars">
      <div className="font-heading font-bold text-sm mb-3">Attendance Overview · This Week</div>
      <div className="flex items-end gap-2 h-32">
        {days.map((d, i) => {
          const h = dayHours[i];
          const pct = Math.round((h / maxH) * 100);
          const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="text-[9px] text-[var(--muted)] num h-3">{h > 0 ? `${hh}h ${mm}m` : ""}</div>
              <div className="w-full bg-gray-100 h-24 flex flex-col justify-end">
                <div className="bg-gradient-to-t from-[var(--brand)] to-blue-400 transition-all" style={{ height: `${pct}%` }} />
              </div>
              <div className="text-[10px] font-medium">{dayLabel(d)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -------- MOCKUP: notifications side panel --------
function NotificationsCard({ setTab }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/notifications?limit=6");
        // `/notifications` returns { items, unread } — normalise here.
        const list = Array.isArray(data) ? data : (data?.items || []);
        setItems(list);
      } catch { /* keep empty */ }
    })();
  }, []);
  const unread = items.filter((n) => !n.read).length;
  const markAll = async () => {
    try { await api.patch("/notifications/mark-all-read"); setItems(items.map((n) => ({ ...n, read: true }))); } catch { /* no-op */ }
  };
  return (
    <div className="swiss-card p-4" data-testid="notifications-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="font-heading font-bold text-sm">Notifications</div>
          {unread > 0 && <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">{unread}</span>}
        </div>
        {items.length > 0 && (
          <button onClick={markAll} className="text-[10px] text-[var(--brand)] hover:underline font-bold">Mark all as read</button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-[var(--muted)] py-4 text-center">No notifications</div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {items.slice(0, 5).map((n) => (
            <div key={n.id} className={`text-xs p-2 border-l-2 ${n.read ? "border-gray-200 bg-gray-50 opacity-70" : "border-[var(--brand)] bg-blue-50"}`}>
              <div className="line-clamp-2">{n.message || n.title}</div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5">
                {n.created_at ? new Date(n.created_at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -------- MOCKUP: news & announcements card --------
function NewsAnnouncementsCard() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/announcements/active");
        setItems(data || []);
      } catch { /* keep empty */ }
    })();
  }, []);
  return (
    <div className="swiss-card p-4" data-testid="news-card">
      <div className="flex items-center gap-2 mb-3">
        <Megaphone size={14} className="text-[var(--brand)]" />
        <div className="font-heading font-bold text-sm">News &amp; Announcements</div>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-[var(--muted)] py-4 text-center">No active announcements</div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {items.slice(0, 4).map((a) => {
            const cls = a.priority === "urgent" ? "border-red-300 bg-red-50 text-red-900"
              : a.priority === "important" ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-blue-300 bg-blue-50 text-blue-900";
            return (
              <div key={a.id} className={`text-xs p-2 border-l-2 ${cls}`}>
                <div className="font-medium">{a.title}</div>
                <div className="line-clamp-2 mt-0.5 opacity-80">{a.body}</div>
                <div className="text-[10px] opacity-70 mt-0.5">— {a.created_by_name}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const QuickStat = ({ label, value, onClick }) => (
  <button onClick={onClick} className="swiss-card p-3 text-left hover:bg-gray-50">
    <div className="overline">{label}</div>
    <div className="text-2xl font-heading font-black mt-1">{value}</div>
  </button>
);

// Mockup-styled attendance stat card — coloured icon square + big number + label.
const MonthStatCard = ({ iconBg, iconColor, iconChar, label, value, testid }) => (
  <div className="border border-[var(--border)] p-3 hover:bg-gray-50 transition-colors" data-testid={testid}>
    <div className={`h-8 w-8 ${iconBg} ${iconColor} flex items-center justify-center text-lg font-bold`}>{iconChar}</div>
    <div className="text-3xl font-heading font-black leading-none mt-2 num">{value}</div>
    <div className="overline text-[10px] mt-0.5">{label}</div>
  </div>
);

// Quick-action square button used in the mockup's 3-column grid.
const QAction = ({ icon, bg, label, onClick, testid }) => (
  <button onClick={onClick} className="flex flex-col items-center gap-1 p-2 hover:bg-gray-50 text-center" data-testid={testid}>
    <div className={`h-10 w-10 ${bg} flex items-center justify-center`}>{icon}</div>
    <span className="text-[10px] font-medium leading-tight">{label}</span>
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
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setCoords({ latitude, longitude, accuracy, address: null, addressLoading: true });
        toast.success("Location captured");
        // Reverse-geocode via OpenStreetMap Nominatim (free, no API key).
        // Best-effort: if it fails we still keep the coordinates.
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
            { headers: { "Accept-Language": "en" } },
          );
          if (r.ok) {
            const j = await r.json();
            const addr = j?.display_name || null;
            const pincode = j?.address?.postcode || null;
            setCoords((c) => c && c.latitude === latitude && c.longitude === longitude
              ? { ...c, address: addr, pincode, addressLoading: false }
              : c);
          } else {
            setCoords((c) => c ? { ...c, addressLoading: false } : c);
          }
        } catch {
          setCoords((c) => c ? { ...c, addressLoading: false } : c);
        }
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
        address: coords.address || undefined,
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
        address: coords.address || undefined,
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
                <div className="mt-1 space-y-1">
                  {coords.address ? (
                    <div className="text-xs text-[var(--ink)] leading-snug break-words" data-testid="att-address">
                      {coords.address}
                      {coords.pincode && !coords.address.includes(coords.pincode) && (
                        <span className="ml-1 font-medium">· PIN {coords.pincode}</span>
                      )}
                    </div>
                  ) : coords.addressLoading ? (
                    <div className="text-xs text-[var(--muted)] italic">Fetching full address…</div>
                  ) : (
                    <div className="text-xs text-[var(--muted)] italic">Address unavailable</div>
                  )}
                  <div className="text-[10px] text-[var(--muted)] num flex items-center gap-2">
                    <span>{coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}</span>
                    <span>·</span>
                    <span>±{Math.round(coords.accuracy)}m</span>
                    <button
                      type="button"
                      onClick={captureLocation}
                      className="ml-auto text-[var(--brand)] hover:underline"
                      data-testid="att-refresh-loc"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
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
              <p className="text-xs text-[var(--muted)]">If you forgot to check in on a past day, submit a request — it will follow the configured approval workflow.</p>
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
                    toast.success("Submitted — awaiting approval");
                  } catch (e) { toast.error(formatError(e)); }
                }} className="brand-btn rounded-none" data-testid="reg-submit">Submit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {myReg.filter((r) => r.status === "pending").length > 0 && (() => {
          const pending = myReg.filter((r) => r.status === "pending");
          // Group by current step label (chain.snapshot[current_level-1].label or 'Approval')
          const stepCounts = pending.reduce((acc, r) => {
            const snap = r.chain_snapshot || [];
            const step = snap.find((s) => s.level === r.current_level);
            const label = step?.label || (r.chain_id ? `Level ${r.current_level || 1}` : "HR / Admin");
            acc[label] = (acc[label] || 0) + 1;
            return acc;
          }, {});
          return (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 mt-2" data-testid="reg-pending-banner">
              {pending.length} regularisation request(s) awaiting:{" "}
              {Object.entries(stepCounts).map(([lbl, n], i) => (
                <span key={lbl}>{i > 0 ? ", " : ""}<b>{lbl}</b> ({n})</span>
              ))}
            </div>
          );
        })()}
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
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [form, setForm] = useState({ start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), reason: "", leave_type_id: "" });
  const [submitting, setSubmitting] = useState(false);
  const [trackId, setTrackId] = useState(null);

  const load = async () => {
    try {
      const [my, lt, summ] = await Promise.all([
        api.get("/leaves/my"),
        api.get("/leave-types"),
        api.get("/me/summary").catch(() => ({ data: {} })),
      ]);
      setList(my.data || []);
      setTypes(lt.data || []);
      setBalances(summ.data?.leave_balances || []);
    } catch {/* best-effort */}
  };
  useEffect(() => { load(); }, []);

  const balOf = (lt_id) => balances.find((b) => b.leave_type_id === lt_id);

  const submit = async () => {
    if (!staffId) { toast.error("Staff record not linked yet"); return; }
    if (!form.leave_type_id) { toast.error("Pick a leave type — balance won't deduct otherwise"); return; }
    if (!form.start_date || !form.end_date) { toast.error("Pick dates"); return; }
    setSubmitting(true);
    try {
      await api.post("/leaves", { staff_id: staffId, ...form });
      toast.success("Leave applied");
      setForm({ start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), reason: "", leave_type_id: "" });
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="swiss-card p-4">
        <div className="font-heading font-bold text-lg">Apply for Leave</div>
        <div className="space-y-3 mt-3">
          <div>
            <Label className="overline">Leave Type *</Label>
            <Select value={form.leave_type_id} onValueChange={(v) => setForm({ ...form, leave_type_id: v })}>
              <SelectTrigger className="rounded-none h-11" data-testid="mob-leave-type"><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {types.map((t) => {
                  const b = balOf(t.id);
                  return (
                    <SelectItem key={t.id} value={t.id}>
                      {t.code} — {t.name}{b ? ` · ${b.balance}/${b.allocated} left` : " · no balance"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {form.leave_type_id && (() => {
              const b = balOf(form.leave_type_id);
              return b ? (
                <div className="text-[10px] text-[var(--muted)] mt-1 num">Available: <b>{b.balance}</b> of {b.allocated} ({b.used} used)</div>
              ) : (
                <div className="text-[10px] text-amber-700 mt-1">⚠ No allocation — leave will be applied but balance won&apos;t deduct.</div>
              );
            })()}
          </div>
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
                    {(r.attachments || []).length > 0 && (
                      <div className="text-[10px] text-blue-700 mt-1">📎 {r.attachments.length} attachment(s)</div>
                    )}
                    {r.current_level > 0 && (r.pending_with || []).length > 0 && (
                      <div className="text-[10px] mt-1 text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5" data-testid={`claim-pending-${r.id}`}>
                        ⏳ Pending with <strong>{r.current_step_label}</strong> — {r.pending_with.slice(0, 2).map((u) => u.name).join(", ")}
                        {r.pending_with.length > 2 && ` +${r.pending_with.length - 2}`}
                      </div>
                    )}
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

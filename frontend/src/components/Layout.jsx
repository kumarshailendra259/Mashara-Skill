import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LangContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, Building2, Users, MapPin, Briefcase,
  ArrowLeftRight, FileBarChart2, LogOut, Languages, ShieldCheck, Bell, Package, ClipboardCheck, Layers, GitMerge, Settings2, Link2, Receipt, Inbox, History, Box, UserCog, FileSignature, Users2, UserPlus, Landmark,
  Menu, Fingerprint, MoreHorizontal, Wallet, PieChart, BarChart3, Target,
  ChevronDown, ChevronRight, Star, ChevronsRight, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent,
} from "@/components/ui/sheet";
import AnnouncementBanner from "@/components/AnnouncementBanner";

// Grouped sidebar structure (exact order per product spec).
// Each group has: key (i18n), icon, and items (each item preserves its own
// role-gate flag exactly as before — RBAC filtering is unchanged).
const navGroups = [
  {
    key: "grp_dashboard",
    icon: LayoutDashboard,
    items: [
      { to: "/", key: "dashboard", icon: LayoutDashboard, end: true, dashboardRoles: true },
      { to: "/payment-dashboard", key: "payment_dashboard", icon: PieChart, financeOnly: true },
    ],
  },
  {
    key: "grp_organization",
    icon: Building2,
    items: [
      { to: "/companies", key: "companies", icon: Building2 },
      { to: "/partners", key: "partners", icon: Users },
      { to: "/centers", key: "centers", icon: MapPin },
      { to: "/projects", key: "projects", icon: Briefcase },
    ],
  },
  {
    key: "grp_batch",
    icon: Target,
    items: [
      { to: "/batch-management", key: "batch_management", icon: Target, batchMgmtAccess: true },
    ],
  },
  {
    key: "grp_finance",
    icon: Wallet,
    items: [
      { to: "/programs", key: "programs", icon: Layers, programsAccess: true },
      { to: "/invoices", key: "invoices", icon: FileText, invoiceAccess: true },
      { to: "/transactions", key: "transactions", icon: ArrowLeftRight, financeOnly: true },
      { to: "/advances", key: "advances", icon: Wallet },
      { to: "/quotations", key: "payment_request", icon: FileSignature, nonPartner: true },
      { to: "/bank-reconciliation", key: "bank_reconciliation", icon: Wallet, adminAccountantOnly: true },
      { to: "/bank-guarantees", key: "bank_guarantees", icon: Landmark, bgAccess: true },
      { to: "/tds-register", key: "tds_register", icon: Receipt, financeOnly: true },
      { to: "/mis", key: "mis_dashboard", icon: BarChart3, misAccess: true },
      { to: "/reports", key: "reports", icon: FileBarChart2, financeOnly: true },
    ],
  },
  {
    key: "grp_approvals",
    icon: ClipboardCheck,
    items: [
      { to: "/pending-approvals", key: "pending_approvals", icon: Inbox },
      { to: "/approvals", key: "approval_log", icon: ClipboardCheck, adminOnly: true },
      { to: "/approval-workflows", key: "approval_workflows", icon: GitMerge, hrOrAdmin: true },
    ],
  },
  {
    key: "grp_candidates",
    icon: UserPlus,
    items: [
      { to: "/candidates", key: "candidates", icon: UserPlus, candidateAccess: true },
      { to: "/me/profile", key: "my_profile", icon: UserCog },
    ],
  },
  {
    key: "grp_hr",
    icon: Users,
    items: [
      { to: "/employee-transfers", key: "employee_transfers", icon: UserCog, hrLineOnly: true },
      { to: "/hrms", key: "HRMS", icon: Users },
      { to: "/hr-settings", key: "hr_settings", icon: Settings2, hrOrAdmin: true },
      { to: "/users", key: "user_management", icon: ShieldCheck, adminOnly: true },
      { to: "/login-history", key: "login_history", icon: History, adminOnly: true },
    ],
  },
  {
    key: "grp_procurement",
    icon: Package,
    items: [
      { to: "/vendors", key: "vendors", icon: Users2, nonPartner: true },
      { to: "/stock", key: "stock", icon: Package },
      { to: "/assets", key: "assets", icon: Box },
    ],
  },
  {
    key: "grp_partnerships",
    icon: Star,
    items: [
      { to: "/partner-associations", key: "partner_ratings", icon: Star, adminManagerOnly: true },
    ],
  },
];

// Roles that may see investments / income / expense / profit-loss / milestones / TDS.
// Must mirror FINANCE_VISIBLE_ROLES in backend/server.py.
const FINANCE_VISIBLE_ROLES = ["admin", "partner", "senior_manager", "hr", "accountant"];
// Roles that get a useful `/` landing — finance roles see the financial dashboard, plus
// center_manager which gets the operational dashboard (rendered by App.js based on role).
const DASHBOARD_ROLES = [...FINANCE_VISIBLE_ROLES, "center_manager"];

// Sidebar navigation body — shared between desktop <aside> and the mobile Sheet drawer.
// Renders grouped, collapsible menu with active-state highlighting and
// auto-expansion when a child route is active.
function SidebarBody({ t, visibleGroups, badgeFor, onNavigate, companyLine, expanded, toggleGroup, currentPath }) {
  return (
    <>
      <div className="px-5 py-5 border-b border-[var(--border)]">
        <div className="text-xs overline">Console</div>
        <div className="font-heading text-xl font-black tracking-tight mt-1">{t("app_name")}</div>
        <div className="mt-2 pt-2 border-t border-[var(--border)] text-[10px] leading-tight text-[var(--muted)]" data-testid="company-banner">
          Welcome to<br />
          <span className="font-bold text-[var(--ink)]" data-testid="company-banner-name">
            {companyLine || "—"}
          </span>
        </div>
      </div>
      <nav className="flex-1 py-2 overflow-y-auto" data-testid="sidebar-nav">
        {visibleGroups.map((grp) => {
          const GIcon = grp.icon;
          const isOpen = expanded[grp.key];
          // Sum badges across children so a collapsed parent still shows attention.
          const groupBadge = grp.items.reduce((sum, it) => sum + (badgeFor(it.key) || 0), 0);
          // Highlight parent if any child matches the current path.
          const hasActiveChild = grp.items.some((it) => (it.end ? currentPath === it.to : currentPath === it.to || currentPath.startsWith(it.to + "/")));
          return (
            <div key={grp.key} data-testid={`navgrp-${grp.key}`} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggleGroup(grp.key)}
                data-testid={`navgrp-toggle-${grp.key}`}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm text-left transition-colors border-l-2 ${
                  hasActiveChild
                    ? "border-[var(--brand)] bg-[#f8f9fd] text-[var(--ink)] font-semibold"
                    : "border-transparent text-[var(--ink)] hover:bg-gray-50 font-semibold"
                }`}
              >
                <GIcon size={16} strokeWidth={1.8} className={hasActiveChild ? "text-[var(--brand)]" : "text-[var(--muted)]"} />
                <span className="flex-1 tracking-tight uppercase text-[11px]">{t(grp.key)}</span>
                {groupBadge > 0 && !isOpen && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-[var(--brand)] text-white px-1.5" data-testid={`navgrp-badge-${grp.key}`}>
                    {groupBadge}
                  </span>
                )}
                {isOpen
                  ? <ChevronDown size={14} strokeWidth={2} className="text-[var(--muted)]" />
                  : <ChevronRight size={14} strokeWidth={2} className="text-[var(--muted)]" />}
              </button>
              {isOpen && (
                <div className="pb-1" data-testid={`navgrp-body-${grp.key}`}>
                  {grp.items.map((it) => {
                    const Icon = it.icon;
                    const badge = badgeFor(it.key);
                    return (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        end={it.end}
                        onClick={onNavigate}
                        data-testid={`nav-${it.key}`}
                        className={({ isActive }) =>
                          `flex items-center gap-3 pl-10 pr-5 py-2 text-[13px] border-l-2 transition-colors ${
                            isActive
                              ? "border-[var(--brand)] bg-[#f3f5fb] text-[var(--brand)] font-medium"
                              : "border-transparent text-[var(--muted)] hover:text-[var(--text)] hover:bg-gray-50"
                          }`
                        }
                      >
                        <Icon size={14} strokeWidth={1.6} />
                        <span className="flex-1">{t(it.key)}</span>
                        {badge > 0 && (
                          <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-[var(--brand)] text-white px-1.5" data-testid={`badge-${it.key}`}>
                            {badge}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="p-4 text-xs overline">v1.0</div>
    </>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { lang, switchLang, t } = useLang();
  const nav = useNavigate();
  const location = useLocation();
  const [tasks, setTasks] = useState({ txn_pending: 0, reimb_l1: 0, reimb_accountant: 0, reimb_pay: 0, payroll_pay: 0, total: 0 });
  const [notifs, setNotifs] = useState({ items: [], unread: 0 });
  const [mobileOpen, setMobileOpen] = useState(false);
  // Scoped company names for the sidebar welcome banner — respects the same
  // visibility rules as /entities/company (partner sees only their mapped
  // companies; center_manager/staff see companies at their centers; admin
  // sees everything).
  const [companyLine, setCompanyLine] = useState("");

  useEffect(() => {
    if (!user) return;
    const load = () => {
      api.get("/tasks/my").then((r) => setTasks(r.data)).catch(() => {});
      api.get("/notifications?limit=10").then((r) => setNotifs(r.data)).catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (!user) { setCompanyLine(""); return; }
    api.get("/entities/company")
      .then((r) => {
        const names = (r.data || []).map((c) => c.name).filter(Boolean);
        setCompanyLine(names.length === 0 ? "—" : names.slice(0, 3).join(" · ") + (names.length > 3 ? ` +${names.length - 3}` : ""));
      })
      .catch(() => setCompanyLine("—"));
  }, [user]);

  const markAllRead = async () => {
    try {
      await api.patch("/notifications/mark-all-read");
      setNotifs((n) => ({ items: n.items.map((it) => ({ ...it, read: true })), unread: 0 }));
    } catch {
      // Best-effort: keep current UI state if the call fails (e.g. transient network).
    }
  };

  const onNotifClick = async (n) => {
    if (!n.read) {
      try {
        await api.patch(`/notifications/${n.id}/read`);
      } catch {
        // best-effort
      }
      setNotifs((s) => ({
        items: s.items.map((it) => it.id === n.id ? { ...it, read: true } : it),
        unread: Math.max(0, s.unread - 1),
      }));
    }
    if (n.link) nav(n.link);
  };

  const badgeFor = (key) => {
    if (key === "transactions") return tasks.txn_pending;
    if (key === "HRMS") return tasks.reimb_l1 + tasks.reimb_accountant + tasks.reimb_pay + tasks.payroll_pay;
    if (key === "pending_approvals") return tasks.pending_approvals || 0;
    return 0;
  };

  const handleLogout = async () => {
    await logout();
    nav("/login");
  };

  // Role gate — mirrors the previous flat `navItems.filter` exactly so no
  // permission model changes; just relocated into a helper.
  const canSee = (it) => {
    if (it.adminOnly && user?.role !== "admin") return false;
    if (it.adminManagerOnly && !["admin", "manager"].includes(user?.role)) return false;
    if (it.accountingOnly && !["admin", "accountant", "senior_manager", "hr"].includes(user?.role)) return false;
    if (it.hrOrAdmin && !["admin", "hr"].includes(user?.role)) return false;
    if (it.hrLineOnly && !["admin", "hr", "senior_manager", "manager", "center_manager"].includes(user?.role)) return false;
    if (it.candidateAccess && !["admin", "hr", "manager", "center_manager", "partner"].includes(user?.role)) return false;
    if (it.bgAccess && !["admin", "hr", "manager", "senior_manager", "accountant", "center_manager", "partner"].includes(user?.role)) return false;
    if (it.misAccess && !["admin", "hr", "manager", "senior_manager", "accountant", "center_manager", "partner", "staff", "center_staff"].includes(user?.role)) return false;
    if (it.financeOnly && !FINANCE_VISIBLE_ROLES.includes(user?.role)) return false;
    if (it.adminAccountantOnly && !["admin", "accountant"].includes(user?.role)) return false;
    if (it.programsAccess && ![...FINANCE_VISIBLE_ROLES, "center_manager"].includes(user?.role)) return false;
    if (it.invoiceAccess && !["admin", "accountant", "hr", "senior_manager", "manager", "partner", "center_manager", "reporting_authority"].includes(user?.role)) return false;
    if (it.batchMgmtAccess && !["admin", "manager", "senior_manager", "accountant", "hr", "center_manager"].includes(user?.role)) return false;
    if (it.nonPartner && user?.role === "partner") return false;
    if (it.staffOnly && !["center_staff", "center_manager", "hr", "manager", "senior_manager"].includes(user?.role)) return false;
    if (it.dashboardRoles && !DASHBOARD_ROLES.includes(user?.role)) return false;
    return true;
  };

  // Group-level visibility: hide any group whose every item is filtered out.
  // If the user only has access to one submenu inside a group, the group and
  // that single submenu still render (per product requirement).
  const visibleGroups = useMemo(() => {
    return navGroups
      .map((g) => ({ ...g, items: g.items.filter(canSee) }))
      .filter((g) => g.items.length > 0);
  }, [user?.role]);

  // Track which groups are expanded. A group opens automatically when one of
  // its children matches the current route. User can still manually toggle.
  const [expanded, setExpanded] = useState({});
  useEffect(() => {
    // On route change, ensure the parent of the active route is expanded.
    setExpanded((prev) => {
      const next = { ...prev };
      let mutated = false;
      visibleGroups.forEach((g) => {
        const activeChild = g.items.some((it) =>
          it.end ? location.pathname === it.to
                 : location.pathname === it.to || location.pathname.startsWith(it.to + "/"));
        if (activeChild && !next[g.key]) {
          next[g.key] = true;
          mutated = true;
        }
      });
      // First-load fallback: open the Dashboard group by default.
      if (Object.keys(prev).length === 0 && !mutated) {
        next.grp_dashboard = true;
        mutated = true;
      }
      return mutated ? next : prev;
    });
  }, [location.pathname, visibleGroups]);

  const toggleGroup = (key) => setExpanded((s) => ({ ...s, [key]: !s[key] }));

  // Breadcrumb — resolve the active submenu + its parent group label.
  const breadcrumb = useMemo(() => {
    for (const g of visibleGroups) {
      for (const it of g.items) {
        const active = it.end
          ? location.pathname === it.to
          : location.pathname === it.to || location.pathname.startsWith(it.to + "/");
        if (active) return { group: t(g.key), page: t(it.key) };
      }
    }
    return null;
  }, [location.pathname, visibleGroups, t]);

  // ---- Bottom tab-bar (mobile-only) — 4 shortcuts + "Menu" -----------------
  const totalApprovalBadge = (tasks.pending_approvals || 0) + (tasks.txn_pending || 0);
  const bottomTabs = useMemo(() => {
    const list = [];
    if (DASHBOARD_ROLES.includes(user?.role)) {
      list.push({ to: "/", key: "dashboard", icon: LayoutDashboard, end: true });
    }
    // Check-in is available to all authenticated staff, HR, admin etc.
    list.push({ to: "/check-in", key: "checkin", icon: Fingerprint, label: "Check-in" });
    list.push({ to: "/pending-approvals", key: "pending_approvals", icon: Inbox, badge: totalApprovalBadge });
    list.push({ to: "/hrms", key: "HRMS", icon: Users });
    return list.slice(0, 4); // cap at 4 so "Menu" always fits as the 5th
  }, [user?.role, totalApprovalBadge]);

  return (
    <div className="min-h-screen flex" data-testid="app-layout">
      {/* Desktop sidebar */}
      <aside className="w-60 shrink-0 border-r border-[var(--border)] bg-white hidden md:flex md:flex-col">
        <SidebarBody
          t={t}
          visibleGroups={visibleGroups}
          badgeFor={badgeFor}
          companyLine={companyLine}
          expanded={expanded}
          toggleGroup={toggleGroup}
          currentPath={location.pathname}
        />
      </aside>

      {/* Mobile drawer (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="p-0 w-72 max-w-[85vw] flex flex-col md:hidden"
          data-testid="mobile-drawer"
        >
          <SidebarBody
            t={t}
            visibleGroups={visibleGroups}
            badgeFor={badgeFor}
            onNavigate={() => setMobileOpen(false)}
            companyLine={companyLine}
            expanded={expanded}
            toggleGroup={toggleGroup}
            currentPath={location.pathname}
          />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[var(--border)] bg-white flex items-center justify-between px-3 md:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden inline-flex items-center justify-center h-9 w-9 -ml-1 text-[var(--ink)] hover:bg-gray-100 active:bg-gray-200 rounded-none"
              aria-label="Open menu"
              data-testid="mobile-menu-toggle"
            >
              <Menu size={22} />
            </button>
            <div className="md:hidden font-heading font-black tracking-tight text-lg truncate">{t("app_name")}</div>
            <div className="hidden md:flex items-center gap-1.5 text-[12px]" data-testid="breadcrumb">
              {breadcrumb ? (
                <>
                  <span className="text-[var(--muted)] uppercase tracking-wider text-[10px] font-semibold" data-testid="breadcrumb-group">
                    {breadcrumb.group}
                  </span>
                  <ChevronsRight size={12} className="text-[var(--muted)]" />
                  <span className="text-[var(--ink)] font-semibold" data-testid="breadcrumb-page">
                    {breadcrumb.page}
                  </span>
                </>
              ) : (
                <span className="overline">{t("dashboard")} · {user?.role}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-none relative h-9 px-2" data-testid="notif-bell">
                  <Bell size={16} />
                  {notifs.unread > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] text-[10px] font-bold bg-[var(--danger)] text-white px-1" data-testid="notif-badge">
                      {notifs.unread > 9 ? "9+" : notifs.unread}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-none w-80 max-h-96 overflow-y-auto p-0">
                <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--border)]">
                  <DropdownMenuLabel className="p-0 font-heading tracking-tight">Notifications</DropdownMenuLabel>
                  {notifs.unread > 0 && (
                    <button type="button" onClick={markAllRead} className="text-xs text-[var(--brand)] hover:underline" data-testid="mark-all-read">Mark all read</button>
                  )}
                </div>
                {notifs.items.length === 0 ? (
                  <div className="py-6 text-center overline text-xs">No notifications</div>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {notifs.items.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => onNotifClick(n)}
                          data-testid={`notif-item-${n.id}`}
                          className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${n.read ? "" : "bg-[#f3f5fb]"}`}
                        >
                          <div className="flex items-start gap-2">
                            {!n.read && <span className="mt-1.5 w-1.5 h-1.5 bg-[var(--brand)] shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm ${n.read ? "text-[var(--muted)]" : "font-medium"} truncate`}>{n.message}</div>
                              <div className="overline text-[10px] mt-0.5">{new Date(n.created_at).toLocaleString()}</div>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Language — hidden on very small screens to save room */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="lang-toggle" className="rounded-none gap-1 md:gap-2 hidden xs:inline-flex sm:inline-flex">
                  <Languages size={14} /> {lang.toUpperCase()}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-none">
                <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => switchLang("en")} data-testid="lang-en">English</DropdownMenuItem>
                <DropdownMenuItem onClick={() => switchLang("hi")} data-testid="lang-hi">हिन्दी</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-none max-w-[120px] md:max-w-none truncate" data-testid="user-menu">
                  <span className="truncate">{user?.name || user?.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-none">
                <DropdownMenuLabel className="text-xs">
                  <div className="font-medium">{user?.email}</div>
                  <div className="text-[var(--muted)] overline mt-1">{user?.role}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} data-testid="logout-button" className="gap-2">
                  <LogOut size={14} /> {t("logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <AnnouncementBanner />

        <main
          className="flex-1 overflow-auto p-4 md:p-6 bg-[var(--bg)] pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-6"
          data-testid="main-content"
        >
          {children}
        </main>

        {/* Bottom tab-bar — mobile only */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--border)] flex items-stretch h-16 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(15,23,42,0.06)]"
          data-testid="mobile-bottom-nav"
          aria-label="Primary"
        >
          {bottomTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                data-testid={`mobile-tab-${tab.key}`}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium relative transition-colors ${
                    isActive
                      ? "text-[var(--brand)]"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] bg-[var(--brand)] rounded-b" />
                    )}
                    <div className="relative">
                      <Icon size={20} strokeWidth={isActive ? 2 : 1.7} />
                      {tab.badge > 0 && (
                        <span
                          className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-[16px] h-[16px] text-[9px] font-bold bg-[var(--danger)] text-white px-1"
                          data-testid={`mobile-tab-badge-${tab.key}`}
                        >
                          {tab.badge > 9 ? "9+" : tab.badge}
                        </span>
                      )}
                    </div>
                    <span className="leading-none">{tab.label || t(tab.key)}</span>
                  </>
                )}
              </NavLink>
            );
          })}
          {/* Menu tab — opens the drawer */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            data-testid="mobile-tab-menu"
            aria-label="Open menu"
          >
            <MoreHorizontal size={20} strokeWidth={1.7} />
            <span className="leading-none">Menu</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LangContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, Building2, Users, MapPin, Briefcase,
  ArrowLeftRight, FileBarChart2, LogOut, Languages, ShieldCheck, Bell, Package, ClipboardCheck, Layers, GitMerge, Settings2, Link2, Receipt, Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { to: "/", key: "dashboard", icon: LayoutDashboard, end: true },
  { to: "/companies", key: "companies", icon: Building2 },
  { to: "/partners", key: "partners", icon: Users },
  { to: "/centers", key: "centers", icon: MapPin },
  { to: "/projects", key: "projects", icon: Briefcase },
  { to: "/programs", key: "programs", icon: Layers },
  { to: "/transactions", key: "transactions", icon: ArrowLeftRight },
  { to: "/pending-approvals", key: "pending_approvals", icon: Inbox },
  { to: "/stock", key: "stock", icon: Package },
  { to: "/reports", key: "reports", icon: FileBarChart2 },
  { to: "/tds-register", key: "tds_register", icon: Receipt, accountingOnly: true },
  { to: "/hrms", key: "HRMS", icon: Users },
  { to: "/approvals", key: "approval_log", icon: ClipboardCheck, adminOnly: true },
  { to: "/approval-workflows", key: "approval_workflows", icon: GitMerge, hrOrAdmin: true },
  { to: "/partner-associations", key: "partner_associations", icon: Link2, adminManagerOnly: true },
  { to: "/hr-settings", key: "hr_settings", icon: Settings2, hrOrAdmin: true },
  { to: "/users", key: "user_management", icon: ShieldCheck, adminOnly: true },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { lang, switchLang, t } = useLang();
  const nav = useNavigate();
  const [tasks, setTasks] = useState({ txn_pending: 0, reimb_l1: 0, reimb_accountant: 0, reimb_pay: 0, payroll_pay: 0, total: 0 });
  const [notifs, setNotifs] = useState({ items: [], unread: 0 });

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

  // Memoise the role-filtered nav list so the sidebar doesn't rebuild it on every render.
  const visibleNavItems = useMemo(
    () => navItems.filter((it) => {
      if (it.adminOnly && user?.role !== "admin") return false;
      if (it.adminManagerOnly && !["admin", "manager"].includes(user?.role)) return false;
      if (it.accountingOnly && !["admin", "accountant", "senior_manager", "hr"].includes(user?.role)) return false;
      if (it.hrOrAdmin && !["admin", "hr"].includes(user?.role)) return false;
      return true;
    }),
    [user?.role],
  );

  return (
    <div className="min-h-screen flex" data-testid="app-layout">
      <aside className="w-60 shrink-0 border-r border-[var(--border)] bg-white hidden md:flex md:flex-col">
        <div className="px-5 py-5 border-b border-[var(--border)]">
          <div className="text-xs overline">Console</div>
          <div className="font-heading text-xl font-black tracking-tight mt-1">{t("app_name")}</div>
          <div className="mt-2 pt-2 border-t border-[var(--border)] text-[10px] leading-tight text-[var(--muted)]" data-testid="company-banner">
            Welcome to<br/><span className="font-medium text-[var(--ink)]">Mashara Skills and Creative Learning Pvt Ltd</span>
          </div>
        </div>
        <nav className="flex-1 py-3" data-testid="sidebar-nav">
          {visibleNavItems.map((it) => {
            const Icon = it.icon;
            const badge = badgeFor(it.key);
            return (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                data-testid={`nav-${it.key}`}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-2.5 text-sm border-l-2 transition-colors ${
                    isActive
                      ? "border-[var(--brand)] bg-[#f3f5fb] text-[var(--brand)] font-medium"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--text)] hover:bg-gray-50"
                  }`
                }
              >
                <Icon size={16} strokeWidth={1.6} />
                <span className="flex-1">{t(it.key)}</span>
                {badge > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-[var(--brand)] text-white px-1.5" data-testid={`badge-${it.key}`}>
                    {badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-4 text-xs overline">v1.0</div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[var(--border)] bg-white flex items-center justify-between px-4 md:px-6">
          <div className="md:hidden font-heading font-black tracking-tight text-lg">{t("app_name")}</div>
          <div className="hidden md:block overline">{t("dashboard")} · {user?.role}</div>
          <div className="flex items-center gap-2">
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="lang-toggle" className="rounded-none gap-2">
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
                <Button variant="outline" size="sm" className="rounded-none" data-testid="user-menu">
                  {user?.name || user?.email}
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

        <main className="flex-1 overflow-auto p-4 md:p-6 bg-[var(--bg)]" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}

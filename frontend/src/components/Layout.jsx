import React, { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LangContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, Building2, Users, MapPin, Briefcase,
  ArrowLeftRight, FileBarChart2, LogOut, Languages, ShieldCheck,
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
  { to: "/transactions", key: "transactions", icon: ArrowLeftRight },
  { to: "/reports", key: "reports", icon: FileBarChart2 },
  { to: "/hrms", key: "HRMS", icon: Users },
  { to: "/users", key: "user_management", icon: ShieldCheck, adminOnly: true },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { lang, switchLang, t } = useLang();
  const nav = useNavigate();
  const [tasks, setTasks] = useState({ txn_pending: 0, reimb_l1: 0, reimb_accountant: 0, reimb_pay: 0, payroll_pay: 0, total: 0 });

  useEffect(() => {
    if (!user) return;
    const load = () => api.get("/tasks/my").then((r) => setTasks(r.data)).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [user]);

  const badgeFor = (key) => {
    if (key === "transactions") return tasks.txn_pending;
    if (key === "HRMS") return tasks.reimb_l1 + tasks.reimb_accountant + tasks.reimb_pay + tasks.payroll_pay;
    return 0;
  };

  const handleLogout = async () => {
    await logout();
    nav("/login");
  };

  return (
    <div className="min-h-screen flex" data-testid="app-layout">
      <aside className="w-60 shrink-0 border-r border-[var(--border)] bg-white hidden md:flex md:flex-col">
        <div className="px-5 py-5 border-b border-[var(--border)]">
          <div className="text-xs overline">Console</div>
          <div className="font-heading text-xl font-black tracking-tight mt-1">{t("app_name")}</div>
        </div>
        <nav className="flex-1 py-3" data-testid="sidebar-nav">
          {navItems.filter((it) => !it.adminOnly || user?.role === "admin").map((it) => {
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

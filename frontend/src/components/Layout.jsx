import React, { useEffect, useMemo, useRef, useState, Suspense, useCallback } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LangContext";
import { usePerm } from "@/context/PermissionContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, Building2, Users, MapPin, Briefcase,
  ArrowLeftRight, FileBarChart2, LogOut, Languages, ShieldCheck, Bell, Package, ClipboardCheck, Layers, GitMerge, Settings2, Receipt, Inbox, History, Box, UserCog, FileSignature, Users2, UserPlus, Landmark, MessageSquare, AlertCircle,
  Menu, Fingerprint, MoreHorizontal, Wallet, PieChart, BarChart3, Target,
  ChevronDown, ChevronsRight, Star, FileText, CreditCard, Lock, Building, Handshake, GraduationCap, Percent, Network, UtensilsCrossed,
  Search, Pin, Clock, PanelLeftClose, PanelLeftOpen, CornerDownLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import CompanySwitcher from "@/components/CompanySwitcher";
import FYSwitcher from "@/components/FYSwitcher";
import TrialBanner from "@/components/TrialBanner";

// ---------------------------------------------------------------------------
// Navigation configuration — a single source of truth. Every entry REUSES its
// existing route, icon, role-gate flag, RBAC menu and subscription module from
// the previous sidebar. No routes/permissions are added or changed here; this
// is purely a UI restructuring into categories + search/favorites/recent.
// ---------------------------------------------------------------------------

// Dashboard — standalone top-level item (never inside a collapsible category).
const dashboardNav = { to: "/", key: "dashboard", icon: LayoutDashboard, end: true, dashboardRoles: true, menu: "dashboard" };

// The 10 primary business categories (color = subtle per-category identity).
const navGroups = [
  {
    key: "grp_organization", icon: Building2, color: "#818cf8", menu: "org",
    items: [
      { to: "/companies", key: "companies", icon: Building2 },
      { to: "/partners", key: "partners", icon: Users },
      { to: "/centers", key: "centers", icon: MapPin },
      { to: "/center-management", key: "center_management", icon: MapPin, adminOnly: true },
      { to: "/course-master", key: "course_master", icon: GraduationCap, batchMgmtAccess: true },
      { to: "/entity-mappings", key: "entity_mappings", icon: Network, adminOnly: true },
      { to: "/projects", key: "projects", icon: Briefcase },
    ],
  },
  {
    key: "grp_batch", icon: Layers, color: "#a78bfa", menu: "batch",
    items: [
      { to: "/batch-management", key: "batch_management", icon: Target, batchMgmtAccess: true },
      { to: "/rate-config", key: "rate_config", icon: Percent, adminOnly: true },
    ],
  },
  {
    key: "grp_finance", icon: Wallet, color: "#34d399", menu: "finance",
    items: [
      { to: "/programs", key: "programs", icon: Layers, programsAccess: true, module: "finance" },
      { to: "/invoices", key: "invoices", icon: FileText, invoiceAccess: true, module: "finance" },
      { to: "/payment-dashboard", key: "payment_dashboard", icon: PieChart, financeOnly: true },
      { to: "/transactions", key: "transactions", icon: ArrowLeftRight, financeOnly: true, module: "finance" },
      { to: "/advances", key: "advances", icon: Wallet, module: "finance" },
      { to: "/quotations", key: "payment_request", icon: FileSignature, nonPartner: true, module: "finance" },
      { to: "/bank-reconciliation", key: "bank_reconciliation", icon: Wallet, adminAccountantOnly: true, module: "finance" },
      { to: "/bank-guarantees", key: "bank_guarantees", icon: Landmark, bgAccess: true, module: "bank_guarantee" },
      { to: "/tds-register", key: "tds_register", icon: Receipt, financeOnly: true, module: "finance" },
      { to: "/mis", key: "mis_dashboard", icon: BarChart3, misAccess: true, module: "mis" },
      { to: "/reports", key: "reports", icon: FileBarChart2, financeOnly: true, module: "finance" },
    ],
  },
  {
    key: "grp_approvals", icon: ClipboardCheck, color: "#fbbf24", menu: "approvals",
    items: [
      { to: "/pending-approvals", key: "pending_approvals", icon: Inbox },
      { to: "/approvals", key: "approval_log", icon: ClipboardCheck, adminOnly: true },
      { to: "/approval-workflows", key: "approval_workflows", icon: GitMerge, hrOrAdmin: true },
      { to: "/notifications", key: "notifications", icon: MessageSquare, adminOnly: true, module: "notifications" },
    ],
  },
  {
    key: "grp_candidates", icon: GraduationCap, color: "#22d3ee", menu: "candidates",
    items: [
      { to: "/candidates", key: "candidates", icon: UserPlus, candidateAccess: true },
      { to: "/me/profile", key: "my_profile", icon: UserCog },
    ],
  },
  {
    key: "grp_hr", icon: Users, color: "#f472b6", menu: "hr",
    items: [
      { to: "/hrms", key: "HRMS", icon: Users, module: "hr" },
      { to: "/employee-transfers", key: "employee_transfers", icon: UserCog, hrLineOnly: true, module: "hr" },
      { to: "/hrms/financial-history", key: "financial_history", icon: Wallet, hrOrAdminOrAccountant: true, module: "payroll" },
      { to: "/hr-settings", key: "hr_settings", icon: Settings2, hrOrAdmin: true, module: "hr" },
      { to: "/users", key: "user_management", icon: ShieldCheck, adminOnly: true },
    ],
  },
  {
    key: "grp_procurement", icon: Package, color: "#fb923c", menu: "procurement",
    items: [
      { to: "/vendors", key: "vendors", icon: Users2, nonPartner: true },
      { to: "/stock", key: "stock", icon: Package },
      { to: "/assets", key: "assets", icon: Box },
    ],
  },
  {
    key: "grp_mess", icon: UtensilsCrossed, color: "#2dd4bf", menu: "mess",
    items: [
      { to: "/mess", key: "mess_management", icon: UtensilsCrossed, messAccess: true },
    ],
  },
  {
    key: "grp_partnerships", icon: Handshake, color: "#c084fc", menu: "partnerships",
    items: [
      { to: "/partner-settlement", key: "partner_settlement", icon: Handshake, settlementAccess: true },
      { to: "/partner-associations", key: "partner_ratings", icon: Star, adminManagerOnly: true },
    ],
  },
];

// System & Administration — kept OUTSIDE the business categories (bottom section).
// Items carry their original RBAC menu so permission behaviour is unchanged.
const systemGroup = {
  key: "grp_system", icon: Settings2, color: "#94a3b8",
  items: [
    { to: "/subscription", key: "subscription", icon: CreditCard, adminOnly: true, menu: "subscription" },
    { to: "/companies-admin", key: "companies_admin", icon: Building, superAdminOnly: true, menu: "subscription" },
    { to: "/menu-access-control", key: "roles_permissions", icon: ShieldCheck, adminOnly: true, menu: "org" },
    { to: "/login-history", key: "login_history", icon: History, adminOnly: true, menu: "hr" },
  ],
};

const ALL_GROUPS = [...navGroups, systemGroup];

// Map a URL path → gated subscription module (for the "Module Locked" screen).
const ROUTE_TO_MODULE = [dashboardNav, ...ALL_GROUPS.flatMap((g) => g.items)]
  .filter((it) => it.module)
  .map((it) => ({ to: it.to, module: it.module, label: it.key }));

function moduleForPath(path) {
  let best = null;
  for (const r of ROUTE_TO_MODULE) {
    if (path === r.to || path.startsWith(r.to + "/")) {
      if (!best || r.to.length > best.to.length) best = r;
    }
  }
  return best;
}

const FINANCE_VISIBLE_ROLES = ["admin", "partner", "senior_manager", "hr", "accountant"];
const DASHBOARD_ROLES = [...FINANCE_VISIBLE_ROLES, "center_manager"];

const isActivePath = (pathname, it) =>
  it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(it.to + "/");

// ---------------------------------------------------------------------------
// Expanded sidebar body — shared between desktop <aside> and mobile drawer.
// ---------------------------------------------------------------------------
function SidebarBody({
  t, visibleGroups, visibleSystem, showDashboard, badgeFor, onNavigate,
  companyLine, openGroup, toggleGroup, currentPath, blockedModules = [],
  favorites, recent, toggleFav, itemIndex, onLogout,
  search, setSearch, searchResults, searchActive, setSearchActive, searchRef,
  activeIdx, setActiveIdx, onSearchKeyDown, collapsible, collapsed, setCollapsed,
}) {
  // Only show Favorites/Recent for items the current user can still see.
  const favResolved = favorites.filter((to) => itemIndex.has(to));
  const recentResolved = recent.filter((to) => itemIndex.has(to));
  const renderItemLink = (it, { inFav = false } = {}) => {
    const Icon = it.icon;
    const badge = badgeFor(it.key);
    const isLocked = it.module && blockedModules.includes(it.module);
    const pinned = favorites.includes(it.to);
    return (
      <NavLink
        key={(inFav ? "fav-" : "") + it.to}
        to={it.to}
        end={it.end}
        onClick={onNavigate}
        data-testid={`nav-${it.key}`}
        className={({ isActive }) =>
          `sb-link group/link flex items-center gap-3 ${inFav ? "pl-3" : "pl-9"} pr-2 py-2 text-[13px] rounded-lg mx-2 ${isActive ? "sb-link-active font-semibold" : "font-medium"} ${isLocked && !isActive ? "opacity-60" : ""}`
        }
        title={isLocked ? "Module locked — Subscribe to unlock" : undefined}
      >
        <Icon size={15} strokeWidth={1.8} className="shrink-0" />
        <span className="flex-1 truncate">{t(it.key)}</span>
        {isLocked && <Lock size={11} className="text-amber-400" data-testid={`nav-lock-${it.key}`} aria-label="module locked" />}
        {badge > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-[var(--sb-badge)] text-[#1f1300] rounded-full px-1.5" data-testid={`badge-${it.key}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(it.to); }}
          className={`sb-pin ${pinned ? "sb-pin-active" : ""}`}
          data-testid={`pin-${it.key}`}
          title={pinned ? t("unpin_from_favorites") : t("pin_to_favorites")}
          aria-label={pinned ? t("unpin_from_favorites") : t("pin_to_favorites")}
        >
          <Pin size={12} fill={pinned ? "currentColor" : "none"} />
        </button>
      </NavLink>
    );
  };

  const renderGroup = (grp) => {
    const GIcon = grp.icon;
    const isOpen = openGroup === grp.key;
    const groupBadge = grp.items.reduce((s, it) => s + (badgeFor(it.key) || 0), 0);
    const hasActiveChild = grp.items.some((it) => isActivePath(currentPath, it));
    return (
      <div key={grp.key} data-testid={`navgrp-${grp.key}`} className="mb-0.5">
        <button
          type="button"
          onClick={() => toggleGroup(grp.key)}
          data-testid={`navgrp-toggle-${grp.key}`}
          className={`sb-group w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left rounded-lg mx-2 ${hasActiveChild ? "sb-group-active" : ""}`}
          style={{ width: "calc(100% - 1rem)" }}
        >
          <GIcon size={17} strokeWidth={1.9} style={{ color: hasActiveChild ? "#fff" : grp.color }} />
          <span className="flex-1 tracking-wide uppercase text-[11px] font-semibold flex items-center gap-2">
            {t(grp.key)}
            <span className="sb-cat-dot" style={{ background: grp.color, opacity: hasActiveChild ? 1 : 0.5 }} />
          </span>
          {groupBadge > 0 && !isOpen && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-[var(--sb-badge)] text-[#1f1300] rounded-full px-1.5" data-testid={`navgrp-badge-${grp.key}`}>
              {groupBadge > 99 ? "99+" : groupBadge}
            </span>
          )}
          <ChevronDown size={14} strokeWidth={2.2} className="sb-chevron text-[var(--sb-text2)]" style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }} />
        </button>
        {isOpen && (
          <div className="pb-1 pt-0.5" data-testid={`navgrp-body-${grp.key}`}>
            {grp.items.map((it) => renderItemLink(it))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Brand + collapse control */}
      <div className="px-4 py-4 border-b border-[var(--sb-divider)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--sb-active)] to-[var(--sb-active2)] flex items-center justify-center shrink-0 shadow-md">
            <Landmark size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-heading text-[15px] font-bold tracking-tight text-white leading-tight truncate">{t("app_name")}</div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-[var(--sb-text2)]">Finance Console</div>
          </div>
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="hidden md:inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--sb-text2)] hover:bg-[var(--sb-hover)] hover:text-white transition-colors"
              data-testid="sidebar-collapse-btn"
              title={t("collapse_sidebar")}
              aria-label={t("collapse_sidebar")}
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Global search */}
      <div className="px-3 pt-3 pb-1 relative">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sb-text2)] pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchActive(true); setActiveIdx(0); }}
            onFocus={() => setSearchActive(true)}
            onKeyDown={onSearchKeyDown}
            placeholder={t("nav_search_placeholder")}
            data-testid="sidebar-search-input"
            className="sb-search-field w-full rounded-lg pl-9 pr-12 py-2 text-[13px]"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-[var(--sb-text2)] border border-[var(--sb-divider)] rounded px-1 py-0.5 pointer-events-none">⌘K</kbd>
        </div>
        {searchActive && search.trim() && (
          <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-[#0d2240] border border-[var(--sb-divider)] rounded-lg shadow-2xl overflow-hidden max-h-80 overflow-y-auto sb-scroll" data-testid="sidebar-search-results">
            {searchResults.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-[var(--sb-text2)]" data-testid="search-empty">{t("no_results")}</div>
            ) : (
              searchResults.map((r, i) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.to}
                    type="button"
                    onClick={() => r.onSelect()}
                    onMouseEnter={() => setActiveIdx(i)}
                    data-testid={`search-result-${r.key}`}
                    className={`sb-result w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] ${i === activeIdx ? "sb-result-active" : ""}`}
                  >
                    <Icon size={14} className="shrink-0" style={{ color: r.color }} />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{r.labelNode}</span>
                      <span className="block text-[10px] uppercase tracking-wide text-[var(--sb-text2)] truncate">{r.groupLabel}</span>
                    </span>
                    {i === activeIdx && <CornerDownLeft size={12} className="text-[var(--sb-text2)]" />}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 py-2 overflow-y-auto sb-scroll" data-testid="sidebar-nav">
        {/* Dashboard — standalone */}
        {showDashboard && (
          <div className="mb-1">
            <NavLink
              to={dashboardNav.to}
              end
              onClick={onNavigate}
              data-testid="nav-dashboard"
              className={({ isActive }) => `sb-link flex items-center gap-3 px-3 py-2.5 text-[13px] rounded-lg mx-2 ${isActive ? "sb-link-active font-semibold" : "font-medium"}`}
            >
              <LayoutDashboard size={16} strokeWidth={1.9} />
              <span className="flex-1">{t("dashboard")}</span>
            </NavLink>
          </div>
        )}

        {/* Favorites */}
        {favResolved.length > 0 && (
          <div className="mt-2 mb-1" data-testid="sidebar-favorites">
            <div className="px-4 py-1.5 flex items-center gap-2">
              <Star size={11} className="text-[var(--sb-badge)]" fill="currentColor" />
              <span className="sb-section-label flex-1">{t("favorites")}</span>
            </div>
            {favResolved.map((to) => {
              const it = itemIndex.get(to);
              return <div key={to} className="sb-fav-row">{renderItemLink(it, { inFav: true })}</div>;
            })}
          </div>
        )}

        {/* Recent pages */}
        {recentResolved.length > 0 && (
          <div className="mt-2 mb-1" data-testid="sidebar-recent">
            <div className="px-4 py-1.5 flex items-center gap-2">
              <Clock size={11} className="text-[var(--sb-text2)]" />
              <span className="sb-section-label flex-1">{t("recent_pages")}</span>
            </div>
            {recentResolved.map((to) => {
              const it = itemIndex.get(to);
              const Icon = it.icon;
              return (
                <NavLink
                  key={"recent-" + to}
                  to={to}
                  end={it.end}
                  onClick={onNavigate}
                  data-testid={`recent-${it.key}`}
                  className={({ isActive }) => `sb-link flex items-center gap-3 pl-9 pr-3 py-1.5 text-[12.5px] rounded-lg mx-2 ${isActive ? "sb-link-active font-semibold" : "font-medium"}`}
                >
                  <Icon size={14} strokeWidth={1.8} className="shrink-0" />
                  <span className="flex-1 truncate">{t(it.key)}</span>
                </NavLink>
              );
            })}
          </div>
        )}

        <div className="my-2 mx-4 border-t border-[var(--sb-divider)]" />

        {/* Business categories */}
        {visibleGroups.map(renderGroup)}

        {/* System & Administration */}
        {visibleSystem && visibleSystem.items.length > 0 && (
          <>
            <div className="mt-3 mb-1 mx-4 border-t border-[var(--sb-divider)]" />
            <div className="px-4 py-1.5">
              <span className="sb-section-label">{t("grp_system")}</span>
            </div>
            {renderGroup(visibleSystem)}
          </>
        )}

        {/* Logout */}
        <div className="mt-2 mb-1 px-2">
          <button
            type="button"
            onClick={onLogout}
            data-testid="sidebar-logout"
            className="sb-link w-full flex items-center gap-3 px-3 py-2.5 text-[13px] rounded-lg font-medium"
          >
            <LogOut size={15} strokeWidth={1.8} />
            <span>{t("logout")}</span>
          </button>
        </div>
      </nav>

      <div className="px-4 py-2 border-t border-[var(--sb-divider)]">
        <div className="text-[10px] leading-tight text-[var(--sb-text2)]" data-testid="company-banner">
          <span className="font-bold text-white truncate block" data-testid="company-banner-name">{companyLine || "—"}</span>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Collapsed rail (desktop icon-only mode).
// ---------------------------------------------------------------------------
function SidebarRail({ t, visibleGroups, visibleSystem, showDashboard, badgeFor, favorites, itemIndex, currentPath, openGroupInExpanded, setCollapsed, onLogout, focusSearch }) {
  const railBtn = (key, Icon, { to, color, onClick, badge = 0, active = false, testid } = {}) => {
    const content = (
      <>
        <Icon size={19} strokeWidth={1.9} style={{ color: active ? "#fff" : (color || "var(--sb-text2)") }} />
        {badge > 0 && (
          <span className="absolute top-1 right-1.5 inline-flex items-center justify-center min-w-[15px] h-[15px] text-[9px] font-bold bg-[var(--sb-badge)] text-[#1f1300] rounded-full px-1">{badge > 9 ? "9+" : badge}</span>
        )}
        <span className="sb-tip">{t(key)}</span>
      </>
    );
    const cls = `sb-rail-btn relative w-full flex items-center justify-center h-11 rounded-lg ${active ? "sb-rail-active" : ""}`;
    if (to && !onClick) {
      return (
        <NavLink key={testid || key} to={to} end className={cls} data-testid={testid} title={t(key)}>{content}</NavLink>
      );
    }
    return (
      <button key={testid || key} type="button" onClick={onClick} className={cls} data-testid={testid} title={t(key)}>{content}</button>
    );
  };

  return (
    <div className="flex flex-col h-full py-3">
      <div className="px-2 flex flex-col items-center gap-2 border-b border-[var(--sb-divider)] pb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--sb-active)] to-[var(--sb-active2)] flex items-center justify-center shadow-md">
          <Landmark size={18} className="text-white" />
        </div>
        <button type="button" onClick={() => setCollapsed(false)} className="sb-rail-btn relative w-full flex items-center justify-center h-9 rounded-lg" data-testid="sidebar-expand-btn" title={t("expand_sidebar")}>
          <PanelLeftOpen size={16} />
          <span className="sb-tip">{t("expand_sidebar")}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto sb-scroll px-2 mt-2 flex flex-col gap-1">
        <button type="button" onClick={focusSearch} className="sb-rail-btn relative w-full flex items-center justify-center h-11 rounded-lg" data-testid="rail-search" title={t("nav_search_placeholder")}>
          <Search size={18} />
          <span className="sb-tip">{t("nav_search_placeholder")}</span>
        </button>

        {showDashboard && railBtn("dashboard", LayoutDashboard, { to: "/", active: currentPath === "/", testid: "rail-dashboard", color: "#60a5fa" })}

        {favorites.length > 0 && (
          <>
            <div className="h-px bg-[var(--sb-divider)] my-1" />
            {favorites.map((to) => {
              const it = itemIndex.get(to);
              if (!it) return null;
              return railBtn(it.key, it.icon, { to: it.to, active: isActivePath(currentPath, it), testid: `rail-fav-${it.key}`, color: "#fbbf24" });
            })}
          </>
        )}

        <div className="h-px bg-[var(--sb-divider)] my-1" />
        {visibleGroups.map((grp) => {
          const groupBadge = grp.items.reduce((s, it) => s + (badgeFor(it.key) || 0), 0);
          const active = grp.items.some((it) => isActivePath(currentPath, it));
          return railBtn(grp.key, grp.icon, {
            color: grp.color, badge: groupBadge, active, testid: `rail-grp-${grp.key}`,
            onClick: () => openGroupInExpanded(grp.key),
          });
        })}

        {visibleSystem && visibleSystem.items.length > 0 && (
          <>
            <div className="h-px bg-[var(--sb-divider)] my-1" />
            {railBtn(systemGroup.key, Settings2, { color: systemGroup.color, active: visibleSystem.items.some((it) => isActivePath(currentPath, it)), testid: "rail-grp-grp_system", onClick: () => openGroupInExpanded(systemGroup.key) })}
          </>
        )}
      </div>

      <div className="px-2 pt-2 border-t border-[var(--sb-divider)]">
        <button type="button" onClick={onLogout} className="sb-rail-btn relative w-full flex items-center justify-center h-11 rounded-lg" data-testid="rail-logout" title={t("logout")}>
          <LogOut size={18} />
          <span className="sb-tip">{t("logout")}</span>
        </button>
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout, scope } = useAuth();
  const { lang, switchLang, t } = useLang();
  const { can } = usePerm();
  const nav = useNavigate();
  const location = useLocation();
  const [tasks, setTasks] = useState({ txn_pending: 0, reimb_l1: 0, reimb_accountant: 0, reimb_pay: 0, payroll_pay: 0, total: 0 });
  const [notifs, setNotifs] = useState({ items: [], unread: 0 });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companyLine, setCompanyLine] = useState("");

  const uid = user?.id || "anon";

  // ---- Persisted UI preferences (per-device localStorage) ----
  const [collapsed, setCollapsedState] = useState(() => localStorage.getItem("sb_collapsed") === "1");
  const setCollapsed = useCallback((v) => {
    setCollapsedState(v);
    localStorage.setItem("sb_collapsed", v ? "1" : "0");
  }, []);
  const [favorites, setFavorites] = useState([]);
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    try { setFavorites(JSON.parse(localStorage.getItem(`sb_fav_${uid}`) || "[]")); } catch { setFavorites([]); }
    try { setRecent(JSON.parse(localStorage.getItem(`sb_recent_${uid}`) || "[]")); } catch { setRecent([]); }
  }, [uid]);

  const toggleFav = useCallback((to) => {
    setFavorites((prev) => {
      const next = prev.includes(to) ? prev.filter((x) => x !== to) : [...prev, to];
      localStorage.setItem(`sb_fav_${uid}`, JSON.stringify(next));
      return next;
    });
  }, [uid]);

  // ---- Search ----
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const desktopSearchRef = useRef(null);
  const drawerSearchRef = useRef(null);

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
    } catch { /* best-effort */ }
  };

  const onNotifClick = async (n) => {
    if (!n.read) {
      try { await api.patch(`/notifications/${n.id}/read`); } catch { /* best-effort */ }
      setNotifs((s) => ({ items: s.items.map((it) => it.id === n.id ? { ...it, read: true } : it), unread: Math.max(0, s.unread - 1) }));
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

  // ---- RBAC filtering (unchanged logic, relocated) ----
  const isAnyAdmin = user?.role === "admin" || user?.role === "company_admin";
  const isSuperAdmin = user?.role === "admin";
  const canSee = (it) => {
    if (it.superAdminOnly && !isSuperAdmin) return false;
    if (it.adminOnly && !isAnyAdmin) return false;
    if (it.adminManagerOnly && !["admin", "company_admin", "manager"].includes(user?.role)) return false;
    if (it.settlementAccess && !["admin", "company_admin", "partner", "manager", "senior_manager", "accountant", "hr"].includes(user?.role)) return false;
    if (it.accountingOnly && !["admin", "company_admin", "accountant", "senior_manager", "hr"].includes(user?.role)) return false;
    if (it.hrOrAdmin && !["admin", "company_admin", "hr"].includes(user?.role)) return false;
    if (it.hrOrAdminOrAccountant && !["admin", "company_admin", "hr", "accountant"].includes(user?.role)) return false;
    if (it.hrLineOnly && !["admin", "company_admin", "hr", "senior_manager", "manager", "center_manager"].includes(user?.role)) return false;
    if (it.candidateAccess && !["admin", "company_admin", "hr", "manager", "center_manager", "partner"].includes(user?.role)) return false;
    if (it.bgAccess && !["admin", "company_admin", "hr", "manager", "senior_manager", "accountant", "center_manager", "partner"].includes(user?.role)) return false;
    if (it.misAccess && !["admin", "company_admin", "hr", "manager", "senior_manager", "accountant", "center_manager", "partner", "staff", "center_staff"].includes(user?.role)) return false;
    if (it.financeOnly && !FINANCE_VISIBLE_ROLES.includes(user?.role)) return false;
    if (it.adminAccountantOnly && !["admin", "company_admin", "accountant"].includes(user?.role)) return false;
    if (it.programsAccess && ![...FINANCE_VISIBLE_ROLES, "center_manager"].includes(user?.role)) return false;
    if (it.invoiceAccess && !["admin", "company_admin", "accountant", "hr", "senior_manager", "manager", "partner", "center_manager", "reporting_authority"].includes(user?.role)) return false;
    if (it.batchMgmtAccess && !["admin", "company_admin", "manager", "senior_manager", "accountant", "hr", "center_manager", "partner"].includes(user?.role)) return false;
    if (it.messAccess && !["admin", "senior_manager", "manager", "center_manager", "accountant", "mess_staff", "partner", "viewer"].includes(user?.role)) return false;
    if (it.nonPartner && user?.role === "partner") return false;
    if (it.staffOnly && !["center_staff", "center_manager", "hr", "manager", "senior_manager"].includes(user?.role)) return false;
    if (it.dashboardRoles && !DASHBOARD_ROLES.includes(user?.role)) return false;
    // Per-item RBAC menu gate (preserves MenuAccessControl behaviour for relocated items).
    if (it.menu && !can(it.menu, "view")) return false;
    return true;
  };

  const showDashboard = useMemo(() => canSee(dashboardNav), [user?.role, can]); // eslint-disable-line

  const visibleGroups = useMemo(() => {
    return navGroups
      .filter((g) => (g.menu ? can(g.menu, "view") : true))
      .map((g) => ({ ...g, items: g.items.filter(canSee) }))
      .filter((g) => g.items.length > 0);
    // eslint-disable-next-line
  }, [user?.role, can]);

  const visibleSystem = useMemo(() => {
    const items = systemGroup.items.filter(canSee);
    return { ...systemGroup, items };
    // eslint-disable-next-line
  }, [user?.role, can]);

  // Index of every visible item by path — powers search / favorites / recent
  // and automatically respects permissions (unauthorized items are absent).
  const itemIndex = useMemo(() => {
    const m = new Map();
    const push = (it, grp) => m.set(it.to, { ...it, groupKey: grp?.key, groupLabel: grp ? t(grp.key) : t("dashboard"), color: grp?.color || "#60a5fa" });
    if (showDashboard) push(dashboardNav, null);
    visibleGroups.forEach((g) => g.items.forEach((it) => push(it, g)));
    if (visibleSystem.items.length) visibleSystem.items.forEach((it) => push(it, systemGroup));
    return m;
    // eslint-disable-next-line
  }, [visibleGroups, visibleSystem, showDashboard, t]);

  // ---- Single-accordion open group (auto-opens the active category) ----
  const [openGroup, setOpenGroup] = useState(null);
  useEffect(() => {
    const all = [...visibleGroups, visibleSystem];
    const g = all.find((grp) => grp.items.some((it) => isActivePath(location.pathname, it)));
    if (g) setOpenGroup(g.key);
  }, [location.pathname, visibleGroups, visibleSystem]);
  const toggleGroup = (key) => setOpenGroup((cur) => (cur === key ? null : key));

  // ---- Recent pages tracking ----
  useEffect(() => {
    const it = itemIndex.get(location.pathname);
    if (!it || it.to === "/") return; // skip unknown + dashboard home
    setRecent((prev) => {
      const next = [it.to, ...prev.filter((x) => x !== it.to)].slice(0, 5);
      localStorage.setItem(`sb_recent_${uid}`, JSON.stringify(next));
      return next;
    });
    // eslint-disable-next-line
  }, [location.pathname, itemIndex]);

  // ---- Search results (visible items only) ----
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    itemIndex.forEach((it) => {
      const label = t(it.key);
      const idx = label.toLowerCase().indexOf(q);
      if (idx === -1) return;
      const labelNode = (
        <>{label.slice(0, idx)}<span className="sb-hl">{label.slice(idx, idx + q.length)}</span>{label.slice(idx + q.length)}</>
      );
      out.push({
        to: it.to, key: it.key, icon: it.icon, color: it.color,
        groupLabel: it.groupLabel, labelNode,
        onSelect: () => { nav(it.to); setSearch(""); setSearchActive(false); setMobileOpen(false); },
      });
    });
    return out.sort((a, b) => t(a.key).toLowerCase().indexOf(q) - t(b.key).toLowerCase().indexOf(q)).slice(0, 10);
    // eslint-disable-next-line
  }, [search, itemIndex, t]);

  const onSearchKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, Math.max(0, searchResults.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const r = searchResults[activeIdx]; if (r) r.onSelect(); }
    else if (e.key === "Escape") { setSearch(""); setSearchActive(false); desktopSearchRef.current?.blur(); drawerSearchRef.current?.blur(); }
  };

  // Expand the desktop sidebar and focus its search input (used by the rail
  // search icon and desktop Ctrl/Cmd+K). Never touches the mobile drawer.
  const focusSearch = useCallback(() => {
    setCollapsed(false);
    setSearchActive(true);
    setTimeout(() => desktopSearchRef.current?.focus(), 60);
  }, [setCollapsed]);

  // Global Ctrl/Cmd+K — viewport-aware so it never opens the (hidden) mobile
  // Sheet on desktop, whose overlay would otherwise block the whole page.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const isMobile = window.matchMedia("(max-width: 767px)").matches;
        if (isMobile) {
          setMobileOpen(true);
          setSearchActive(true);
          setTimeout(() => drawerSearchRef.current?.focus(), 90);
        } else {
          focusSearch();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);

  // Close search dropdown on route change.
  useEffect(() => { setSearchActive(false); }, [location.pathname]);

  const openGroupInExpanded = (key) => { setCollapsed(false); setOpenGroup(key); };

  // ---- Breadcrumb ----
  const breadcrumb = useMemo(() => {
    const all = [...visibleGroups, visibleSystem];
    for (const g of all) {
      for (const it of g.items) {
        if (isActivePath(location.pathname, it)) return { group: t(g.key), page: t(it.key) };
      }
    }
    return null;
  }, [location.pathname, visibleGroups, visibleSystem, t]);

  // ---- Mobile bottom tab-bar ----
  const totalApprovalBadge = (tasks.pending_approvals || 0) + (tasks.txn_pending || 0);
  const bottomTabs = useMemo(() => {
    const list = [];
    if (DASHBOARD_ROLES.includes(user?.role)) list.push({ to: "/", key: "dashboard", icon: LayoutDashboard, end: true });
    list.push({ to: "/check-in", key: "checkin", icon: Fingerprint, label: "Check-in" });
    list.push({ to: "/pending-approvals", key: "pending_approvals", icon: Inbox, badge: totalApprovalBadge });
    list.push({ to: "/hrms", key: "HRMS", icon: Users });
    return list.slice(0, 4);
  }, [user?.role, totalApprovalBadge]);

  const sharedBodyProps = {
    t, visibleGroups, visibleSystem, showDashboard, badgeFor, companyLine,
    openGroup, toggleGroup, currentPath: location.pathname,
    blockedModules: scope?.blocked_modules || [],
    favorites, recent, toggleFav, itemIndex, onLogout: handleLogout,
    search, setSearch, searchResults, searchActive, setSearchActive,
    activeIdx, setActiveIdx, onSearchKeyDown,
  };

  return (
    <div className="min-h-screen flex" data-testid="app-layout">
      {/* Desktop sidebar */}
      <aside
        className={`sb-aside shrink-0 bg-[var(--sb-bg)] hidden md:flex md:flex-col ${collapsed ? "w-[4.75rem]" : "w-64"}`}
        data-testid="desktop-sidebar"
        data-collapsed={collapsed ? "1" : "0"}
      >
        {collapsed ? (
          <SidebarRail
            t={t} visibleGroups={visibleGroups} visibleSystem={visibleSystem} showDashboard={showDashboard}
            badgeFor={badgeFor} favorites={favorites} itemIndex={itemIndex} currentPath={location.pathname}
            openGroupInExpanded={openGroupInExpanded} setCollapsed={setCollapsed} onLogout={handleLogout} focusSearch={focusSearch}
          />
        ) : (
          <SidebarBody {...sharedBodyProps} searchRef={desktopSearchRef} collapsible collapsed={collapsed} setCollapsed={setCollapsed} />
        )}
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72 max-w-[85vw] flex flex-col md:hidden bg-[var(--sb-bg)] border-r-0" data-testid="mobile-drawer">
          <SidebarBody {...sharedBodyProps} searchRef={drawerSearchRef} onNavigate={() => setMobileOpen(false)} collapsible={false} collapsed={false} setCollapsed={setCollapsed} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[var(--border)] bg-white flex items-center justify-between px-3 md:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <button type="button" onClick={() => setMobileOpen(true)} className="md:hidden inline-flex items-center justify-center h-10 w-10 -ml-1 text-[var(--ink)] hover:bg-gray-100 active:bg-gray-200 rounded-lg" aria-label="Open menu" data-testid="mobile-menu-toggle">
              <Menu size={22} />
            </button>
            <div className="md:hidden flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--brand)] to-[#15418f] flex items-center justify-center shrink-0">
                <Landmark size={16} className="text-white" />
              </div>
              <span className="font-heading font-black tracking-tight text-base leading-none">Mashara</span>
            </div>
            <div className="hidden md:flex items-center gap-1.5 text-[12px]" data-testid="breadcrumb">
              {breadcrumb ? (
                <>
                  <span className="text-[var(--muted)] uppercase tracking-wider text-[10px] font-semibold" data-testid="breadcrumb-group">{breadcrumb.group}</span>
                  <ChevronsRight size={12} className="text-[var(--muted)]" />
                  <span className="text-[var(--ink)] font-semibold" data-testid="breadcrumb-page">{breadcrumb.page}</span>
                </>
              ) : (
                <span className="overline">{t("dashboard")} · {user?.role}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="hidden md:block"><FYSwitcher /></div>
            <CompanySwitcher />
            {totalApprovalBadge > 0 && (
              <button type="button" onClick={() => nav("/pending-approvals")} data-testid="pending-requests-pill" title="Pending requests" className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors">
                <Inbox size={13} />
                <span>{totalApprovalBadge > 99 ? "99+" : totalApprovalBadge} Pending</span>
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-md relative h-9 px-2" data-testid="notif-bell">
                  <Bell size={16} />
                  {notifs.unread > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] text-[10px] font-bold bg-[var(--danger)] text-white px-1" data-testid="notif-badge">{notifs.unread > 9 ? "9+" : notifs.unread}</span>
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
                        <button type="button" onClick={() => onNotifClick(n)} data-testid={`notif-item-${n.id}`} className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${n.read ? "" : "bg-[#f3f5fb]"}`}>
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
                <Button variant="outline" size="sm" data-testid="lang-toggle" className="rounded-md gap-1 md:gap-2 hidden xs:inline-flex sm:inline-flex">
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
                <Button variant="outline" size="sm" className="rounded-md gap-2 px-2 md:px-3 md:max-w-none" data-testid="user-menu">
                  <span className="sm:hidden w-6 h-6 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] text-[11px] font-bold flex items-center justify-center shrink-0">
                    {(user?.name || user?.email || "U").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden sm:inline truncate max-w-[140px]">{user?.name || user?.email}</span>
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

        {scope?.needs_mapping && (
          <div className="mx-4 md:mx-6 mt-3 mb-1 bg-amber-50 border-l-4 border-amber-500 text-amber-900 px-4 py-3 flex items-start gap-3" data-testid="no-center-mapping-banner">
            <div className="bg-amber-500 text-white p-1.5 shrink-0 mt-0.5"><AlertCircle size={16} /></div>
            <div className="text-sm">
              <div className="font-bold">No Centers Assigned</div>
              <div className="text-xs mt-0.5">
                Aapko abhi tak koi center map nahi hua hai — isliye data lists khali dikh rahi hain.
                <br />
                Apne <b>Admin</b> ko contact karein aur unhe kaho ki <b>User Management</b> me aapko relevant centers assign karein.
                Aapka role: <span className="font-mono bg-amber-100 px-1 border border-amber-200">{scope.role}</span>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-auto p-4 md:p-6 bg-[var(--bg)] pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-6" data-testid="main-content">
          <TrialBanner />
          <Suspense fallback={<div className="flex items-center justify-center py-20 text-sm overline" data-testid="content-loading">Loading…</div>}>
          {(() => {
            const blocked = scope?.blocked_modules || [];
            const match = moduleForPath(location.pathname);
            if (match && blocked.includes(match.module)) {
              return (
                <div className="max-w-2xl mx-auto py-16" data-testid="module-locked-page">
                  <div className="bg-white border border-amber-200 rounded-xl p-8 text-center shadow-sm">
                    <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                      <Lock className="text-amber-600" size={28} />
                    </div>
                    <h2 className="text-2xl font-black tracking-tight text-slate-900 mt-4">Not Authorised For This Service</h2>
                    <div className="text-slate-600 mt-3 leading-relaxed">
                      Aapki company ne <span className="font-bold text-slate-800">{match.module}</span> module abhi tak activate nahi kiya hai.
                      Please go through the <b>Subscription &amp; Billing</b> menu and complete the payment to access this service.
                    </div>
                    <div className="mt-6 flex items-center justify-center gap-3">
                      <button type="button" onClick={() => nav("/subscription")} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-md hover:bg-blue-700 transition-colors" data-testid="locked-goto-subscription">
                        <CreditCard size={14} /> Open Subscription &amp; Billing
                      </button>
                      <button type="button" onClick={() => nav("/")} className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-md hover:bg-slate-50 transition-colors" data-testid="locked-goto-home">
                        Back to Dashboard
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-6">Module code: <span className="font-mono">{match.module}</span></div>
                  </div>
                </div>
              );
            }
            return children;
          })()}
          </Suspense>
        </main>

        {/* Mobile bottom tab-bar */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--border)] flex items-stretch h-16 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(15,23,42,0.06)]" data-testid="mobile-bottom-nav" aria-label="Primary">
          {bottomTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink key={tab.to} to={tab.to} end={tab.end} data-testid={`mobile-tab-${tab.key}`} className={({ isActive }) => `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium relative transition-colors ${isActive ? "text-[var(--brand)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] bg-[var(--brand)] rounded-b" />}
                    <div className="relative">
                      <Icon size={20} strokeWidth={isActive ? 2 : 1.7} />
                      {tab.badge > 0 && (
                        <span className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-[16px] h-[16px] text-[9px] font-bold bg-[var(--danger)] text-white px-1" data-testid={`mobile-tab-badge-${tab.key}`}>{tab.badge > 9 ? "9+" : tab.badge}</span>
                      )}
                    </div>
                    <span className="leading-none">{tab.label || t(tab.key)}</span>
                  </>
                )}
              </NavLink>
            );
          })}
          <button type="button" onClick={() => setMobileOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors" data-testid="mobile-tab-menu" aria-label="Open menu">
            <MoreHorizontal size={20} strokeWidth={1.7} />
            <span className="leading-none">Menu</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

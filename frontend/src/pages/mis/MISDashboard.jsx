import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import {
  BarChart3, MapPin, Landmark, ClipboardList, Route as RouteIcon,
  FileBarChart2, AlertTriangle, TrendingUp, Users, GraduationCap,
  BadgeCheck, XCircle, PackageOpen,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import SIPStatusTab from "./SIPStatusTab";
import ProjectSummaryTab from "./ProjectSummaryTab";

/**
 * Jharkhand Skills — Daily Report / MIS Dashboard
 * ------------------------------------------------
 * Isolated new module — does not touch Finance / HR / Attendance flows.
 * Phase 1 delivers: SIP Status full CRUD + Excel bulk import/preview/export,
 * consolidated Overview KPIs, and placeholder tabs for the remaining sections
 * (Projects, JSDMS, Mobilization, Reports) that Phase 2+ will fill in.
 */

const KPI = ({ label, value, icon: Icon, tone = "brand", suffix = "" }) => {
  const toneCls = {
    brand: "text-[var(--brand)]",
    green: "text-emerald-700",
    red: "text-red-700",
    amber: "text-amber-700",
    muted: "text-[var(--muted)]",
  }[tone] || "text-[var(--brand)]";
  return (
    <div className="swiss-card p-4 border-l-4 border-[var(--brand)]/40 hover:border-[var(--brand)] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="overline text-[10px]">{label}</div>
        {Icon && <Icon size={14} className={toneCls} />}
      </div>
      <div className={`font-heading font-black text-2xl mt-1 ${toneCls}`}>
        {typeof value === "number" ? value.toLocaleString("en-IN") : (value || "—")}{suffix}
      </div>
    </div>
  );
};

export default function MISDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadOverview = () => {
    setLoading(true);
    api.get("/mis/overview")
      .then((r) => setOverview(r.data))
      .catch((e) => toast.error(formatError(e)))
      .finally(() => setLoading(false));
  };
  useEffect(loadOverview, []);

  const sip = overview?.sip || {};
  const p = overview?.projects || {};
  const m = overview?.mobilization || {};

  const canWrite = ["admin", "hr", "manager", "senior_manager", "accountant"].includes(user?.role);

  return (
    <div className="space-y-5" data-testid="mis-dashboard">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">MIS · Jharkhand Skills</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1 flex items-center gap-3">
            <BarChart3 size={28} className="text-[var(--brand)]" /> Daily Report / MIS Dashboard
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            Consolidated view for SIP centers, project batches, JSDMS targets, and daily mobilisation.
            {overview?.today && <> · <span className="font-mono">{overview.today}</span></>}
          </div>
        </div>
      </div>

      {/* Overview KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3" data-testid="mis-kpi-strip">
        <KPI label="Total Centers"      value={sip.total_centers}      icon={MapPin}       tone="brand" />
        <KPI label="Accredited"         value={sip.accredited}         icon={BadgeCheck}   tone="green" />
        <KPI label="BG Expiring (30d)"  value={sip.bg_expiring_30d}    icon={AlertTriangle} tone="amber" />
        <KPI label="BG Expired"         value={sip.bg_expired}         icon={XCircle}       tone="red" />
        <KPI label="Total Batches"      value={p.total_batches}        icon={PackageOpen}   tone="brand" />
        <KPI label="Active Batches"     value={p.active_batches}       icon={TrendingUp}    tone="green" />
        <KPI label="Total Enrolled"     value={p.total_enrolled}       icon={Users}         tone="brand" />
        <KPI label="Certified"          value={p.total_certified}      icon={GraduationCap} tone="green" />
        <KPI label="Placement"          value={p.total_placement}      icon={BadgeCheck}    tone="green" />
        <KPI label="Placement %"        value={p.placement_pct}        suffix="%" tone="green" />
        <KPI label="Today Mobilisation" value={m.today_total}          icon={ClipboardList} tone="brand" />
        <KPI label="Today Distance"     value={m.today_distance_km}    suffix=" km" icon={RouteIcon} tone="brand" />
      </div>

      {/* Tabbed modules */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="rounded-none grid grid-cols-3 md:grid-cols-6 gap-1 h-auto p-1 bg-gray-100">
          <TabsTrigger value="overview" data-testid="mis-tab-overview" className="rounded-none">Overview</TabsTrigger>
          <TabsTrigger value="sip"       data-testid="mis-tab-sip"       className="rounded-none">SIP Status</TabsTrigger>
          <TabsTrigger value="projects"  data-testid="mis-tab-projects"  className="rounded-none">Project Summary</TabsTrigger>
          <TabsTrigger value="jsdms"     data-testid="mis-tab-jsdms"     className="rounded-none">JSDMS</TabsTrigger>
          <TabsTrigger value="mob"       data-testid="mis-tab-mob"       className="rounded-none">Mobilization</TabsTrigger>
          <TabsTrigger value="reports"   data-testid="mis-tab-reports"   className="rounded-none">Reports</TabsTrigger>
        </TabsList>

        {/* -------- Overview -------- */}
        <TabsContent value="overview" className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="swiss-card p-4">
              <div className="overline">Certification vs Enrollment</div>
              <div className="mt-2 flex items-baseline gap-3">
                <div className="font-heading font-black text-3xl text-emerald-700">{p.certification_pct || 0}%</div>
                <div className="text-xs text-[var(--muted)]">{p.total_certified || 0} of {p.total_enrolled || 0}</div>
              </div>
              <div className="h-2 mt-3 bg-emerald-100">
                <div className="h-full bg-emerald-600" style={{ width: `${Math.min(p.certification_pct || 0, 100)}%` }} />
              </div>
            </div>
            <div className="swiss-card p-4">
              <div className="overline">Placement Percentage</div>
              <div className="mt-2 flex items-baseline gap-3">
                <div className="font-heading font-black text-3xl text-blue-700">{p.placement_pct || 0}%</div>
                <div className="text-xs text-[var(--muted)]">{p.total_placement || 0} placed</div>
              </div>
              <div className="h-2 mt-3 bg-blue-100">
                <div className="h-full bg-blue-600" style={{ width: `${Math.min(p.placement_pct || 0, 100)}%` }} />
              </div>
            </div>
            <div className="swiss-card p-4">
              <div className="overline">Dropout Rate</div>
              <div className="mt-2 flex items-baseline gap-3">
                <div className="font-heading font-black text-3xl text-red-700">{p.dropout_pct || 0}%</div>
                <div className="text-xs text-[var(--muted)]">{p.total_dropout || 0} dropped</div>
              </div>
              <div className="h-2 mt-3 bg-red-100">
                <div className="h-full bg-red-600" style={{ width: `${Math.min(p.dropout_pct || 0, 100)}%` }} />
              </div>
            </div>
          </div>
          <div className="swiss-card p-4">
            <div className="overline mb-2">Quick guide</div>
            <ul className="text-sm text-[var(--muted)] space-y-1 list-disc pl-4">
              <li><b>SIP Status</b> — 14-field center registry with Excel import/export & BG expiry alerts (Phase 1 ✅)</li>
              <li><b>Project Summary</b> — batch-level target/enrollment/placement tracking across Bharno, Satgawan, Kairo etc. (Phase 2)</li>
              <li><b>JSDMS</b> — 20-column JSDMS project tracker with FY-wise targets & trainer requirement gap (Phase 3)</li>
              <li><b>Mobilization</b> — daily field-team mobilization with multi-location, GPS, photo upload (Phase 4)</li>
              <li><b>Reports</b> — printable Daily Report, drill-down analytics, Excel/PDF exports (Phase 5)</li>
            </ul>
          </div>
        </TabsContent>

        {/* -------- SIP Status (full CRUD) -------- */}
        <TabsContent value="sip" className="pt-4">
          <SIPStatusTab canWrite={canWrite} onChange={loadOverview} />
        </TabsContent>

        {/* -------- Placeholders for later phases -------- */}
        <TabsContent value="projects" className="pt-4">
          <ProjectSummaryTab canWrite={canWrite} onChange={loadOverview} />
        </TabsContent>
        <TabsContent value="jsdms" className="pt-4">
          <ComingSoon
            title="JSDMS Project Summary"
            phase="Phase 3"
            hint="20-column JSDMS tracker: BG Status, FY-wise target achieved, TOT alignment, trainer gap."
            icon={Landmark}
          />
        </TabsContent>
        <TabsContent value="mob" className="pt-4">
          <ComingSoon
            title="Daily Mobilization Report"
            phase="Phase 4"
            hint="Field-team daily mobilization — multi-location, GPS, photo upload, auto totals."
            icon={RouteIcon}
          />
        </TabsContent>
        <TabsContent value="reports" className="pt-4">
          <ComingSoon
            title="Reports & Analytics"
            phase="Phase 5"
            hint="Printable Daily Report, drill-down analytics, District-wise performance, PDF/Excel export."
            icon={FileBarChart2}
          />
        </TabsContent>
      </Tabs>

      {loading && <div className="text-xs text-[var(--muted)]">Loading MIS overview…</div>}
    </div>
  );
}

function ComingSoon({ title, phase, hint, icon: Icon }) {
  return (
    <div className="swiss-card p-8 border-2 border-dashed border-[var(--muted)]/30 text-center" data-testid={`mis-placeholder-${title.replace(/\s+/g, "-").toLowerCase()}`}>
      <Icon size={40} className="mx-auto text-[var(--muted)]/60" />
      <div className="font-heading font-black text-xl mt-3">{title}</div>
      <div className="inline-block mt-2 px-2 py-0.5 text-[10px] font-bold uppercase bg-amber-100 text-amber-800">{phase}</div>
      <div className="text-sm text-[var(--muted)] mt-3 max-w-xl mx-auto">{hint}</div>
    </div>
  );
}

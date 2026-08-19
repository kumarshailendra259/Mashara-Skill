import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Target, Layers, Users, ClipboardList, GraduationCap, BadgeCheck,
  Plus, Trash2, Edit3, Search, Info, LockKeyhole,
} from "lucide-react";
import EnrollmentStage from "@/pages/bm/EnrollmentStage";
import AttendanceStage from "@/pages/bm/AttendanceStage";
import AssessmentStage from "@/pages/bm/AssessmentStage";
import PlacementStage from "@/pages/bm/PlacementStage";
import ClosureStage from "@/pages/bm/ClosureStage";

/**
 * Batch Management — centralised module for the full batch lifecycle
 * (Phase 37, Feb 2026). Phase 1 delivers:
 *   • Stage 1: Target Allocation (CRUD + progress bars)
 *   • Stage 2: Batch Creation — gated by target availability
 *   • Placeholders for Stages 3–7 with "Coming in next release" copy
 *
 * All other modules (Programs, MIS Manual Project Summary) now read-only for
 * batch creation. This is the single source of truth for new batches.
 */

const LIFECYCLE_STATES = [
  "Draft", "Upcoming", "Active", "Training Completed", "Assessment Pending",
  "Assessment Completed", "Certification Pending", "Certified",
  "Placement in Progress", "Closed",
];
const LC_TONE = {
  "Draft": "bg-gray-100 text-gray-700",
  "Upcoming": "bg-blue-100 text-blue-800",
  "Active": "bg-emerald-100 text-emerald-800",
  "Training Completed": "bg-teal-100 text-teal-800",
  "Assessment Pending": "bg-amber-100 text-amber-800",
  "Assessment Completed": "bg-indigo-100 text-indigo-800",
  "Certification Pending": "bg-purple-100 text-purple-800",
  "Certified": "bg-emerald-100 text-emerald-900",
  "Placement in Progress": "bg-orange-100 text-orange-800",
  "Closed": "bg-gray-200 text-gray-700",
};

const EMPTY_TARGET = {
  state: "", territory: "", company_id: "", center_id: "", project_id: "",
  target_year: "2025-26", fy: "", training_type: "STT",
  job_role_targets: [{ job_role: "", count: 0 }],
  total_target: 0, remarks: "",
};
const EMPTY_BATCH = {
  target_id: "", project_id: "", center_id: "", company_id: "",
  name: "", start_date: "", end_date: "", total_beneficiaries: 0,
  description: "", partner_ids: [], job_roles: [],
  lifecycle_status: "Draft",
  state: "", territory: "", target_year: "", training_type: "",
  total_target: 0,
};

const num = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("en-IN");

function ProgressBar({ pct, tone = "brand" }) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const cls = tone === "brand" ? "bg-[var(--brand)]" : tone === "green" ? "bg-emerald-600" : "bg-amber-500";
  return (
    <div className="h-1.5 bg-gray-100 w-full">
      <div className={`h-full ${cls} transition-all`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export default function BatchManagement() {
  const { user } = useAuth();
  const canManageTargets = ["admin", "manager", "senior_manager"].includes(user?.role);
  const canManageBatches = ["admin", "manager", "senior_manager", "center_manager"].includes(user?.role);

  const [tab, setTab] = useState("targets");

  // ---- Reference data (loaded once) ----
  const [entProjects, setEntProjects] = useState([]);
  const [entCenters, setEntCenters] = useState([]);
  const [entCompanies, setEntCompanies] = useState([]);
  useEffect(() => {
    Promise.all([
      api.get("/entities/project").then((r) => r.data).catch(() => []),
      api.get("/entities/center").then((r) => r.data).catch(() => []),
      api.get("/entities/company").then((r) => r.data).catch(() => []),
    ]).then(([p, c, co]) => {
      setEntProjects((p || []).filter((x) => x.name));
      setEntCenters((c || []).filter((x) => x.name));
      setEntCompanies((co || []).filter((x) => x.name));
    });
  }, []);

  // ---- Targets ----
  const [targets, setTargets] = useState([]);
  const [tLoading, setTLoading] = useState(false);
  const [tSearch, setTSearch] = useState("");
  const [tProjF, setTProjF] = useState("all");
  const [tYearF, setTYearF] = useState("all");
  const [tOpen, setTOpen] = useState(false);
  const [tEdit, setTEdit] = useState(null);
  const [tSaving, setTSaving] = useState(false);

  const loadTargets = useCallback(async () => {
    setTLoading(true);
    try {
      const params = {};
      if (tProjF !== "all") params.project_id = tProjF;
      if (tYearF !== "all") params.target_year = tYearF;
      const r = await api.get("/batch-targets", { params });
      setTargets(r.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setTLoading(false); }
  }, [tProjF, tYearF]);
  useEffect(() => { loadTargets(); }, [loadTargets]);

  const filteredTargets = useMemo(() => {
    const s = tSearch.trim().toLowerCase();
    if (!s) return targets;
    return targets.filter((t) =>
      [t.project_name, t.center_name, t.company_name, t.state, t.territory, t.target_year]
        .some((v) => (v || "").toLowerCase().includes(s))
    );
  }, [targets, tSearch]);

  const targetYears = useMemo(() => Array.from(new Set(targets.map((t) => t.target_year).filter(Boolean))).sort(), [targets]);

  const openNewTarget = () => { setTEdit({ ...EMPTY_TARGET }); setTOpen(true); };
  const openEditTarget = (t) => {
    setTEdit({
      ...EMPTY_TARGET, ...t,
      job_role_targets: t.job_role_targets?.length ? t.job_role_targets : [{ job_role: "", count: 0 }],
    });
    setTOpen(true);
  };

  const updateJrt = (idx, patch) => {
    const jrt = [...(tEdit.job_role_targets || [])];
    jrt[idx] = { ...jrt[idx], ...patch };
    const total = jrt.reduce((s, j) => s + (Number(j.count) || 0), 0);
    setTEdit({ ...tEdit, job_role_targets: jrt, total_target: total });
  };
  const addJrtRow = () => setTEdit({ ...tEdit, job_role_targets: [...(tEdit.job_role_targets || []), { job_role: "", count: 0 }] });
  const removeJrtRow = (idx) => {
    const jrt = (tEdit.job_role_targets || []).filter((_, i) => i !== idx);
    const total = jrt.reduce((s, j) => s + (Number(j.count) || 0), 0);
    setTEdit({ ...tEdit, job_role_targets: jrt.length ? jrt : [{ job_role: "", count: 0 }], total_target: total });
  };

  const saveTarget = async () => {
    if (!tEdit.project_id) return toast.error("Project is required");
    if (!tEdit.target_year) return toast.error("Target Year is required");
    if (!tEdit.total_target || tEdit.total_target <= 0) return toast.error("Add at least one job role with count > 0");
    setTSaving(true);
    try {
      const payload = {
        ...tEdit,
        job_role_targets: (tEdit.job_role_targets || []).filter((j) => j.job_role && Number(j.count) > 0),
      };
      payload.total_target = payload.job_role_targets.reduce((s, j) => s + Number(j.count), 0);
      if (tEdit.id) await api.patch(`/batch-targets/${tEdit.id}`, payload);
      else          await api.post("/batch-targets", payload);
      toast.success(tEdit.id ? "Target updated" : "Target allocated");
      setTOpen(false); setTEdit(null); loadTargets();
    } catch (e) { toast.error(formatError(e)); }
    finally { setTSaving(false); }
  };
  const removeTarget = async (t) => {
    if (!window.confirm(`Delete target for "${t.project_name || t.project_id}" (${t.target_year})? Only allowed when no batches are attached.`)) return;
    try { await api.delete(`/batch-targets/${t.id}`); toast.success("Target deleted"); loadTargets(); }
    catch (e) { toast.error(formatError(e)); }
  };

  // ---- Batches (Stage 2 — target-gated creation) ----
  const [batches, setBatches] = useState([]);
  const [bLoading, setBLoading] = useState(false);
  const [bSearch, setBSearch] = useState("");
  const [bStatusF, setBStatusF] = useState("all");
  const [bOpen, setBOpen] = useState(false);
  const [bEdit, setBEdit] = useState(null);
  const [bSaving, setBSaving] = useState(false);
  const [selectedTargetForBatch, setSelectedTargetForBatch] = useState(null);

  const loadBatches = useCallback(async () => {
    setBLoading(true);
    try {
      const r = await api.get("/batches");
      setBatches(r.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setBLoading(false); }
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const filteredBatches = useMemo(() => {
    let list = batches;
    if (bStatusF !== "all") list = list.filter((b) => (b.lifecycle_status || (b.closed ? "Closed" : "Draft")) === bStatusF);
    const s = bSearch.trim().toLowerCase();
    if (s) list = list.filter((b) => [b.name, b.batch_id, b.sdms_batch_id].some((v) => (v || "").toLowerCase().includes(s)));
    return list;
  }, [batches, bStatusF, bSearch]);

  const availableTargets = useMemo(() => targets.filter((t) => (t.remaining || 0) > 0), [targets]);

  const openNewBatch = (prefillTarget = null) => {
    if (prefillTarget) {
      setBEdit({
        ...EMPTY_BATCH,
        target_id: prefillTarget.id,
        project_id: prefillTarget.project_id || "",
        center_id: prefillTarget.center_id || "",
        company_id: prefillTarget.company_id || "",
        state: prefillTarget.state || "",
        territory: prefillTarget.territory || "",
        target_year: prefillTarget.target_year || "",
        training_type: prefillTarget.training_type || "",
      });
      setSelectedTargetForBatch(prefillTarget);
    } else {
      setBEdit({ ...EMPTY_BATCH });
      setSelectedTargetForBatch(null);
    }
    setBOpen(true);
  };
  const onSelectTargetForBatch = (targetId) => {
    const t = targets.find((x) => x.id === targetId);
    if (!t) return;
    setBEdit({
      ...bEdit,
      target_id: t.id,
      project_id: t.project_id || bEdit.project_id,
      center_id: t.center_id || bEdit.center_id,
      company_id: t.company_id || bEdit.company_id,
      state: t.state || bEdit.state,
      territory: t.territory || bEdit.territory,
      target_year: t.target_year || bEdit.target_year,
      training_type: t.training_type || bEdit.training_type,
    });
    setSelectedTargetForBatch(t);
  };
  const saveBatch = async () => {
    if (!bEdit.target_id) return toast.error("Select a Target first (Stage 1) — batches must be created against an allocated target");
    if (!bEdit.project_id) return toast.error("Project is required");
    if (!bEdit.name?.trim()) return toast.error("Batch ID / Name is required");
    if (!bEdit.total_beneficiaries || Number(bEdit.total_beneficiaries) <= 0) return toast.error("Batch capacity must be > 0");
    if (selectedTargetForBatch && Number(bEdit.total_beneficiaries) > (selectedTargetForBatch.remaining || 0)) {
      return toast.error(`Batch capacity exceeds target remaining (${selectedTargetForBatch.remaining})`);
    }
    setBSaving(true);
    try {
      await api.post("/batches", bEdit);
      toast.success("Batch created & target consumed");
      setBOpen(false); setBEdit(null); setSelectedTargetForBatch(null);
      loadBatches(); loadTargets();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBSaving(false); }
  };

  // ---- Aggregate metrics for header ----
  const kpi = useMemo(() => {
    const total = targets.reduce((s, t) => s + (t.total_target || 0), 0);
    const allocated = targets.reduce((s, t) => s + (t.allocated || 0), 0);
    const remaining = targets.reduce((s, t) => s + (t.remaining || 0), 0);
    const activeBatches = batches.filter((b) => !b.closed).length;
    return {
      targets_count: targets.length,
      total_target: total, allocated, remaining,
      utilization_pct: total ? Math.round((allocated / total) * 100) : 0,
      total_batches: batches.length, active_batches: activeBatches,
      legacy_batches: batches.filter((b) => !b.target_id).length,
    };
  }, [targets, batches]);

  return (
    <div className="space-y-5" data-testid="batch-management-page">
      {/* Header */}
      <div>
        <div className="overline">Batch Management · Centralised</div>
        <h1 className="font-heading font-black tracking-tight text-3xl mt-1 flex items-center gap-3">
          <Layers size={28} className="text-[var(--brand)]" /> Batch Management
        </h1>
        <div className="text-sm text-[var(--muted)] mt-1 max-w-3xl">
          Single source of truth for the entire batch lifecycle — Target Allocation → Batch Creation →
          Candidate Enrollment → Attendance → Assessment → Placement → Closure. All other modules read
          from here; create every new batch from this page.
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {[
          { l: "Targets", v: kpi.targets_count, icon: Target, tone: "brand" },
          { l: "Total Target", v: kpi.total_target, icon: Target, tone: "brand" },
          { l: "Allocated", v: kpi.allocated, icon: BadgeCheck, tone: "green" },
          { l: "Remaining", v: kpi.remaining, icon: ClipboardList, tone: "amber" },
          { l: "Utilization %", v: `${kpi.utilization_pct}%`, tone: "green" },
          { l: "Total Batches", v: kpi.total_batches, icon: Layers, tone: "brand" },
          { l: "Active Batches", v: kpi.active_batches, icon: Users, tone: "green" },
        ].map((k, i) => (
          <div key={i} className="swiss-card p-3 border-l-4 border-[var(--brand)]/40">
            <div className="overline text-[10px] flex items-center gap-1">
              {k.icon && <k.icon size={11} />} {k.l}
            </div>
            <div className={`font-heading font-black text-2xl mt-1 ${k.tone === "green" ? "text-emerald-700" : k.tone === "amber" ? "text-amber-700" : "text-[var(--brand)]"}`}>
              {typeof k.v === "number" ? k.v.toLocaleString("en-IN") : k.v}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="rounded-none grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-1 h-auto p-1 bg-gray-100">
          <TabsTrigger value="targets" className="rounded-none" data-testid="bm-tab-targets">1 · Target Allocation</TabsTrigger>
          <TabsTrigger value="batches" className="rounded-none" data-testid="bm-tab-batches">2 · Batch Creation</TabsTrigger>
          <TabsTrigger value="enroll" className="rounded-none" data-testid="bm-tab-enroll">3 · Enrollment</TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-none" data-testid="bm-tab-attendance">4 · Attendance</TabsTrigger>
          <TabsTrigger value="assessment" className="rounded-none" data-testid="bm-tab-assessment">5 · Assessment</TabsTrigger>
          <TabsTrigger value="placement" className="rounded-none" data-testid="bm-tab-placement">6 · Placement</TabsTrigger>
          <TabsTrigger value="closure" className="rounded-none" data-testid="bm-tab-closure">7 · Closure</TabsTrigger>
        </TabsList>

        {/* ================== STAGE 1: TARGETS ================== */}
        <TabsContent value="targets" className="pt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <Label className="overline">Search</Label>
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <Input value={tSearch} onChange={(e) => setTSearch(e.target.value)} placeholder="Project / Center / Company / State" className="rounded-none pl-7" data-testid="bm-tgt-search" />
              </div>
            </div>
            <div className="w-52">
              <Label className="overline">Project</Label>
              <Select value={tProjF} onValueChange={setTProjF}>
                <SelectTrigger className="rounded-none" data-testid="bm-tgt-filter-project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {entProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label className="overline">Target Year</Label>
              <Select value={tYearF} onValueChange={setTYearF}>
                <SelectTrigger className="rounded-none" data-testid="bm-tgt-filter-year"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {targetYears.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 ml-auto">
              {canManageTargets && (
                <Button onClick={openNewTarget} className="brand-btn rounded-none gap-1" data-testid="bm-tgt-add-btn">
                  <Plus size={13} /> Allocate Target
                </Button>
              )}
            </div>
          </div>

          <div className="swiss-card overflow-x-auto">
            <table className="text-xs min-w-max w-full">
              <thead className="bg-gray-50 border-b border-[var(--border)]">
                <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px] [&>th]:whitespace-nowrap">
                  <th>Project</th><th>Year</th><th>Center</th><th>State / Territory</th>
                  <th>Training</th>
                  <th className="text-right">Total</th><th className="text-right">Allocated</th>
                  <th className="text-right">Remaining</th><th className="w-40">Utilization</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tLoading && <tr><td colSpan={10} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
                {!tLoading && filteredTargets.length === 0 && (
                  <tr><td colSpan={10} className="p-8 text-center text-[var(--muted)]">
                    No targets allocated yet. Click <b>Allocate Target</b> to start Stage 1.
                  </td></tr>
                )}
                {filteredTargets.map((t) => {
                  const util = t.total_target ? Math.round((t.allocated || 0) / t.total_target * 100) : 0;
                  return (
                    <tr key={t.id} className="border-t border-[var(--border)] hover:bg-gray-50 [&>td]:p-2" data-testid={`bm-tgt-row-${t.id}`}>
                      <td className="font-semibold">{t.project_name || t.project_id?.slice(0, 8)}</td>
                      <td className="font-mono">{t.target_year}</td>
                      <td>{t.center_name || <span className="text-[var(--muted)] italic">All centers</span>}</td>
                      <td>{[t.state, t.territory].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="text-[10px] font-bold uppercase">{t.training_type || "—"}</td>
                      <td className="text-right font-bold">{num(t.total_target)}</td>
                      <td className="text-right text-emerald-700">{num(t.allocated)}</td>
                      <td className="text-right text-amber-700 font-bold">{num(t.remaining)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <ProgressBar pct={util} tone={util >= 100 ? "green" : "brand"} />
                          <span className="text-[10px] font-bold w-8 text-right">{util}%</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {(t.remaining || 0) > 0 && canManageBatches && (
                          <Button size="sm" onClick={() => openNewBatch(t)} className="brand-btn rounded-none h-7 text-[10px] gap-1" data-testid={`bm-tgt-create-batch-${t.id}`}>
                            <Plus size={11} /> Batch
                          </Button>
                        )}
                        {canManageTargets && <Button size="icon" variant="ghost" onClick={() => openEditTarget(t)} className="h-7 w-7 rounded-none" title="Edit" data-testid={`bm-tgt-edit-${t.id}`}><Edit3 size={12} /></Button>}
                        {user?.role === "admin" && <Button size="icon" variant="ghost" onClick={() => removeTarget(t)} className="h-7 w-7 rounded-none hover:text-red-700" title="Delete" data-testid={`bm-tgt-del-${t.id}`}><Trash2 size={12} /></Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ================== STAGE 2: BATCHES ================== */}
        <TabsContent value="batches" className="pt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <Label className="overline">Search</Label>
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <Input value={bSearch} onChange={(e) => setBSearch(e.target.value)} placeholder="Batch ID / SDMS ID" className="rounded-none pl-7" data-testid="bm-batch-search" />
              </div>
            </div>
            <div className="w-56">
              <Label className="overline">Status</Label>
              <Select value={bStatusF} onValueChange={setBStatusF}>
                <SelectTrigger className="rounded-none" data-testid="bm-batch-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {LIFECYCLE_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 ml-auto">
              {canManageBatches && (
                <Button
                  onClick={() => openNewBatch()}
                  disabled={availableTargets.length === 0}
                  title={availableTargets.length === 0 ? "Allocate a target in Stage 1 first" : ""}
                  className="brand-btn rounded-none gap-1"
                  data-testid="bm-batch-add-btn"
                >
                  <Plus size={13} /> Create Batch
                </Button>
              )}
              {!canManageBatches && (
                <span className="text-[11px] text-[var(--muted)] italic" title="Your role can view batches but not create them.">Read-only role</span>
              )}
            </div>
          </div>

          {availableTargets.length === 0 && (
            <div className="border-l-4 border-amber-500 bg-amber-50/60 p-3 text-xs flex items-center gap-2" data-testid="bm-no-target-warning">
              <Info size={14} className="text-amber-700" />
              <span><b>No available targets.</b> Allocate a target in Stage 1 before creating batches.</span>
            </div>
          )}

          <div className="swiss-card overflow-x-auto">
            <table className="text-xs min-w-max w-full">
              <thead className="bg-gray-50 border-b border-[var(--border)]">
                <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px] [&>th]:whitespace-nowrap">
                  <th>Batch</th><th>Project</th><th>Center</th>
                  <th className="text-right">Capacity</th><th className="text-right">Enrolled</th>
                  <th>Start</th><th>End</th><th>Status</th><th>Target</th>
                </tr>
              </thead>
              <tbody>
                {bLoading && <tr><td colSpan={9} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
                {!bLoading && filteredBatches.length === 0 && (
                  <tr><td colSpan={9} className="p-8 text-center text-[var(--muted)]">No batches match your filters.</td></tr>
                )}
                {filteredBatches.map((b) => {
                  const proj = entProjects.find((p) => p.id === b.project_id);
                  const cen  = entCenters.find((c) => c.id === b.center_id);
                  const lc = b.lifecycle_status || (b.closed ? "Closed" : "Draft");
                  return (
                    <tr key={b.id} className="border-t border-[var(--border)] hover:bg-gray-50 [&>td]:p-2 [&>td]:whitespace-nowrap" data-testid={`bm-batch-row-${b.id}`}>
                      <td className="font-mono font-semibold">{b.name}</td>
                      <td>{proj?.name || b.project_id?.slice(0, 8)}</td>
                      <td>{cen?.name || "—"}</td>
                      <td className="text-right">{num(b.total_beneficiaries)}</td>
                      <td className="text-right">{num(b.passed_candidates || 0)}</td>
                      <td>{b.start_date || "—"}</td>
                      <td>{b.end_date || "—"}</td>
                      <td>
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border ${LC_TONE[lc] || "bg-gray-100"}`}>{lc}</span>
                      </td>
                      <td>
                        {b.target_id ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700"><BadgeCheck size={10} /> Linked</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 border border-gray-300 text-[9px] font-bold uppercase text-gray-600" title="Created before Batch Management module; no target link required.">
                            <LockKeyhole size={9} /> Legacy
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ================== STAGE 3: ENROLLMENT ================== */}
        <TabsContent value="enroll" className="pt-4">
          <EnrollmentStage batches={batches} canWrite={canManageBatches} />
        </TabsContent>

        {/* ================== STAGE 4: ATTENDANCE ================== */}
        <TabsContent value="attendance" className="pt-4">
          <AttendanceStage batches={batches} canWrite={canManageBatches} />
        </TabsContent>

        {/* ================== STAGE 5: ASSESSMENT ================== */}
        <TabsContent value="assessment" className="pt-4">
          <AssessmentStage batches={batches} canWrite={canManageBatches} />
        </TabsContent>

        {/* ================== STAGE 6: PLACEMENT ================== */}
        <TabsContent value="placement" className="pt-4">
          <PlacementStage batches={batches} canWrite={canManageBatches} />
        </TabsContent>

        {/* ================== STAGE 7: CLOSURE + EXTENSIONS ================== */}
        <TabsContent value="closure" className="pt-4">
          <ClosureStage batches={batches} refreshBatches={loadBatches} />
        </TabsContent>
      </Tabs>

      {/* ==================== Target Allocation Dialog ==================== */}
      <Dialog open={tOpen} onOpenChange={(o) => !o && (setTOpen(false), setTEdit(null))}>
        <DialogContent className="rounded-none max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="bm-tgt-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">{tEdit?.id ? "Edit Target Allocation" : "Allocate New Target"}</DialogTitle>
            <DialogDescription className="text-xs">Define training targets for a project + year. Batches will consume seats from the Remaining pool.</DialogDescription>
          </DialogHeader>
          {tEdit && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="overline text-[10px]">Project *</Label>
                  <Select value={tEdit.project_id || undefined} onValueChange={(v) => setTEdit({ ...tEdit, project_id: v })}>
                    <SelectTrigger className="rounded-none" data-testid="bm-tgt-inp-project"><SelectValue placeholder="Select project" /></SelectTrigger>
                    <SelectContent>
                      {entProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline text-[10px]">Center (optional — leave empty for pooled target)</Label>
                  <Select value={tEdit.center_id || undefined} onValueChange={(v) => setTEdit({ ...tEdit, center_id: v })}>
                    <SelectTrigger className="rounded-none" data-testid="bm-tgt-inp-center"><SelectValue placeholder="All centers" /></SelectTrigger>
                    <SelectContent>
                      {entCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline text-[10px]">Company (optional)</Label>
                  <Select value={tEdit.company_id || undefined} onValueChange={(v) => setTEdit({ ...tEdit, company_id: v })}>
                    <SelectTrigger className="rounded-none" data-testid="bm-tgt-inp-company"><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      {entCompanies.map((co) => <SelectItem key={co.id} value={co.id}>{co.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline text-[10px]">Target Year *</Label>
                  <Input value={tEdit.target_year || ""} onChange={(e) => setTEdit({ ...tEdit, target_year: e.target.value })} placeholder="2025-26" className="rounded-none" data-testid="bm-tgt-inp-year" />
                </div>
                <div>
                  <Label className="overline text-[10px]">Financial Year</Label>
                  <Input value={tEdit.fy || ""} onChange={(e) => setTEdit({ ...tEdit, fy: e.target.value })} placeholder="FY 2025-26" className="rounded-none" data-testid="bm-tgt-inp-fy" />
                </div>
                <div>
                  <Label className="overline text-[10px]">Training Type</Label>
                  <Select value={tEdit.training_type || undefined} onValueChange={(v) => setTEdit({ ...tEdit, training_type: v })}>
                    <SelectTrigger className="rounded-none" data-testid="bm-tgt-inp-training"><SelectValue placeholder="STT / RPL" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STT">STT</SelectItem>
                      <SelectItem value="RPL">RPL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline text-[10px]">State</Label>
                  <Input value={tEdit.state || ""} onChange={(e) => setTEdit({ ...tEdit, state: e.target.value })} className="rounded-none" data-testid="bm-tgt-inp-state" />
                </div>
                <div>
                  <Label className="overline text-[10px]">Territory / District</Label>
                  <Input value={tEdit.territory || ""} onChange={(e) => setTEdit({ ...tEdit, territory: e.target.value })} className="rounded-none" data-testid="bm-tgt-inp-territory" />
                </div>
              </div>

              {/* Job Role targets */}
              <div>
                <div className="overline mb-2 border-b border-[var(--border)] pb-1 flex items-center justify-between">
                  <span>Job Role wise Target</span>
                  <Button size="sm" variant="outline" onClick={addJrtRow} className="h-6 rounded-none text-[10px]" data-testid="bm-tgt-add-jrt"><Plus size={11} /> Add role</Button>
                </div>
                <div className="space-y-2">
                  {(tEdit.job_role_targets || []).map((j, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-7">
                        <Label className="overline text-[9px]">Job Role</Label>
                        <Input value={j.job_role || ""} onChange={(e) => updateJrt(idx, { job_role: e.target.value })} placeholder="Electrician / Plumber / …" className="rounded-none" data-testid={`bm-tgt-jrt-role-${idx}`} />
                      </div>
                      <div className="col-span-3">
                        <Label className="overline text-[9px]">Count</Label>
                        <Input type="number" min={0} value={j.count ?? ""} onChange={(e) => updateJrt(idx, { count: Number(e.target.value) || 0 })} className="rounded-none" data-testid={`bm-tgt-jrt-count-${idx}`} />
                      </div>
                      <div className="col-span-2">
                        <Button size="icon" variant="ghost" onClick={() => removeJrtRow(idx)} className="h-9 w-9 rounded-none hover:text-red-700" data-testid={`bm-tgt-jrt-del-${idx}`}><Trash2 size={12} /></Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-right">
                  <span className="overline text-[10px] mr-2">Total (auto)</span>
                  <span className="font-heading font-black text-2xl text-[var(--brand)]" data-testid="bm-tgt-total">{num(tEdit.total_target)}</span>
                </div>
              </div>
              <div>
                <Label className="overline text-[10px]">Remarks</Label>
                <Input value={tEdit.remarks || ""} onChange={(e) => setTEdit({ ...tEdit, remarks: e.target.value })} className="rounded-none" data-testid="bm-tgt-inp-remarks" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTOpen(false); setTEdit(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={saveTarget} disabled={tSaving} className="brand-btn rounded-none" data-testid="bm-tgt-save">{tSaving ? "Saving…" : (tEdit?.id ? "Update Target" : "Allocate Target")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Batch Creation Dialog ==================== */}
      <Dialog open={bOpen} onOpenChange={(o) => !o && (setBOpen(false), setBEdit(null), setSelectedTargetForBatch(null))}>
        <DialogContent className="rounded-none max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="bm-batch-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Create New Batch</DialogTitle>
            <DialogDescription className="text-xs">Batches consume seats from an allocated target. Capacity cannot exceed the target&apos;s remaining seats.</DialogDescription>
          </DialogHeader>
          {bEdit && (
            <div className="space-y-4">
              {/* Target picker */}
              <div className="border-l-4 border-emerald-500 bg-emerald-50/40 p-3">
                <Label className="overline text-[10px]">Target (Stage 1) *</Label>
                <Select value={bEdit.target_id || undefined} onValueChange={onSelectTargetForBatch} disabled={!!selectedTargetForBatch?.locked}>
                  <SelectTrigger className="rounded-none" data-testid="bm-batch-inp-target"><SelectValue placeholder="Select an allocated target with remaining seats" /></SelectTrigger>
                  <SelectContent>
                    {availableTargets.length === 0 && <SelectItem value="__none__" disabled>No available targets — allocate one first in Stage 1</SelectItem>}
                    {availableTargets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.project_name} · {t.target_year} · {t.center_name || "any center"} — {t.remaining} seats left
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTargetForBatch && (
                  <div className="mt-2 text-[11px] text-emerald-800">
                    Total {selectedTargetForBatch.total_target} · Allocated {selectedTargetForBatch.allocated} · <b>Remaining {selectedTargetForBatch.remaining}</b>
                    {" — "}Batch capacity will be deducted from remaining on save.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="overline text-[10px]">Batch ID / Name *</Label>
                  <Input value={bEdit.name || ""} onChange={(e) => setBEdit({ ...bEdit, name: e.target.value })} placeholder="e.g. Ramgarh-BOCWW-JR12" className="rounded-none" data-testid="bm-batch-inp-name" />
                </div>
                <div>
                  <Label className="overline text-[10px]">Batch Capacity *</Label>
                  <Input type="number" min={1} max={selectedTargetForBatch?.remaining || undefined} value={bEdit.total_beneficiaries ?? ""} onChange={(e) => setBEdit({ ...bEdit, total_beneficiaries: Number(e.target.value) || 0 })} className="rounded-none" data-testid="bm-batch-inp-capacity" />
                  {selectedTargetForBatch && bEdit.total_beneficiaries > selectedTargetForBatch.remaining && (
                    <div className="text-[10px] text-red-700 mt-1">Exceeds target remaining ({selectedTargetForBatch.remaining})</div>
                  )}
                </div>
                <div>
                  <Label className="overline text-[10px]">Project *</Label>
                  <Select value={bEdit.project_id || undefined} onValueChange={(v) => setBEdit({ ...bEdit, project_id: v })} disabled={!!selectedTargetForBatch?.project_id}>
                    <SelectTrigger className="rounded-none" data-testid="bm-batch-inp-project"><SelectValue placeholder="Project" /></SelectTrigger>
                    <SelectContent>
                      {entProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline text-[10px]">Center</Label>
                  <Select value={bEdit.center_id || undefined} onValueChange={(v) => setBEdit({ ...bEdit, center_id: v })} disabled={!!selectedTargetForBatch?.center_id}>
                    <SelectTrigger className="rounded-none" data-testid="bm-batch-inp-center"><SelectValue placeholder="Center" /></SelectTrigger>
                    <SelectContent>
                      {entCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline text-[10px]">Company</Label>
                  <Select value={bEdit.company_id || undefined} onValueChange={(v) => setBEdit({ ...bEdit, company_id: v })}>
                    <SelectTrigger className="rounded-none" data-testid="bm-batch-inp-company"><SelectValue placeholder="Company" /></SelectTrigger>
                    <SelectContent>
                      {entCompanies.map((co) => <SelectItem key={co.id} value={co.id}>{co.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline text-[10px]">Start Date</Label>
                  <Input type="date" value={bEdit.start_date || ""} onChange={(e) => setBEdit({ ...bEdit, start_date: e.target.value })} className="rounded-none" data-testid="bm-batch-inp-start" />
                </div>
                <div>
                  <Label className="overline text-[10px]">End Date</Label>
                  <Input type="date" value={bEdit.end_date || ""} onChange={(e) => setBEdit({ ...bEdit, end_date: e.target.value })} className="rounded-none" data-testid="bm-batch-inp-end" />
                </div>
                <div>
                  <Label className="overline text-[10px]">Batch Status</Label>
                  <Select value={bEdit.lifecycle_status || "Draft"} onValueChange={(v) => setBEdit({ ...bEdit, lifecycle_status: v })}>
                    <SelectTrigger className="rounded-none" data-testid="bm-batch-inp-lifecycle"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LIFECYCLE_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline text-[10px]">Training Type</Label>
                  <Input value={bEdit.training_type || ""} className="rounded-none bg-gray-50" readOnly data-testid="bm-batch-inp-training" />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBOpen(false); setBEdit(null); setSelectedTargetForBatch(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={saveBatch} disabled={bSaving} className="brand-btn rounded-none" data-testid="bm-batch-save">{bSaving ? "Creating…" : "Create Batch"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

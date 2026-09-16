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
  Plus, Trash2, Edit3, Search, Info, LockKeyhole, Upload, Download,
  CheckCircle2, AlertTriangle, Eye, FileText, Link2, Wrench,
} from "lucide-react";
import { inr } from "@/lib/i18n";
import WorkOrderFinancials from "@/components/batch/WorkOrderFinancials";
import BatchDashboard from "@/components/batch/BatchDashboard";
import WorkOrderFormModal from "@/components/batch/WorkOrderFormModal";
import WorkOrderViewModal from "@/components/batch/WorkOrderViewModal";
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
  // Phase 38 · Work Order Allocation
  fy_year: "", category: "", job_role_master_id: "",
  job_role_hours: 0, num_candidates: 0,
  work_order_id: "",
};

// FY dropdown options — accepts any year. UI shows common ones + a "Custom" free-text.
const FY_OPTIONS = ["2024-25", "2025-26", "2026-27", "2027-28", "2028-29"];

// Bottom lifecycle stepper stages (maps to the Tabs `tab` state values).
const STEPPER = [
  { v: "targets", label: "Target Allocation" },
  { v: "batches", label: "Batch Creation" },
  { v: "enroll", label: "Enrollment" },
  { v: "attendance", label: "Attendance" },
  { v: "assessment", label: "Assessment" },
  { v: "placement", label: "Placement" },
  { v: "closure", label: "Closure" },
];

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

  // ---- Phase 81 · Work Orders (source of truth for Work Order Value / PBG) ----
  const canManageWO = ["admin", "manager", "senior_manager"].includes(user?.role);
  const [woFin, setWoFin] = useState({ cards: {}, summary_rows: [], grand_total: {} });
  const [woFinLoading, setWoFinLoading] = useState(false);
  const [woFilters, setWoFilters] = useState({ q: "", project_id: "all", center_id: "all", fy: "all", status: "all" });
  const setWoFilter = (k, v) => setWoFilters((s) => ({ ...s, [k]: v }));
  const clearWoFilters = () => setWoFilters({ q: "", project_id: "all", center_id: "all", fy: "all", status: "all" });

  const loadFinancials = useCallback(async () => {
    setWoFinLoading(true);
    try {
      const params = {};
      if (woFilters.q.trim()) params.q = woFilters.q.trim();
      if (woFilters.project_id !== "all") params.project_id = woFilters.project_id;
      if (woFilters.center_id !== "all") params.center_id = woFilters.center_id;
      if (woFilters.fy !== "all") params.fy = woFilters.fy;
      if (woFilters.status !== "all") params.status = woFilters.status;
      const r = await api.get("/batch-management/financials", { params });
      setWoFin(r.data || { cards: {}, summary_rows: [], grand_total: {} });
    } catch (e) { toast.error(formatError(e)); }
    finally { setWoFinLoading(false); }
  }, [woFilters]);
  useEffect(() => { loadFinancials(); }, [loadFinancials]);

  // WO modals
  const [woFormOpen, setWoFormOpen] = useState(false);
  const [woFormInitial, setWoFormInitial] = useState(null);
  const [woFormPrefill, setWoFormPrefill] = useState(null);
  const [woView, setWoView] = useState({ open: false, list: [], loading: false });

  const openAddWO = (prefill = null) => { setWoFormInitial(null); setWoFormPrefill(prefill); setWoFormOpen(true); };
  const openEditWO = (wo) => { setWoView({ open: false, list: [], loading: false }); setWoFormInitial(wo); setWoFormPrefill(null); setWoFormOpen(true); };
  const onWOSaved = () => { loadFinancials(); loadTargets(); loadWOList(); };

  // Full WO list (for the batch → work order dropdown + display map)
  const [woList, setWoList] = useState([]);
  const loadWOList = useCallback(async () => {
    try { const r = await api.get("/work-orders", { params: { include_inactive: true } }); setWoList(r.data || []); }
    catch { /* non-blocking */ }
  }, []);
  useEffect(() => { loadWOList(); }, [loadWOList]);


  const fetchWOList = async (params) => {
    setWoView({ open: true, list: [], loading: true });
    try {
      const r = await api.get("/work-orders", { params });
      setWoView({ open: true, list: r.data || [], loading: false });
    } catch (e) { toast.error(formatError(e)); setWoView({ open: true, list: [], loading: false }); }
  };
  const openViewForTarget = (t) => fetchWOList({ project_id: t.project_id, center_id: t.center_id, fy: (t.fy || t.target_year || "").trim() });
  const openViewForRow = (r) => fetchWOList({ project_id: r.project_id, center_id: r.center_id, fy: r.fy });
  // Dashboard drawer — returns the WO list for a summary row (no modal side-effects).
  const fetchWOsFor = async (row) => {
    const r = await api.get("/work-orders", { params: { project_id: row.project_id, center_id: row.center_id, fy: row.fy, include_inactive: true } });
    return r.data || [];
  };
  const deleteWO = async (wo) => {
    if (!window.confirm(`Delete Work Order ${wo.wo_number}? This cannot be undone.`)) return;
    try {
      await api.delete(`/work-orders/${wo.id}`);
      toast.success("Work Order deleted");
      setWoView({ open: false, list: [], loading: false });
      loadFinancials(); loadTargets();
    } catch (e) { toast.error(formatError(e)); }
  };

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

  // Auto-select the Work Order when exactly ONE active WO matches the batch's
  // project + centre (+ FY if set) and the user hasn't already picked one.
  useEffect(() => {
    if (!bOpen || !bEdit || bEdit.work_order_id || !bEdit.project_id || !bEdit.center_id) return;
    const matches = woList.filter((w) =>
      w.effective_status === "active" &&
      w.project_id === bEdit.project_id &&
      w.center_id === bEdit.center_id &&
      (!bEdit.fy_year || w.fy === bEdit.fy_year));
    if (matches.length === 1) {
      const only = matches[0];
      setBEdit((prev) => (prev && !prev.work_order_id ? { ...prev, work_order_id: only.id } : prev));
      toast.success(`Work Order ${only.wo_number} auto-linked`);
    }
    // eslint-disable-next-line
  }, [bOpen, bEdit?.project_id, bEdit?.center_id, bEdit?.fy_year, bEdit?.work_order_id, woList]);

  // Phase 38 · Job Role master + live WO calculation
  const [jobRoles, setJobRoles] = useState([]);
  const [rateInfo, setRateInfo] = useState(null); // {base_rate, final_rate, is_lwe, ...}
  const [rateBusy, setRateBusy] = useState(false);
  const [jrOpen, setJrOpen] = useState(false);
  const [jrDraft, setJrDraft] = useState({ name: "", default_hours: 8, nsqf_level: "" });

  const loadJobRoles = useCallback(async () => {
    try { const r = await api.get("/job-role-master"); setJobRoles(r.data || []); }
    catch { setJobRoles([]); }
  }, []);
  useEffect(() => { loadJobRoles(); }, [loadJobRoles]);

  // Phase 87 — Job Role dropdown driven by the LINKED Work Order's courses.
  const selectedWO = useMemo(
    () => woList.find((w) => w.id === bEdit?.work_order_id) || null,
    [woList, bEdit?.work_order_id],
  );
  const woCourses = selectedWO?.courses || [];
  // When a WO is linked, inherit its FY and (if it has a single course) auto-fill
  // that course's role/category/hours/candidates so the user needn't type them.
  useEffect(() => {
    if (!bOpen || !bEdit?.work_order_id || !selectedWO) return;
    setBEdit((prev) => {
      if (!prev) return prev;
      const patch = {};
      if (selectedWO.fy && prev.fy_year !== selectedWO.fy) patch.fy_year = selectedWO.fy;
      const courses = selectedWO.courses || [];
      if (courses.length === 1 && prev.wo_course_index == null) {
        const c = courses[0];
        patch.wo_course_index = 0;
        patch.job_role = c.course || c.qp_code || "";
        if (!prev.category) patch.category = c.category || "";
        if (!prev.job_role_hours) patch.job_role_hours = Number(c.course_hours) || 0;
        if (!prev.num_candidates) patch.num_candidates = Number(c.beneficiaries) || 0;
      }
      return Object.keys(patch).length ? { ...prev, ...patch } : prev;
    });
  }, [bOpen, bEdit?.work_order_id, selectedWO]);

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
  const openEditBatch = (b) => {
    // Prefill the dialog with the existing batch for editing (id present ⇒ edit mode).
    setBEdit({ ...EMPTY_BATCH, ...b });
    const t = b.target_id ? targets.find((x) => x.id === b.target_id) : null;
    setSelectedTargetForBatch(t || null);
    setBOpen(true);
  };
  const removeBatch = async (b) => {
    if (!window.confirm(`Delete batch "${b.name}"? This releases its target allocation and cannot be undone.`)) return;
    try {
      await api.delete(`/batches/${b.id}`);
      toast.success("Batch deleted");
      loadBatches(); loadTargets();
    } catch (e) { toast.error(formatError(e)); }
  };
  const [woReconciling, setWoReconciling] = useState(false);
  const reconcileLegacyWO = async () => {
    if (!window.confirm("Auto-link all batches that have no Work Order to a matching active Work Order (same Project + Centre + FY)? Only missing fields are filled — nothing is overwritten.")) return;
    setWoReconciling(true);
    try {
      const r = await api.post("/batches/reconcile-work-orders");
      const d = r.data || {};
      toast.success(`Linked ${d.linked} batch(es). ${d.ambiguous} ambiguous, ${d.no_match} without a matching WO.`);
      loadBatches(); loadTargets();
    } catch (e) { toast.error(formatError(e)); }
    finally { setWoReconciling(false); }
  };
  const saveBatch = async () => {
    const isEdit = !!bEdit.id;
    if (!isEdit && !bEdit.target_id) return toast.error("Select a Target first (Stage 1) — batches must be created against an allocated target");
    if (!bEdit.project_id) return toast.error("Project is required");
    if (!bEdit.name?.trim()) return toast.error("Batch ID / Name is required");
    if (!bEdit.total_beneficiaries || Number(bEdit.total_beneficiaries) <= 0) return toast.error("Batch capacity must be > 0");
    if (!isEdit && selectedTargetForBatch && Number(bEdit.total_beneficiaries) > (selectedTargetForBatch.remaining || 0)) {
      return toast.error(`Batch capacity exceeds target remaining (${selectedTargetForBatch.remaining})`);
    }
    setBSaving(true);
    try {
      if (isEdit) {
        await api.put(`/batches/${bEdit.id}`, bEdit);
        toast.success("Batch updated");
      } else {
        await api.post("/batches", bEdit);
        toast.success("Batch created & target consumed");
      }
      setBOpen(false); setBEdit(null); setSelectedTargetForBatch(null);
      loadBatches(); loadTargets();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBSaving(false); }
  };

  // Phase 38 · Auto-recalculate rate + work order value whenever the inputs change.
  // Debounced 250ms so rapid typing doesn't spam the server.
  useEffect(() => {
    if (!bEdit || !bOpen) return;
    if (!bEdit.fy_year || !bEdit.category) { setRateInfo(null); return; }
    setRateBusy(true);
    const t = setTimeout(async () => {
      try {
        const payload = {
          fy_year: bEdit.fy_year,
          category: bEdit.category,
          num_candidates: Number(bEdit.num_candidates || 0),
          job_role_hours: Number(bEdit.job_role_hours || 0),
        };
        if (bEdit.center_id) payload.district_id = bEdit.center_id;
        const r = await api.post("/work-order/calculate", payload);
        setRateInfo(r.data);
        setBEdit((prev) => prev ? ({
          ...prev,
          is_lwe: r.data.is_lwe, base_rate: r.data.base_rate,
          final_rate: r.data.final_rate, work_order_value: r.data.work_order_value,
        }) : prev);
      } catch { setRateInfo(null); }
      finally { setRateBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [bEdit?.fy_year, bEdit?.category, bEdit?.center_id, bEdit?.num_candidates, bEdit?.job_role_hours, bOpen]);

  const addJobRole = async () => {
    const name = jrDraft.name.trim();
    if (!name) return toast.error("Job Role name is required");
    try {
      const r = await api.post("/job-role-master", { ...jrDraft, name, default_hours: Number(jrDraft.default_hours) || 0 });
      toast.success(`Job Role '${r.data.name}' added`);
      setJobRoles((prev) => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      // Auto-select the newly-created role.
      setBEdit((prev) => prev ? ({ ...prev, job_role_master_id: r.data.id, job_role_hours: r.data.default_hours }) : prev);
      setJrOpen(false); setJrDraft({ name: "", default_hours: 8, nsqf_level: "" });
    } catch (e) { toast.error(formatError(e)); }
  };
  const pickJobRole = (rid) => {
    const r = jobRoles.find((x) => x.id === rid);
    setBEdit((prev) => prev ? ({ ...prev, job_role_master_id: rid, job_role: r?.name || prev.job_role, job_role_hours: (r?.training_hours || r?.default_hours) || prev.job_role_hours, category: r?.category ? String(r.category) : prev.category }) : prev);
  };
  // Pick a job role from the linked Work Order's courses → auto-fill everything.
  const pickWOCourse = (idx) => {
    const c = woCourses[Number(idx)];
    if (!c) return;
    setBEdit((prev) => prev ? ({
      ...prev,
      wo_course_index: Number(idx),
      job_role: c.course || c.qp_code || "",
      category: c.category || prev.category,
      job_role_hours: Number(c.course_hours) || prev.job_role_hours,
      num_candidates: Number(c.beneficiaries) || prev.num_candidates,
    }) : prev);
  };

  // Phase 38 Session 2 · Bulk Batch Creation
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const downloadBulkTemplate = () => {
    const headers = ["batch_name", "project", "center", "company", "start_date", "end_date",
      "total_beneficiaries", "fy_year", "category", "job_role", "job_role_hours",
      "num_candidates", "training_type"];
    const sample = ["Ramgarh-BOCWW-JR12", "BOCWW", "Ramgarh Skill Centre", "Emergent Skills Pvt Ltd",
      "2026-04-01", "2026-06-30", "30", "2026-27", "I", "Electrician", "8", "30", "STT"];
    const csv = [headers.join(","), sample.join(",")].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "batches_bulk_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  const doBulkUpload = async () => {
    if (!bulkFile) return toast.error("Pick a CSV / XLSX file first");
    setBulkBusy(true);
    try {
      const fd = new FormData(); fd.append("file", bulkFile);
      const r = await api.post("/batches/bulk-upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setBulkPreview(r.data); setBulkResult(null);
      toast.success(`Parsed ${r.data.counts.total_parsed} rows · ${r.data.counts.valid} valid · ${r.data.counts.errors} error(s)`);
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };
  const doBulkCommit = async () => {
    if (!bulkPreview?.valid?.length) return;
    setBulkBusy(true);
    try {
      const r = await api.post("/batches/bulk-commit", { rows: bulkPreview.valid });
      setBulkResult(r.data);
      toast.success(`Inserted ${r.data.inserted} of ${r.data.total} batches`);
      loadBatches();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };
  const closeBulk = () => { setBulkOpen(false); setBulkFile(null); setBulkPreview(null); setBulkResult(null); };

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

  // Stepper completion + sub-count per stage (derived from live data).
  const enrolledTotal = useMemo(() => batches.reduce((s, b) => s + (Number(b.enrolled) || 0), 0), [batches]);
  const stepDone = {
    targets: kpi.total_target > 0,
    batches: batches.length > 0,
    enroll: enrolledTotal > 0,
    attendance: false,
    assessment: batches.some((b) => (b.passed_candidates || 0) > 0),
    placement: batches.some((b) => (b.placed_candidates || 0) > 0),
    closure: batches.some((b) => (b.lifecycle_status === "Closed" || b.closed)),
  };
  const stepSub = (v) => {
    if (v === "targets") return `${kpi.allocated.toLocaleString("en-IN")} / ${kpi.total_target.toLocaleString("en-IN")}`;
    if (v === "batches") return `${batches.length} batches`;
    if (v === "enroll") return enrolledTotal ? `${enrolledTotal.toLocaleString("en-IN")} enrolled` : "—";
    return "—";
  };

  return (
    <div className="space-y-5" data-testid="batch-management-page">
      {/* ===== Premium dashboard header (KPIs, financials, filters, analytics, WO summary, target allocation, drawer) ===== */}
      <BatchDashboard
        kpi={kpi}
        cards={woFin.cards}
        grandTotal={woFin.grand_total}
        summaryRows={woFin.summary_rows}
        targets={targets}
        batches={batches}
        woList={woList}
        filters={woFilters}
        setFilter={setWoFilter}
        clearFilters={clearWoFilters}
        projects={entProjects}
        centers={entCenters}
        fyOptions={FY_OPTIONS}
        loading={woFinLoading}
        canManageWO={canManageWO}
        canManageTargets={canManageTargets}
        canManageBatches={canManageBatches}
        onAddWO={openAddWO}
        onAllocateTarget={openNewTarget}
        onCreateBatch={() => openNewBatch()}
        onEditWO={openEditWO}
        onEditTarget={openEditTarget}
        onCreateBatchForTarget={(t) => openNewBatch(t)}
        goToStage={setTab}
        fetchWOs={fetchWOsFor}
      />

      {/* ===== Bottom lifecycle stepper — click a stage to load its detail below ===== */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {STEPPER.map((s, i) => {
            const isActive = tab === s.v;
            const done = stepDone[s.v];
            const sub = stepSub(s.v);
            return (
              <React.Fragment key={s.v}>
                <button
                  onClick={() => setTab(s.v)}
                  data-testid={`stepper-${s.v}`}
                  className={`flex-1 min-w-[120px] flex flex-col items-center text-center px-2 py-2 rounded-lg transition-colors ${isActive ? "bg-blue-50 border border-blue-200" : "hover:bg-slate-50 border border-transparent"}`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mb-1 ${
                    isActive ? "bg-blue-600 text-white ring-4 ring-blue-100"
                      : done ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                      : "bg-slate-100 text-slate-400 border border-slate-200"}`}>
                    {done && !isActive ? <CheckCircle2 size={15} /> : i + 1}
                  </span>
                  <span className={`text-[11px] font-semibold leading-tight ${isActive ? "text-blue-700" : "text-slate-600"}`}>{s.label}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">{sub}</span>
                </button>
                {i < STEPPER.length - 1 && <div className="self-center w-4 h-0.5 bg-slate-200 shrink-0" />}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Stage detail */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">

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
              {canManageWO && (
                <Button variant="outline" onClick={() => openAddWO(tProjF !== "all" ? { project_id: tProjF } : null)} className="rounded-md gap-1" data-testid="bm-tgt-add-wo-btn">
                  <Plus size={13} /> Work Order
                </Button>
              )}
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
                  <th className="text-right">Work Order Value</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tLoading && <tr><td colSpan={11} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
                {!tLoading && filteredTargets.length === 0 && (
                  <tr><td colSpan={11} className="p-8 text-center text-[var(--muted)]">
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
                      <td className="text-right num font-semibold text-[var(--brand)]" data-testid={`bm-tgt-wo-value-${t.id}`}>
                        {t.work_order_value ? inr(t.work_order_value) : <span className="text-[var(--muted)]">—</span>}
                        {t.center_wo_value > (t.work_order_value || 0) && (
                          <div className="text-[9px] text-[var(--muted)] font-normal">Centre: {inr(t.center_wo_value)}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <Button size="icon" variant="ghost" onClick={() => openViewForTarget(t)} className="h-7 w-7" title="View Work Order" data-testid={`bm-tgt-view-wo-${t.id}`}><Eye size={13} /></Button>
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
              {canManageBatches && (
                <Button
                  onClick={() => setBulkOpen(true)}
                  variant="outline"
                  className="rounded-none gap-1"
                  data-testid="bm-batch-bulk-btn"
                >
                  <Upload size={13} /> Bulk Create
                </Button>
              )}
              {canManageBatches && (
                <Button
                  onClick={reconcileLegacyWO}
                  disabled={woReconciling}
                  variant="outline"
                  className="rounded-none gap-1"
                  title="Auto-link legacy batches to matching active Work Orders"
                  data-testid="bm-batch-reconcile-wo-btn"
                >
                  <Wrench size={13} /> {woReconciling ? "Linking…" : "Fix Legacy WO"}
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
                  <th>Start</th><th>End</th><th>Status</th><th>Work Order</th><th>Target</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bLoading && <tr><td colSpan={11} className="p-4 text-center text-[var(--muted)]">Loading…</td></tr>}
                {!bLoading && filteredBatches.length === 0 && (
                  <tr><td colSpan={11} className="p-8 text-center text-[var(--muted)]">No batches match your filters.</td></tr>
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
                      <td className="text-right">{num(b.enrolled || 0)}</td>
                      <td>{b.start_date || "—"}</td>
                      <td>{b.end_date || "—"}</td>
                      <td>
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border ${LC_TONE[lc] || "bg-gray-100"}`}>{lc}</span>
                      </td>
                      <td>
                        {b.work_order_no
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--brand)] font-semibold" title="Linked Work Order"><FileText size={10} /> {b.work_order_no}</span>
                          : <span className="text-[var(--muted)] text-[10px]">—</span>}
                      </td>
                      <td>
                        {b.target_id ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700"><BadgeCheck size={10} /> Linked</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 border border-gray-300 text-[9px] font-bold uppercase text-gray-600" title="Created before Batch Management module; no target link required.">
                            <LockKeyhole size={9} /> Legacy
                          </span>
                        )}
                        {!b.work_order_id && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 mt-1 bg-amber-100 border border-amber-300 text-amber-800 text-[9px] font-bold uppercase" title="No Work Order linked — click 'Fix Legacy WO' or Edit to link one.">
                            Incomplete WO
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        {canManageBatches && (
                          <div className="inline-flex items-center gap-1 justify-end">
                            <Button size="icon" variant="ghost" onClick={() => openEditBatch(b)} className="h-7 w-7 rounded-none hover:text-[var(--brand)]" title="Edit batch" data-testid={`bm-batch-edit-${b.id}`}><Edit3 size={13} /></Button>
                            <Button size="icon" variant="ghost" onClick={() => removeBatch(b)} className="h-7 w-7 rounded-none hover:text-red-700" title="Delete batch" data-testid={`bm-batch-del-${b.id}`}><Trash2 size={13} /></Button>
                          </div>
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
            <DialogTitle className="font-heading">{bEdit?.id ? "Edit Batch" : "Create New Batch"}</DialogTitle>
            <DialogDescription className="text-xs">{bEdit?.id ? "Update batch details, link a Work Order, and complete the FY / Category to fix the rate." : "Batches consume seats from an allocated target. Capacity cannot exceed the target's remaining seats."}</DialogDescription>
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

              {/* Phase 38 · Work Order Allocation */}
              <div className="border-l-4 border-indigo-500 bg-indigo-50/30 p-3 space-y-3">
                <div className="overline text-[10px] flex items-center justify-between border-b border-indigo-200 pb-1">
                  <span>Work Order Allocation · Rate Engine</span>
                  {rateBusy && <span className="text-[9px] italic text-[var(--muted)] normal-case">Calculating…</span>}
                </div>
                <div>
                  <Label className="overline text-[10px]">Linked Work Order</Label>
                  <Select value={bEdit.work_order_id || "none"} onValueChange={(v) => setBEdit({ ...bEdit, work_order_id: v === "none" ? "" : v, wo_course_index: null })}>
                    <SelectTrigger className="rounded-none" data-testid="bm-batch-inp-wo"><SelectValue placeholder="Select the sanctioned Work Order" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— No Work Order —</SelectItem>
                      {woList
                        .filter((w) => (!bEdit.project_id || w.project_id === bEdit.project_id) && (!bEdit.center_id || w.center_id === bEdit.center_id))
                        .map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.wo_number} — {w.center_name || "—"} — {w.fy}{w.effective_status !== "active" ? ` (${w.effective_status})` : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <div className="text-[9px] text-[var(--muted)] mt-1">Ties this batch to its sanctioned Work Order (WO No — Centre — FY). Filtered by the batch's project & centre.</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="overline text-[10px]">FY Year *</Label>
                    <Select value={bEdit.fy_year || undefined} onValueChange={(v) => setBEdit({ ...bEdit, fy_year: v })}>
                      <SelectTrigger className="rounded-none" data-testid="bm-batch-inp-fy"><SelectValue placeholder="Select FY" /></SelectTrigger>
                      <SelectContent>
                        {FY_OPTIONS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="overline text-[10px]">Category *</Label>
                    <Select value={bEdit.category || undefined} onValueChange={(v) => setBEdit({ ...bEdit, category: v })}>
                      <SelectTrigger className="rounded-none" data-testid="bm-batch-inp-cat"><SelectValue placeholder="I / II / III" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="I">I</SelectItem>
                        <SelectItem value="II">II</SelectItem>
                        <SelectItem value="III">III</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="overline text-[10px]">Job Role{selectedWO && woCourses.length > 0 ? " · from Work Order" : ""}</Label>
                    <div className="flex gap-1">
                      {selectedWO && woCourses.length > 0 ? (
                        <Select value={bEdit.wo_course_index != null ? String(bEdit.wo_course_index) : undefined} onValueChange={pickWOCourse}>
                          <SelectTrigger className="rounded-none flex-1" data-testid="bm-batch-inp-jobrole"><SelectValue placeholder="Select from Work Order" /></SelectTrigger>
                          <SelectContent>
                            {woCourses.map((c, i) => (
                              <SelectItem key={i} value={String(i)}>
                                {(c.course || c.qp_code || `Role ${i + 1}`)}{c.category ? ` · Cat ${c.category}` : ""}{c.course_hours ? ` · ${c.course_hours}h` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <>
                          <Select value={bEdit.job_role_master_id || undefined} onValueChange={pickJobRole}>
                            <SelectTrigger className="rounded-none flex-1" data-testid="bm-batch-inp-jobrole"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              {jobRoles.length === 0 && <SelectItem value="__none__" disabled>No job roles — add one</SelectItem>}
                              {jobRoles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.default_hours ? ` · ${r.default_hours}h` : ""}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button type="button" size="icon" variant="outline" onClick={() => setJrOpen(true)} className="h-9 w-9 rounded-none" title="Add Job Role" data-testid="bm-batch-jr-add"><Plus size={13} /></Button>
                        </>
                      )}
                    </div>
                    {selectedWO && woCourses.length > 0 && (
                      <div className="text-[9px] text-[var(--muted)] mt-0.5">Roles auto-loaded from {selectedWO.wo_number}. Selecting one fills Category, Hours & Candidates.</div>
                    )}
                  </div>
                  <div>
                    <Label className="overline text-[10px]">Job Role Hours</Label>
                    <Input type="number" min={0} step="0.5" value={bEdit.job_role_hours || ""} onChange={(e) => setBEdit({ ...bEdit, job_role_hours: Number(e.target.value) || 0 })} className="rounded-none" data-testid="bm-batch-inp-hours" />
                  </div>
                  <div>
                    <Label className="overline text-[10px]">No. of Candidate *</Label>
                    <Input type="number" min={1} value={bEdit.num_candidates || ""} onChange={(e) => setBEdit({ ...bEdit, num_candidates: Number(e.target.value) || 0 })} className="rounded-none" data-testid="bm-batch-inp-numcands" />
                  </div>
                  <div>
                    <Label className="overline text-[10px]">Per Hour Rate (auto)</Label>
                    <Input value={rateInfo ? `₹${Number(rateInfo.final_rate).toFixed(2)}` : "—"} readOnly className="rounded-none bg-gray-50 font-mono" data-testid="bm-batch-inp-rate" />
                    {rateInfo && (
                      <div className="text-[9px] text-[var(--muted)] mt-0.5">
                        Base ₹{rateInfo.base_rate}{rateInfo.is_lwe ? ` × 1.10 (LWE)` : ""} · slab {rateInfo.slab_label}
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-3">
                    <Label className="overline text-[10px]">Total Work Order Value (auto)</Label>
                    <Input value={rateInfo ? `₹${Number(rateInfo.work_order_value).toLocaleString("en-IN")}` : "—"} readOnly className="rounded-none bg-gray-50 font-mono font-black text-lg text-emerald-700" data-testid="bm-batch-inp-value" />
                    {rateInfo && (
                      <div className="text-[10px] text-[var(--muted)] mt-0.5">
                        Formula: {bEdit.num_candidates || 0} × ₹{rateInfo.final_rate} × {bEdit.job_role_hours || 0}h
                        {rateInfo.is_lwe && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 bg-amber-100 border border-amber-300 text-amber-800 text-[9px] font-bold uppercase">LWE +10%</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBOpen(false); setBEdit(null); setSelectedTargetForBatch(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={saveBatch} disabled={bSaving} className="brand-btn rounded-none" data-testid="bm-batch-save">{bSaving ? "Saving…" : (bEdit?.id ? "Save Changes" : "Create Batch")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 38 · Add Job Role dialog */}
      <Dialog open={jrOpen} onOpenChange={setJrOpen}>
        <DialogContent className="rounded-none max-w-md" data-testid="bm-batch-jr-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Add New Job Role</DialogTitle>
            <DialogDescription className="text-xs">Adds to the master. Immediately available in the dropdown.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="overline text-[10px]">Job Role Name *</Label>
              <Input value={jrDraft.name} onChange={(e) => setJrDraft({ ...jrDraft, name: e.target.value })} placeholder="e.g. Mason / Electrician" className="rounded-none" data-testid="bm-jr-inp-name" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="overline text-[10px]">Default Hours</Label>
                <Input type="number" min={0} step="0.5" value={jrDraft.default_hours} onChange={(e) => setJrDraft({ ...jrDraft, default_hours: e.target.value })} className="rounded-none" data-testid="bm-jr-inp-hours" />
              </div>
              <div>
                <Label className="overline text-[10px]">NSQF Level</Label>
                <Input value={jrDraft.nsqf_level} onChange={(e) => setJrDraft({ ...jrDraft, nsqf_level: e.target.value })} placeholder="4 / 5 / 6" className="rounded-none" data-testid="bm-jr-inp-nsqf" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJrOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={addJobRole} className="brand-btn rounded-none" data-testid="bm-jr-save">Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 38 · Bulk Batch Creation dialog */}
      <Dialog open={bulkOpen} onOpenChange={(o) => !o && closeBulk()}>
        <DialogContent className="rounded-none max-w-6xl max-h-[92vh] overflow-y-auto" data-testid="bm-batch-bulk-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Bulk Batch Creation</DialogTitle>
            <DialogDescription className="text-xs">
              Upload CSV / XLSX with headers: batch_name, project, center, company, start_date, end_date,
              total_beneficiaries, fy_year, category, job_role, job_role_hours, num_candidates, training_type.
              Rate and Work Order Value auto-calculated server-side per row.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* Upload bar */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={downloadBulkTemplate} className="rounded-none gap-1 text-xs" data-testid="bm-bulk-template">
                <Download size={13} /> Download Template
              </Button>
              <input type="file" accept=".csv,.xlsx" onChange={(e) => setBulkFile(e.target.files?.[0] || null)} className="text-xs" data-testid="bm-bulk-file" />
              <Button onClick={doBulkUpload} disabled={!bulkFile || bulkBusy} className="brand-btn rounded-none gap-1 text-xs" data-testid="bm-bulk-preview">
                <Upload size={13} /> {bulkBusy ? "Parsing…" : "Preview"}
              </Button>
              {bulkPreview && !bulkResult && (
                <Button onClick={doBulkCommit} disabled={bulkBusy || !bulkPreview.valid.length} className="brand-btn rounded-none gap-1 text-xs ml-auto" data-testid="bm-bulk-commit">
                  <CheckCircle2 size={13} /> Commit {bulkPreview.valid.length} rows
                </Button>
              )}
            </div>

            {/* Preview stats */}
            {bulkPreview && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 border border-gray-300 text-[10px] font-bold uppercase">Total parsed: {bulkPreview.counts.total_parsed}</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 border border-emerald-300 text-emerald-800 text-[10px] font-bold uppercase"><CheckCircle2 size={11} /> {bulkPreview.counts.valid} valid</span>
                {bulkPreview.counts.errors > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 border border-red-300 text-red-800 text-[10px] font-bold uppercase"><AlertTriangle size={11} /> {bulkPreview.counts.errors} error(s)</span>}
              </div>
            )}

            {/* Errors panel */}
            {bulkPreview && bulkPreview.errors.length > 0 && (
              <div className="border border-red-200 bg-red-50/60 p-2 max-h-52 overflow-y-auto text-[11px]">
                <div className="font-bold text-red-800 mb-1">Row-level errors — fix and re-upload:</div>
                {bulkPreview.errors.map((e, i) => (
                  <div key={i} className="border-t border-red-200 pt-1 mt-1">
                    <span className="font-mono font-bold">Row {e.row}:</span>{" "}
                    {(e.reasons || []).join(" · ")}{" "}
                    <span className="text-[10px] text-red-600 italic">({e.data?.batch_name || "—"})</span>
                  </div>
                ))}
              </div>
            )}

            {/* Valid rows preview */}
            {bulkPreview && bulkPreview.valid.length > 0 && !bulkResult && (
              <div className="overflow-x-auto border border-[var(--border)] max-h-96">
                <table className="w-full text-[10px]">
                  <thead className="bg-gray-50 sticky top-0"><tr className="[&>th]:p-1.5 [&>th]:text-left [&>th]:overline [&>th]:text-[9px]">
                    <th>#</th><th>Batch Name</th><th>Project</th><th>Center</th><th>Cap</th><th>FY</th><th>Cat</th><th>Rate</th><th>WO Value</th>
                  </tr></thead>
                  <tbody>
                    {bulkPreview.valid.slice(0, 100).map((r) => (
                      <tr key={r.row} className="border-t border-[var(--border)]/50 [&>td]:p-1.5">
                        <td className="font-mono">{r.row}</td>
                        <td className="font-semibold">{r.name}</td>
                        <td>{r.project_name || "—"}</td>
                        <td>{r.center_name || "—"}{r.is_lwe && <span className="ml-1 text-amber-700 font-bold text-[9px]">LWE</span>}</td>
                        <td className="text-right">{r.total_beneficiaries}</td>
                        <td className="font-mono">{r.fy_year || "—"}</td>
                        <td className="font-bold">{r.category || "—"}</td>
                        <td className="font-mono">{r.final_rate ? `₹${r.final_rate}` : "—"}</td>
                        <td className="font-mono font-black text-emerald-700">{r.work_order_value ? `₹${Number(r.work_order_value).toLocaleString("en-IN")}` : "—"}</td>
                      </tr>
                    ))}
                    {bulkPreview.valid.length > 100 && <tr><td colSpan={9} className="p-1.5 text-center italic text-[var(--muted)]">… and {bulkPreview.valid.length - 100} more</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {/* Commit result */}
            {bulkResult && (
              <div className="border-l-4 border-emerald-500 bg-emerald-50/60 p-3">
                <div className="font-heading font-black text-xl text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 size={20} /> {bulkResult.inserted} of {bulkResult.total} batches created
                </div>
                {bulkResult.failed?.length > 0 && (
                  <div className="mt-2 text-[11px]">
                    <div className="font-bold text-red-800">Failed rows:</div>
                    {bulkResult.failed.map((f, i) => <div key={i}>Row {f.row}: {f.reason}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBulk} className="rounded-none">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Phase 81 · Work Order modals ===== */}
      <WorkOrderFormModal
        open={woFormOpen}
        initial={woFormInitial}
        prefill={woFormPrefill}
        onClose={() => setWoFormOpen(false)}
        onSaved={onWOSaved}
        projects={entProjects}
        centers={entCenters}
        companies={entCompanies}
      />
      <WorkOrderViewModal
        open={woView.open}
        list={woView.list}
        loading={woView.loading}
        onClose={() => setWoView({ open: false, list: [], loading: false })}
        onEdit={openEditWO}
        onDelete={deleteWO}
        canManage={canManageWO}
        canDelete={user?.role === "admin"}
      />
    </div>
  );
}

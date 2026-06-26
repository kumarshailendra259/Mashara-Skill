import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, Clock, Calculator } from "lucide-react";
import PrintButton from "@/components/PrintButton";

const MILESTONES = ["1st", "2nd", "3rd", "other"];
const MILESTONE_LABEL = { "1st": "1st", "2nd": "2nd", "3rd": "3rd", other: "Other (manual)" };

// Must match backend constants in server.py (JOB_CATEGORY_RATES + UNIFORM_PER_CANDIDATE + MILESTONE_SHARES)
const CATEGORY_RATES = { "1": 56.35, "2": 52.50, "3": 36.85 };
const CATEGORY_LABEL = {
  "1": "Category 1 (₹56.35/hr)",
  "2": "Category 2 (₹52.50/hr)",
  "3": "Category 3 (₹36.85/hr)",
};
const UNIFORM_PER_CANDIDATE = 1000;
const SHARES = { "1st": 0.30, "2nd": 0.40, "3rd": 0.30 };
// 2-decimal INR formatter, used for TDS / net amounts (gross/role/uniform stay integer via inr())
const inr2 = (n) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(n || 0));
const TDS_OPTIONS = [
  { v: "0", label: "0% — No TDS" },
  { v: "2", label: "2%" },
  { v: "10", label: "10%" },
];

function computeMilestones(rows, passed, placed) {
  let roleTotal = 0;
  let totalCandidates = 0;
  (rows || []).forEach((r) => {
    const rate = CATEGORY_RATES[String(r.category)] || 0;
    const c = parseInt(r.candidates, 10) || 0;
    const h = parseFloat(r.hours) || 0;
    roleTotal += c * rate * h;
    totalCandidates += c;
  });
  roleTotal = Math.round(roleTotal * 100) / 100;
  const uniform = totalCandidates * UNIFORM_PER_CANDIDATE;
  const p = Math.max(0, Math.min(parseInt(passed, 10) || 0, totalCandidates));
  const pl = Math.max(0, Math.min(parseInt(placed, 10) || 0, totalCandidates));
  const failed = Math.max(0, totalCandidates - p);
  const denom = totalCandidates || 1;
  const round2 = (x) => Math.round(x * 100) / 100;
  const firstAmount = round2(roleTotal * SHARES["1st"] + uniform);
  const secondGross = round2(roleTotal * SHARES["2nd"] * (p / denom));
  const secondRecovery = round2(roleTotal * SHARES["1st"] * (failed / denom));
  const secondNet = round2(secondGross - secondRecovery);
  const thirdAmount = round2(roleTotal * SHARES["3rd"] * (pl / denom));
  return {
    roleTotal, uniform, totalCandidates,
    passed: p, placed: pl, failed,
    first: { amount: firstAmount, rolePortion: round2(roleTotal * SHARES["1st"]), uniform },
    second: { gross: secondGross, recovery: secondRecovery, amount: secondNet, basedOn: `${p}/${totalCandidates} passed`, failed },
    third: { amount: thirdAmount, basedOn: `${pl}/${totalCandidates} placed` },
  };
}

// Back-compat alias used by older sections
const computeFirstMilestone = (rows) => {
  const b = computeMilestones(rows, 0, 0);
  return { roleTotal: b.roleTotal, uniformTotal: b.uniform, total: b.first.amount, totalCandidates: b.totalCandidates };
};

function MilestoneCard({ milestone, payment, canEdit, canReceive, onAdd, onReceive, onEdit, onDelete }) {
  const received = payment?.status === "received";
  const empty = !payment;
  return (
    <div className={`swiss-card p-4 ${received ? "border-[var(--success)]" : empty ? "border-dashed" : ""}`} data-testid={`milestone-${milestone}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="overline text-xs">Milestone</div>
          <div className="font-heading font-black text-xl tracking-tight">{MILESTONE_LABEL[milestone] || milestone}</div>
        </div>
        {received ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-[var(--success)] text-[var(--success)]">
            <Check size={12} /> Received
          </span>
        ) : empty ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-dashed border-[var(--muted)] text-[var(--muted)]">
            Not configured
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-[var(--warning)] text-[#9a7a00]">
            <Clock size={12} /> Pending
          </span>
        )}
      </div>
      {empty ? (
        canEdit ? (
          <Button onClick={onAdd} className="w-full brand-btn rounded-none mt-2 gap-1" data-testid={`btn-add-${milestone}`}>
            <Plus size={14} /> Configure {milestone}
          </Button>
        ) : (
          <div className="text-sm text-[var(--muted)] py-3">No payment set</div>
        )
      ) : (
        <>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="overline">Gross</span><span className="num font-bold">{inr(payment.amount)}</span></div>
            {milestone === "1st" && payment.uniform_amount > 0 && (
              <div className="flex justify-between"><span className="overline">Uniform</span><span className="num">{inr(payment.uniform_amount)}</span></div>
            )}
            {received && payment.recovery_amount > 0 && (
              <div className="flex justify-between text-[var(--danger)]"><span className="overline">Recovery</span><span className="num">−{inr2(payment.recovery_amount)}</span></div>
            )}
            {received && payment.assessment_fee_total > 0 && (
              <div className="flex justify-between text-[var(--danger)]"><span className="overline">Assessment fee</span><span className="num">−{inr2(payment.assessment_fee_total)}</span></div>
            )}
            {received && payment.tds_percent > 0 && (
              <>
                <div className="flex justify-between text-[var(--danger)]"><span className="overline">TDS ({payment.tds_percent}%)</span><span className="num">−{inr2(payment.tds_amount)}</span></div>
                <div className="flex justify-between border-t border-[var(--border)] pt-1.5 mt-1"><span className="overline">Net Received</span><span className="num font-bold value-positive">{inr2(payment.net_amount || (payment.amount - payment.tds_amount))}</span></div>
              </>
            )}
            {received && payment.tds_percent === 0 && (payment.recovery_amount > 0 || payment.assessment_fee_total > 0) && (
              <div className="flex justify-between border-t border-[var(--border)] pt-1.5 mt-1"><span className="overline">Net Received</span><span className="num font-bold value-positive">{inr2(payment.net_amount || (payment.amount - (payment.recovery_amount || 0) - (payment.assessment_fee_total || 0)))}</span></div>
            )}
            {payment.expected_date && (
              <div className="flex justify-between"><span className="overline">Expected</span><span className="num">{payment.expected_date}</span></div>
            )}
            {received && payment.received_date && (
              <div className="flex justify-between"><span className="overline">Received</span><span className="num">{payment.received_date}</span></div>
            )}
            {payment.description && <div className="text-xs text-[var(--muted)] pt-1 border-t border-[var(--border)]">{payment.description}</div>}
          </div>
          <div className="flex gap-2 mt-3 no-print">
            {!received && canReceive && (
              <Button size="sm" onClick={() => onReceive(payment)} className="brand-btn rounded-none flex-1 gap-1" data-testid={`btn-receive-${milestone}`}>
                <Check size={14} /> Mark Received
              </Button>
            )}
            {canEdit && !received && (
              <>
                <Button size="icon" variant="ghost" onClick={() => onEdit(payment)} className="rounded-none h-8 w-8"><Pencil size={14} /></Button>
                <Button size="icon" variant="ghost" onClick={() => onDelete(payment)} className="rounded-none h-8 w-8 hover:text-[var(--danger)]"><Trash2 size={14} /></Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function Programs() {
  const { user } = useAuth();
  const canEditPayments = ["admin", "manager", "senior_manager", "accountant"].includes(user?.role);
  const canReceive = ["admin", "accountant", "senior_manager"].includes(user?.role);
  const canEditBatches = ["admin", "manager", "senior_manager"].includes(user?.role);

  const [projects, setProjects] = useState([]);
  const [centers, setCenters] = useState([]);
  const [partners, setPartners] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [selectedCenterId, setSelectedCenterId] = useState("__all");

  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [payments, setPayments] = useState([]);

  // Batch dialog
  const [batchOpen, setBatchOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const emptyBatch = { project_id: "", center_id: "", partner_ids: [], name: "", start_date: "", end_date: "", total_beneficiaries: 0, description: "", job_roles: [], passed_candidates: 0, placed_candidates: 0, partner_share_percent: 0 };
  const [bForm, setBForm] = useState(emptyBatch);

  // Payment dialog
  const [payOpen, setPayOpen] = useState(false);
  const [editingPay, setEditingPay] = useState(null);
  const emptyPay = { batch_id: "", milestone: "1st", amount: "", expected_date: "", description: "", uniform_amount: 0, recovery_amount: 0, assessment_fee_per_candidate: 0, assessment_fee_total: 0 };
  const [pForm, setPForm] = useState(emptyPay);
  const [autoFilled, setAutoFilled] = useState(false); // hint flag

  // Receive dialog (TDS confirmation)
  const [recvOpen, setRecvOpen] = useState(false);
  const [recvTarget, setRecvTarget] = useState(null);
  const [recvTds, setRecvTds] = useState("0");

  useEffect(() => {
    Promise.all([api.get("/entities/project"), api.get("/entities/center"), api.get("/entities/partner")])
      .then(([p, c, pa]) => {
        setProjects(p.data);
        setCenters(c.data);
        setPartners(pa.data);
        if (!activeProjectId && p.data.length) setActiveProjectId(p.data[0].id);
      })
      .catch(() => {});
  }, []);

  // Load batches when project / center filter changes
  useEffect(() => {
    if (!activeProjectId) { setBatches([]); setSelectedBatchId(""); return; }
    const params = { project_id: activeProjectId };
    if (selectedCenterId && selectedCenterId !== "__all") params.center_id = selectedCenterId;
    api.get("/batches", { params }).then((r) => {
      setBatches(r.data);
      setSelectedBatchId((cur) => (r.data.find((b) => b.id === cur)?.id) || r.data[0]?.id || "");
    }).catch(() => setBatches([]));
  }, [activeProjectId, selectedCenterId]);

  // Load payments for selected batch
  useEffect(() => {
    if (!selectedBatchId) { setPayments([]); return; }
    api.get("/batch-payments", { params: { batch_id: selectedBatchId } }).then((r) => setPayments(r.data)).catch(() => setPayments([]));
  }, [selectedBatchId]);

  const paymentByMilestone = useMemo(() => {
    const m = {};
    payments.forEach((p) => { m[p.milestone] = p; });
    return m;
  }, [payments]);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeBatch = batches.find((b) => b.id === selectedBatchId);

  // Live milestone breakdown for batch dialog (3-milestone with passed/placed)
  const bFormBreakdown = useMemo(
    () => computeMilestones(bForm.job_roles, bForm.passed_candidates, bForm.placed_candidates),
    [bForm.job_roles, bForm.passed_candidates, bForm.placed_candidates],
  );
  // For showing on active batch summary card — uses persisted passed/placed
  const activeBatchBreakdown = useMemo(
    () => activeBatch ? computeMilestones(
      activeBatch.job_roles || [],
      activeBatch.passed_candidates || 0,
      activeBatch.placed_candidates || 0,
    ) : null,
    [activeBatch],
  );

  // Job-role row helpers (used inside the batch dialog)
  const addJobRoleRow = () => setBForm((s) => ({
    ...s,
    job_roles: [...(s.job_roles || []), { category: "1", job_role: "", candidates: 0, hours: 0 }],
  }));
  const updateJobRoleRow = (idx, patch) => setBForm((s) => {
    const next = [...(s.job_roles || [])];
    next[idx] = { ...next[idx], ...patch };
    return { ...s, job_roles: next };
  });
  const removeJobRoleRow = (idx) => setBForm((s) => ({
    ...s,
    job_roles: (s.job_roles || []).filter((_, i) => i !== idx),
  }));

  // Batch CRUD
  const openNewBatch = () => {
    setEditingBatch(null);
    setBForm({ ...emptyBatch, project_id: activeProjectId, center_id: selectedCenterId === "__all" ? "" : selectedCenterId });
    setBatchOpen(true);
  };
  const openEditBatch = (b) => {
    setEditingBatch(b);
    setBForm({
      project_id: b.project_id, center_id: b.center_id || "",
      partner_ids: b.partner_ids || [],
      name: b.name, start_date: b.start_date || "", end_date: b.end_date || "",
      total_beneficiaries: b.total_beneficiaries || 0, description: b.description || "",
      job_roles: b.job_roles || [],
      passed_candidates: b.passed_candidates || 0,
      placed_candidates: b.placed_candidates || 0,
      partner_share_percent: b.partner_share_percent || 0,
    });
    setBatchOpen(true);
  };
  const saveBatch = async () => {
    if (!bForm.name.trim()) { toast.error("Batch name required"); return; }
    if (!bForm.project_id) { toast.error("Project required"); return; }
    try {
      // Auto-compute total_beneficiaries from job_roles when present
      const computedBeneficiaries = (bForm.job_roles || []).reduce((s, r) => s + (parseInt(r.candidates, 10) || 0), 0);
      const payload = {
        ...bForm,
        total_beneficiaries: computedBeneficiaries || +bForm.total_beneficiaries || 0,
        center_id: bForm.center_id || null,
        partner_ids: bForm.partner_ids || [],
        passed_candidates: parseInt(bForm.passed_candidates, 10) || 0,
        placed_candidates: parseInt(bForm.placed_candidates, 10) || 0,
        partner_share_percent: parseFloat(bForm.partner_share_percent) || 0,
        job_roles: (bForm.job_roles || []).map((r) => ({
          category: String(r.category || "1"),
          job_role: r.job_role || "",
          candidates: parseInt(r.candidates, 10) || 0,
          hours: parseFloat(r.hours) || 0,
        })),
      };
      if (editingBatch) await api.put(`/batches/${editingBatch.id}`, payload);
      else {
        const r = await api.post("/batches", payload);
        setSelectedBatchId(r.data.id);
      }
      setBatchOpen(false);
      const params = { project_id: activeProjectId };
      if (selectedCenterId && selectedCenterId !== "__all") params.center_id = selectedCenterId;
      const r = await api.get("/batches", { params });
      setBatches(r.data);
      toast.success("Batch saved");
    } catch (e) { toast.error(formatError(e)); }
  };
  const deleteBatch = async (b) => {
    if (!window.confirm(`Delete batch "${b.name}" and all its milestones?`)) return;
    try {
      await api.delete(`/batches/${b.id}`);
      setBatches((bs) => bs.filter((x) => x.id !== b.id));
      if (selectedBatchId === b.id) setSelectedBatchId("");
      toast.success("Deleted");
    } catch (e) { toast.error(formatError(e)); }
  };

  // Payment CRUD
  const openNewPayment = (milestone) => {
    setEditingPay(null);
    if (activeBatch) {
      const bd = computeMilestones(
        activeBatch.job_roles || [],
        activeBatch.passed_candidates || 0,
        activeBatch.placed_candidates || 0,
      );
      if (milestone === "1st" && bd.first.amount > 0) {
        setPForm({
          batch_id: selectedBatchId, milestone, amount: bd.first.amount,
          expected_date: "",
          description: `Auto · 30% × ₹${bd.roleTotal.toLocaleString("en-IN")} role + uniform ₹${bd.uniform.toLocaleString("en-IN")} (${bd.totalCandidates} candidates × ₹1000)`,
          uniform_amount: bd.uniform, recovery_amount: 0,
        });
        setAutoFilled(true); setPayOpen(true); return;
      }
      if (milestone === "2nd" && bd.second.gross > 0) {
        // Set gross as amount; recovery + assessment fee captured separately and applied on Receive
        setPForm({
          batch_id: selectedBatchId, milestone, amount: bd.second.gross,
          expected_date: "",
          description: `Auto · 40% × ₹${bd.roleTotal.toLocaleString("en-IN")} × ${bd.passed}/${bd.totalCandidates} passed. Recovery for ${bd.failed} failed = ₹${bd.second.recovery.toLocaleString("en-IN")}`,
          uniform_amount: 0, recovery_amount: bd.second.recovery,
          assessment_fee_per_candidate: 0, assessment_fee_total: 0,
        });
        setAutoFilled(true); setPayOpen(true); return;
      }
      if (milestone === "3rd" && bd.third.amount > 0) {
        setPForm({
          batch_id: selectedBatchId, milestone, amount: bd.third.amount,
          expected_date: "",
          description: `Auto · 30% × ₹${bd.roleTotal.toLocaleString("en-IN")} × ${bd.placed}/${bd.totalCandidates} placed`,
          uniform_amount: 0, recovery_amount: 0,
          assessment_fee_per_candidate: 0, assessment_fee_total: 0,
        });
        setAutoFilled(true); setPayOpen(true); return;
      }
      // "other" milestone — always purely manual entry, no auto-fill
    }
    setPForm({ batch_id: selectedBatchId, milestone, amount: "", expected_date: "", description: "", uniform_amount: 0, recovery_amount: 0, assessment_fee_per_candidate: 0, assessment_fee_total: 0 });
    setAutoFilled(false);
    setPayOpen(true);
  };
  const openEditPayment = (p) => {
    setEditingPay(p);
    setPForm({
      batch_id: p.batch_id, milestone: p.milestone, amount: p.amount,
      expected_date: p.expected_date || "", description: p.description || "",
      uniform_amount: p.uniform_amount || 0,
      recovery_amount: p.recovery_amount || 0,
      assessment_fee_per_candidate: p.assessment_fee_per_candidate || 0,
      assessment_fee_total: p.assessment_fee_total || 0,
    });
    setAutoFilled(false);
    setPayOpen(true);
  };
  const savePayment = async () => {
    if (!(parseFloat(pForm.amount) > 0)) { toast.error("Amount must be > 0"); return; }
    try {
      const payload = {
        ...pForm,
        amount: parseFloat(pForm.amount),
        uniform_amount: parseFloat(pForm.uniform_amount) || 0,
        recovery_amount: parseFloat(pForm.recovery_amount) || 0,
        assessment_fee_per_candidate: parseFloat(pForm.assessment_fee_per_candidate) || 0,
        assessment_fee_total: parseFloat(pForm.assessment_fee_total) || 0,
      };
      if (editingPay) await api.put(`/batch-payments/${editingPay.id}`, payload);
      else await api.post("/batch-payments", payload);
      setPayOpen(false);
      const r = await api.get("/batch-payments", { params: { batch_id: selectedBatchId } });
      setPayments(r.data);
      toast.success("Saved");
    } catch (e) { toast.error(formatError(e)); }
  };

  // Receive flow with TDS confirmation
  const openReceive = (p) => {
    setRecvTarget(p);
    setRecvTds("0");
    setRecvOpen(true);
  };
  const confirmReceive = async () => {
    if (!recvTarget) return;
    try {
      await api.patch(`/batch-payments/${recvTarget.id}/receive`, { tds_percent: parseInt(recvTds, 10) || 0 });
      const r = await api.get("/batch-payments", { params: { batch_id: selectedBatchId } });
      setPayments(r.data);
      setRecvOpen(false);
      toast.success("Received & transactions recorded");
    } catch (e) { toast.error(formatError(e)); }
  };

  const deletePayment = async (p) => {
    if (!window.confirm(`Delete ${p.milestone} milestone?`)) return;
    try {
      await api.delete(`/batch-payments/${p.id}`);
      setPayments((ps) => ps.filter((x) => x.id !== p.id));
      toast.success("Deleted");
    } catch (e) { toast.error(formatError(e)); }
  };

  // Totals for active batch
  const totalConfigured = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalReceived = payments.filter((p) => p.status === "received").reduce((s, p) => s + (p.amount || 0), 0);

  const centerName = (id) => centers.find((c) => c.id === id)?.name || "—";

  // Live recv preview
  const recvPreview = useMemo(() => {
    if (!recvTarget) return null;
    const gross = recvTarget.amount || 0;
    const uniform = recvTarget.uniform_amount || 0;
    const recovery = recvTarget.recovery_amount || 0;
    const assessmentFee = recvTarget.assessment_fee_total || 0;
    const pct = parseFloat(recvTds) || 0;
    // TDS base: (gross − uniform − recovery). Uniform applies only to 1st; recovery to 2nd.
    const taxable = Math.max(0, gross - uniform - recovery);
    const tds = Math.round(taxable * pct) / 100;
    const net = gross - tds - recovery - assessmentFee;
    return { gross, uniform, recovery, assessmentFee, taxable, pct, tds, net };
  }, [recvTarget, recvTds]);

  return (
    <div className="space-y-5" data-testid="programs-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">Programs</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">Projects · Batches · Milestones</h1>
        </div>
        <PrintButton />
      </div>

      {projects.length === 0 ? (
        <div className="swiss-card p-8 text-center overline">No projects yet — create one under <a href="/projects" className="text-[var(--brand)] hover:underline">Projects</a> first.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-[var(--border)] no-print" data-testid="project-tabs">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveProjectId(p.id)}
                data-testid={`tab-project-${p.id}`}
                className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                  activeProjectId === p.id
                    ? "border-[var(--brand)] text-[var(--brand)] font-medium"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {activeProject && (
            <>
              <div className="swiss-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="overline">Center</Label>
                  <Select value={selectedCenterId} onValueChange={setSelectedCenterId}>
                    <SelectTrigger className="rounded-none" data-testid="filter-center"><SelectValue placeholder="All centers" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">All centers</SelectItem>
                      {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="overline">Batch</Label>
                  <div className="flex gap-2">
                    <Select value={selectedBatchId || "__none"} onValueChange={(v) => setSelectedBatchId(v === "__none" ? "" : v)} disabled={batches.length === 0}>
                      <SelectTrigger className="rounded-none" data-testid="filter-batch"><SelectValue placeholder={batches.length ? "Pick a batch" : "No batches"} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">—</SelectItem>
                        {batches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.center_id ? ` · ${centerName(b.center_id)}` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-end gap-2 no-print">
                  {canEditBatches && (
                    <Button onClick={openNewBatch} className="brand-btn rounded-none gap-1" data-testid="btn-new-batch">
                      <Plus size={14} /> New Batch
                    </Button>
                  )}
                  {activeBatch && canEditBatches && (
                    <>
                      <Button variant="outline" onClick={() => openEditBatch(activeBatch)} className="rounded-none" data-testid="btn-edit-batch"><Pencil size={14} /></Button>
                      <Button variant="outline" onClick={() => deleteBatch(activeBatch)} className="rounded-none hover:text-[var(--danger)]" data-testid="btn-delete-batch"><Trash2 size={14} /></Button>
                    </>
                  )}
                </div>
              </div>

              {!activeBatch ? (
                <div className="swiss-card p-8 text-center overline" data-testid="no-batch-msg">Select or create a batch under {activeProject.name} to manage milestone payments.</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="swiss-card p-3"><div className="overline">Batch</div><div className="font-heading font-bold text-lg truncate">{activeBatch.name}</div></div>
                    <div className="swiss-card p-3"><div className="overline">Center</div><div className="font-heading font-bold text-lg truncate">{activeBatch.center_id ? centerName(activeBatch.center_id) : "—"}</div></div>
                    <div className="swiss-card p-3"><div className="overline">Total Configured</div><div className="num font-bold text-xl">{inr(totalConfigured)}</div></div>
                    <div className="swiss-card p-3"><div className="overline">Total Received</div><div className="num font-bold text-xl value-positive">{inr(totalReceived)}</div></div>
                  </div>

                  {/* Job roles breakdown card (auto all 3 milestones) */}
                  {activeBatchBreakdown && activeBatchBreakdown.roleTotal > 0 && (
                    <div className="swiss-card p-4" data-testid="job-roles-breakdown">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Calculator size={16} className="text-[var(--brand)]" />
                          <div className="overline">Milestone Auto-Calculation</div>
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          {activeBatchBreakdown.totalCandidates} candidates · {activeBatchBreakdown.passed} passed · {activeBatchBreakdown.placed} placed
                          {activeBatchBreakdown.failed > 0 && <> · <span className="text-[var(--danger)]">{activeBatchBreakdown.failed} failed</span></>}
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="overline bg-gray-50 border-b border-[var(--border)]">
                              <th className="text-left p-2">Job Role</th>
                              <th className="text-left p-2">Category</th>
                              <th className="text-right p-2">Candidates</th>
                              <th className="text-right p-2">Hours</th>
                              <th className="text-right p-2">Rate/hr</th>
                              <th className="text-right p-2">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(activeBatch.job_roles || []).map((r, i) => {
                              const rate = CATEGORY_RATES[String(r.category)] || 0;
                              const c = parseInt(r.candidates, 10) || 0;
                              const h = parseFloat(r.hours) || 0;
                              return (
                                <tr key={`${r.category}-${r.job_role}-${i}`} className="border-b border-[var(--border)]">
                                  <td className="p-2">{r.job_role || <span className="text-[var(--muted)]">—</span>}</td>
                                  <td className="p-2 overline text-xs">Cat {r.category}</td>
                                  <td className="p-2 text-right num">{c}</td>
                                  <td className="p-2 text-right num">{h}</td>
                                  <td className="p-2 text-right num">₹{rate.toFixed(2)}</td>
                                  <td className="p-2 text-right num font-medium">{inr(c * rate * h)}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t-2 border-[var(--border)]">
                              <td className="p-2 font-medium" colSpan={5}>Role total (basis for milestone split)</td>
                              <td className="p-2 text-right num font-bold">{inr(activeBatchBreakdown.roleTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                        <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-3 text-sm" data-testid="bd-1st">
                          <div className="overline">1st Milestone · 30%</div>
                          <div className="space-y-0.5 mt-2">
                            <div className="flex justify-between"><span>Role 30%</span><span className="num">{inr(activeBatchBreakdown.first.rolePortion)}</span></div>
                            <div className="flex justify-between"><span>Uniform</span><span className="num">+{inr(activeBatchBreakdown.uniform)}</span></div>
                            <div className="flex justify-between border-t border-[var(--border)] pt-1 mt-1 font-bold"><span>Total</span><span className="num text-[var(--brand)]">{inr(activeBatchBreakdown.first.amount)}</span></div>
                          </div>
                        </div>
                        <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-3 text-sm" data-testid="bd-2nd">
                          <div className="overline">2nd Milestone · 40% × passed</div>
                          <div className="space-y-0.5 mt-2">
                            <div className="flex justify-between"><span>{activeBatchBreakdown.second.basedOn}</span><span className="num">{inr(activeBatchBreakdown.second.gross)}</span></div>
                            {activeBatchBreakdown.failed > 0 && (
                              <div className="flex justify-between text-[var(--danger)]"><span>Recovery ({activeBatchBreakdown.failed} failed)</span><span className="num">−{inr(activeBatchBreakdown.second.recovery)}</span></div>
                            )}
                            <div className="flex justify-between border-t border-[var(--border)] pt-1 mt-1 font-bold"><span>Net</span><span className="num text-[var(--brand)]">{inr(activeBatchBreakdown.second.amount)}</span></div>
                          </div>
                        </div>
                        <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-3 text-sm" data-testid="bd-3rd">
                          <div className="overline">3rd Milestone · 30% × placed</div>
                          <div className="space-y-0.5 mt-2">
                            <div className="flex justify-between"><span>{activeBatchBreakdown.third.basedOn}</span><span className="num">{inr(activeBatchBreakdown.third.amount)}</span></div>
                            <div className="flex justify-between border-t border-[var(--border)] pt-1 mt-1 font-bold"><span>Total</span><span className="num text-[var(--brand)]">{inr(activeBatchBreakdown.third.amount)}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {((activeBatch.partner_ids || []).length > 0 || (activeBatch.partner_share_percent || 0) > 0) && (
                    <div className="swiss-card p-4" data-testid="partner-split-section">
                      <div className="flex items-center justify-between mb-3">
                        <div className="overline">
                          Income split · Partner pool {activeBatch.partner_share_percent || 0}% of gross
                          {(activeBatch.partner_ids || []).length > 1 && ` ÷ ${(activeBatch.partner_ids || []).length} partners`}
                        </div>
                        <span className="overline">Company keeps {(100 - (activeBatch.partner_share_percent || 0)).toFixed(2)}%</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {(() => {
                          const pct = activeBatch.partner_share_percent || 0;
                          const nP = (activeBatch.partner_ids || []).length;
                          const partnerPool = totalConfigured * pct / 100;
                          const partnerPoolReceived = totalReceived * pct / 100;
                          const perPartner = nP > 0 ? partnerPool / nP : 0;
                          const perPartnerRecv = nP > 0 ? partnerPoolReceived / nP : 0;
                          const companyShare = totalConfigured - partnerPool;
                          const companyShareRecv = totalReceived - partnerPoolReceived;
                          return (
                            <>
                              <div className="border border-[var(--brand)] p-2 text-sm bg-blue-50" data-testid="company-share-card">
                                <div className="font-medium truncate flex items-center gap-1">
                                  <span className="overline text-[10px] bg-[var(--brand)] text-white px-1">COMPANY</span>
                                </div>
                                <div className="overline text-xs mt-1">Configured ({(100 - pct).toFixed(2)}%)</div>
                                <div className="num font-bold">{inr(companyShare)}</div>
                                {companyShareRecv > 0 && (
                                  <>
                                    <div className="overline text-xs mt-1">Received</div>
                                    <div className="num font-bold value-positive">{inr(companyShareRecv)}</div>
                                  </>
                                )}
                              </div>
                              {(activeBatch.partner_ids || []).map((pid) => {
                                const name = partners.find((p) => p.id === pid)?.name || pid;
                                return (
                                  <div key={pid} className="border border-[var(--border)] p-2 text-sm" data-testid={`partner-split-${pid}`}>
                                    <div className="font-medium truncate">{name}</div>
                                    <div className="overline text-xs mt-1">Configured share ({nP > 0 ? (pct / nP).toFixed(2) : 0}%)</div>
                                    <div className="num font-bold">{inr(perPartner)}</div>
                                    {perPartnerRecv > 0 && (
                                      <>
                                        <div className="overline text-xs mt-1">Received</div>
                                        <div className="num font-bold value-positive">{inr(perPartnerRecv)}</div>
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="milestones-grid">
                    {MILESTONES.map((m) => (
                      <MilestoneCard
                        key={m}
                        milestone={m}
                        payment={paymentByMilestone[m]}
                        canEdit={canEditPayments}
                        canReceive={canReceive}
                        onAdd={() => openNewPayment(m)}
                        onReceive={openReceive}
                        onEdit={openEditPayment}
                        onDelete={deletePayment}
                      />
                    ))}
                  </div>

                  <div className="swiss-card overflow-x-auto" data-testid="payments-table">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
                        <th className="text-left p-3">Milestone</th>
                        <th className="text-right p-3">Gross</th>
                        <th className="text-right p-3">TDS</th>
                        <th className="text-right p-3">Net</th>
                        <th className="text-left p-3">Expected</th>
                        <th className="text-left p-3">Status</th>
                        <th className="text-left p-3">Received</th>
                      </tr></thead>
                      <tbody>
                        {MILESTONES.map((m) => {
                          const p = paymentByMilestone[m];
                          return (
                            <tr key={m} className="border-b border-[var(--border)]">
                              <td className="p-3 font-medium">{MILESTONE_LABEL[m] || m}</td>
                              <td className="p-3 num text-right">{p ? inr(p.amount) : <span className="text-[var(--muted)]">—</span>}</td>
                              <td className="p-3 num text-right">{p && p.tds_percent > 0 ? `${p.tds_percent}% · ${inr2(p.tds_amount)}` : <span className="text-[var(--muted)]">—</span>}</td>
                              <td className="p-3 num text-right font-medium">{p && p.status === "received" ? inr2(p.net_amount || p.amount) : <span className="text-[var(--muted)]">—</span>}</td>
                              <td className="p-3 num">{p?.expected_date || "—"}</td>
                              <td className="p-3 overline text-xs">{p?.status || "—"}</td>
                              <td className="p-3 num">{p?.received_date || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Batch dialog */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="rounded-none max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">{editingBatch ? "Edit" : "New"} Batch</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Batch Name</Label>
              <Input value={bForm.name} onChange={(e) => setBForm({ ...bForm, name: e.target.value })} placeholder="e.g. Batch 2026-A" className="rounded-none" data-testid="batch-name" />
            </div>
            <div>
              <Label>Project</Label>
              <Select value={bForm.project_id} onValueChange={(v) => setBForm({ ...bForm, project_id: v })}>
                <SelectTrigger className="rounded-none"><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Center</Label>
              <Select value={bForm.center_id || "__none"} onValueChange={(v) => setBForm({ ...bForm, center_id: v === "__none" ? "" : v })}>
                <SelectTrigger className="rounded-none"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={bForm.start_date} onChange={(e) => setBForm({ ...bForm, start_date: e.target.value })} className="rounded-none" />
            </div>
            <div>
              <Label>End Date</Label>
              <Input type="date" value={bForm.end_date} onChange={(e) => setBForm({ ...bForm, end_date: e.target.value })} className="rounded-none" />
            </div>

            {/* Job Roles dynamic list */}
            <div className="col-span-2 border-t border-[var(--border)] pt-3 mt-1">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label className="overline">Job Roles · drives 1st milestone amount</Label>
                  <p className="text-xs text-[var(--muted)]">Add one row per job role. Rates: Cat 1 ₹56.35/hr · Cat 2 ₹52.50/hr · Cat 3 ₹36.85/hr. Uniform ₹1000 per candidate added automatically.</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={addJobRoleRow} className="rounded-none gap-1" data-testid="add-job-role">
                  <Plus size={12} /> Add Role
                </Button>
              </div>
              {(bForm.job_roles || []).length === 0 ? (
                <div className="text-center text-xs text-[var(--muted)] py-4 border border-dashed border-[var(--border)]">
                  No job roles. Click &quot;Add Role&quot; to define candidates × hours × category rate.
                </div>
              ) : (
                <div className="space-y-2">
                  {bForm.job_roles.map((r, idx) => {
                    const rate = CATEGORY_RATES[String(r.category)] || 0;
                    const subtotal = (parseInt(r.candidates, 10) || 0) * (parseFloat(r.hours) || 0) * rate;
                    return (
                      <div key={`jr-${idx}`} className="grid grid-cols-12 gap-2 items-end border border-[var(--border)] p-2" data-testid={`job-role-row-${idx}`}>
                        <div className="col-span-3">
                          <div className="overline text-xs mb-1">Category</div>
                          <Select value={String(r.category)} onValueChange={(v) => updateJobRoleRow(idx, { category: v })}>
                            <SelectTrigger className="rounded-none h-9" data-testid={`jr-cat-${idx}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">{CATEGORY_LABEL["1"]}</SelectItem>
                              <SelectItem value="2">{CATEGORY_LABEL["2"]}</SelectItem>
                              <SelectItem value="3">{CATEGORY_LABEL["3"]}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-3">
                          <div className="overline text-xs mb-1">Job Role</div>
                          <Input value={r.job_role || ""} onChange={(e) => updateJobRoleRow(idx, { job_role: e.target.value })} placeholder="e.g. Trainer" className="rounded-none h-9" data-testid={`jr-name-${idx}`} />
                        </div>
                        <div className="col-span-2">
                          <div className="overline text-xs mb-1">Candidates</div>
                          <Input type="number" min="0" value={r.candidates} onChange={(e) => updateJobRoleRow(idx, { candidates: e.target.value })} className="rounded-none h-9 num" data-testid={`jr-cand-${idx}`} />
                        </div>
                        <div className="col-span-2">
                          <div className="overline text-xs mb-1">Hours</div>
                          <Input type="number" min="0" step="0.5" value={r.hours} onChange={(e) => updateJobRoleRow(idx, { hours: e.target.value })} className="rounded-none h-9 num" data-testid={`jr-hours-${idx}`} />
                        </div>
                        <div className="col-span-2 flex items-end justify-between gap-1">
                          <div className="flex-1">
                            <div className="overline text-xs mb-1">Subtotal</div>
                            <div className="num font-medium text-sm">{inr(subtotal)}</div>
                          </div>
                          <Button type="button" size="icon" variant="ghost" onClick={() => removeJobRoleRow(idx)} className="rounded-none h-9 w-9 hover:text-[var(--danger)]" data-testid={`jr-remove-${idx}`}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="border-t border-[var(--border)] pt-2 mt-2 bg-blue-50 px-3 py-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm" data-testid="job-roles-totals">
                    <div>
                      <div className="overline text-xs">Role total</div>
                      <div className="num font-bold">{inr(bFormBreakdown.roleTotal)}</div>
                    </div>
                    <div>
                      <div className="overline text-xs">1st (30% + Uniform)</div>
                      <div className="num font-bold text-[var(--brand)]">{inr(bFormBreakdown.first.amount)}</div>
                    </div>
                    <div>
                      <div className="overline text-xs">2nd net (40%×P − recovery)</div>
                      <div className="num font-bold text-[var(--brand)]">{inr(bFormBreakdown.second.amount)}</div>
                    </div>
                    <div>
                      <div className="overline text-xs">3rd (30%×Placed)</div>
                      <div className="num font-bold text-[var(--brand)]">{inr(bFormBreakdown.third.amount)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="col-span-2 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3">
              <div>
                <Label>Passed Candidates <span className="overline text-[10px]">(drives 2nd milestone)</span></Label>
                <Input type="number" min="0" value={bForm.passed_candidates}
                  onChange={(e) => setBForm({ ...bForm, passed_candidates: e.target.value })}
                  className="rounded-none num" data-testid="batch-passed" />
              </div>
              <div>
                <Label>Placed Candidates <span className="overline text-[10px]">(drives 3rd milestone)</span></Label>
                <Input type="number" min="0" value={bForm.placed_candidates}
                  onChange={(e) => setBForm({ ...bForm, placed_candidates: e.target.value })}
                  className="rounded-none num" data-testid="batch-placed" />
              </div>
              {bFormBreakdown.failed > 0 && (
                <div className="col-span-2 text-xs text-[var(--muted)] border-l-2 border-[var(--danger)] pl-2 py-1">
                  ⚠ {bFormBreakdown.failed} failed candidate{bFormBreakdown.failed === 1 ? "" : "s"} · 2nd milestone recovery
                  = {inr(bFormBreakdown.second.recovery)} (30% × {bFormBreakdown.failed}/{bFormBreakdown.totalCandidates} of role)
                </div>
              )}
            </div>

            <div className="col-span-2 border-t border-[var(--border)] pt-3">
              <Label>Partner Share % of Gross Milestone <span className="overline text-[10px]">total partner pool; split equally among partner_ids · company keeps remainder</span></Label>
              <div className="grid grid-cols-3 gap-2 items-end">
                <Input
                  type="number" min="0" max="100" step="0.01"
                  value={bForm.partner_share_percent}
                  onChange={(e) => setBForm({ ...bForm, partner_share_percent: e.target.value })}
                  className="rounded-none num"
                  data-testid="batch-partner-share-pct"
                />
                <div className="col-span-2 text-xs text-[var(--muted)] bg-blue-50 border-l-2 border-[var(--brand)] px-2 py-1">
                  {(() => {
                    const pct = parseFloat(bForm.partner_share_percent) || 0;
                    const nP = (bForm.partner_ids || []).length;
                    if (pct === 0) return "0% → entire gross goes to company (no partner share).";
                    if (nP === 0) return `${pct}% set but no partners assigned → all to company until you add partners.`;
                    const perPct = (pct / nP).toFixed(2);
                    return `${nP} partner${nP === 1 ? "" : "s"} → each gets ${perPct}% · company keeps ${(100 - pct).toFixed(2)}%`;
                  })()}
                </div>
              </div>
            </div>

            <div className="col-span-2">
              <Label>Partners <span className="overline text-[10px]">(milestone income split equally among selected partners)</span></Label>
              <div className="border border-[var(--border)] p-2 max-h-32 overflow-y-auto space-y-1" data-testid="partner-multiselect">
                {partners.length === 0 ? (
                  <div className="overline text-xs py-2 text-center">No partners — create some under <a href="/partners" className="text-[var(--brand)] hover:underline">Partners</a></div>
                ) : partners.map((p) => {
                  const checked = (bForm.partner_ids || []).includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        data-testid={`partner-check-${p.id}`}
                        onChange={() => setBForm((s) => {
                          const ids = new Set(s.partner_ids || []);
                          if (ids.has(p.id)) ids.delete(p.id); else ids.add(p.id);
                          return { ...s, partner_ids: Array.from(ids) };
                        })}
                      />
                      <span>{p.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea value={bForm.description} onChange={(e) => setBForm({ ...bForm, description: e.target.value })} className="rounded-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={saveBatch} className="brand-btn rounded-none" data-testid="batch-save">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader><DialogTitle className="font-heading">{editingPay ? "Edit" : "Configure"} Milestone Payment</DialogTitle></DialogHeader>
          {autoFilled && !editingPay && (
            <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-2 text-xs">
              <strong>Auto-filled</strong> from this batch&apos;s job roles + outcome counts. You can override.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Milestone</Label>
              <Select value={pForm.milestone} onValueChange={(v) => setPForm({ ...pForm, milestone: v })} disabled={!!editingPay}>
                <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                <SelectContent>{MILESTONES.map((m) => <SelectItem key={m} value={m}>{MILESTONE_LABEL[m] || m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Gross Amount</Label>
              <Input type="number" step="0.01" value={pForm.amount} onChange={(e) => setPForm({ ...pForm, amount: e.target.value })} className="rounded-none num" data-testid="pay-amount" />
            </div>
            {pForm.milestone === "1st" && (
              <div className="col-span-2">
                <Label>Uniform Amount (excluded from TDS) <span className="overline text-[10px]">{UNIFORM_PER_CANDIDATE} × candidates</span></Label>
                <Input type="number" step="0.01" value={pForm.uniform_amount} onChange={(e) => setPForm({ ...pForm, uniform_amount: e.target.value })} className="rounded-none num" data-testid="pay-uniform" />
              </div>
            )}
            {pForm.milestone === "2nd" && (
              <div className="col-span-2">
                <Label>Recovery Amount <span className="overline text-[10px]">claw-back of 1st milestone for failed candidates</span></Label>
                <Input type="number" step="0.01" value={pForm.recovery_amount} onChange={(e) => setPForm({ ...pForm, recovery_amount: e.target.value })} className="rounded-none num" data-testid="pay-recovery" />
                <p className="text-[10px] text-[var(--muted)] mt-1">Formula: 30% × role_total × (failed / total). Applied on Mark Received → separate expense txn (source=candidate_recovery). TDS will be calculated on (gross − recovery).</p>
              </div>
            )}
            {pForm.milestone === "2nd" && (
              <>
                <div>
                  <Label>Assessment Fee per Candidate <span className="overline text-[10px]">manual / variable</span></Label>
                  <Input
                    type="number" step="0.01" min="0"
                    value={pForm.assessment_fee_per_candidate}
                    onChange={(e) => {
                      const per = e.target.value;
                      const passed = activeBatch?.passed_candidates || 0;
                      setPForm({
                        ...pForm,
                        assessment_fee_per_candidate: per,
                        assessment_fee_total: (parseFloat(per) || 0) * passed,
                      });
                    }}
                    className="rounded-none num"
                    data-testid="pay-assess-per"
                  />
                </div>
                <div>
                  <Label>Total Assessment Fee <span className="overline text-[10px]">{activeBatch?.passed_candidates || 0} passed × per</span></Label>
                  <Input
                    type="number" step="0.01" min="0"
                    value={pForm.assessment_fee_total}
                    onChange={(e) => setPForm({ ...pForm, assessment_fee_total: e.target.value })}
                    className="rounded-none num"
                    data-testid="pay-assess-total"
                  />
                  <p className="text-[10px] text-[var(--muted)] mt-1">Auto-calculated as per × passed_candidates. Manually editable. Recorded as expense (source=assessment_fee) on Receive.</p>
                </div>
              </>
            )}
            <div className="col-span-2">
              <Label>Expected Date</Label>
              <Input type="date" value={pForm.expected_date} onChange={(e) => setPForm({ ...pForm, expected_date: e.target.value })} className="rounded-none" />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea value={pForm.description} onChange={(e) => setPForm({ ...pForm, description: e.target.value })} className="rounded-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={savePayment} className="brand-btn rounded-none" data-testid="pay-save">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive (with TDS) dialog */}
      <Dialog open={recvOpen} onOpenChange={setRecvOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-heading">Mark {MILESTONE_LABEL[recvTarget?.milestone] || recvTarget?.milestone} Milestone as Received</DialogTitle>
          </DialogHeader>
          {recvTarget && recvPreview && (
            <div className="space-y-4">
              <div className="space-y-1 text-sm border border-[var(--border)] p-3 bg-gray-50">
                <div className="flex justify-between"><span className="overline">Gross from department</span><span className="num font-bold">{inr(recvPreview.gross)}</span></div>
                {recvTarget.milestone === "1st" && recvPreview.uniform > 0 && (
                  <div className="flex justify-between"><span className="overline">Uniform (TDS-exempt)</span><span className="num">{inr(recvPreview.uniform)}</span></div>
                )}
                {recvPreview.recovery > 0 && (
                  <div className="flex justify-between text-[var(--danger)]"><span className="overline">Recovery (failed candidates)</span><span className="num">−{inr2(recvPreview.recovery)}</span></div>
                )}
                <div className="flex justify-between"><span className="overline">Taxable base (gross − uniform − recovery)</span><span className="num">{inr(recvPreview.taxable)}</span></div>
                {recvPreview.assessmentFee > 0 && (
                  <div className="flex justify-between text-[var(--danger)]"><span className="overline">Assessment fee</span><span className="num">−{inr2(recvPreview.assessmentFee)}</span></div>
                )}
              </div>
              <div>
                <Label>TDS Deduction by Department</Label>
                <Select value={recvTds} onValueChange={setRecvTds}>
                  <SelectTrigger className="rounded-none" data-testid="recv-tds-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TDS_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 text-sm border-l-2 border-[var(--brand)] bg-blue-50 p-3">
                {recvPreview.pct > 0 ? (
                  <>
                    <div className="flex justify-between text-[var(--danger)]"><span className="overline">TDS ({recvPreview.pct}%)</span><span className="num">−{inr2(recvPreview.tds)}</span></div>
                    <div className="flex justify-between border-t border-[var(--border)] pt-1 mt-1"><span className="overline">Net credited to bank</span><span className="num font-bold value-positive">{inr2(recvPreview.net)}</span></div>
                    <div className="overline text-[10px] text-[var(--muted)] pt-1">Income txn records gross. Separate expense txn (source=tds_deduction) records the TDS.</div>
                  </>
                ) : (
                  <div className="overline text-xs">No TDS — income txn at gross {inr(recvPreview.gross)} will be created.</div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecvOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={confirmReceive} className="brand-btn rounded-none gap-1" data-testid="recv-confirm">
              <Check size={14} /> Confirm Receive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

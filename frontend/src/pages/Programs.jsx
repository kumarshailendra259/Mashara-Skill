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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, Clock } from "lucide-react";
import PrintButton from "@/components/PrintButton";

const MILESTONES = ["1st", "2nd", "3rd"];

function MilestoneCard({ milestone, payment, canEdit, canReceive, onAdd, onReceive, onEdit, onDelete }) {
  const received = payment?.status === "received";
  const empty = !payment;
  return (
    <div className={`swiss-card p-4 ${received ? "border-[var(--success)]" : empty ? "border-dashed" : ""}`} data-testid={`milestone-${milestone}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="overline text-xs">Milestone</div>
          <div className="font-heading font-black text-xl tracking-tight">{milestone}</div>
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
            <div className="flex justify-between"><span className="overline">Amount</span><span className="num font-bold">{inr(payment.amount)}</span></div>
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
  const [activeProjectId, setActiveProjectId] = useState("");
  const [selectedCenterId, setSelectedCenterId] = useState("__all");

  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [payments, setPayments] = useState([]);

  // Batch dialog
  const [batchOpen, setBatchOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const emptyBatch = { project_id: "", center_id: "", name: "", start_date: "", end_date: "", total_beneficiaries: 0, description: "" };
  const [bForm, setBForm] = useState(emptyBatch);

  // Payment dialog
  const [payOpen, setPayOpen] = useState(false);
  const [editingPay, setEditingPay] = useState(null);
  const emptyPay = { batch_id: "", milestone: "1st", amount: "", expected_date: "", description: "" };
  const [pForm, setPForm] = useState(emptyPay);

  useEffect(() => {
    Promise.all([api.get("/entities/project"), api.get("/entities/center")])
      .then(([p, c]) => {
        setProjects(p.data);
        setCenters(c.data);
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
      name: b.name, start_date: b.start_date || "", end_date: b.end_date || "",
      total_beneficiaries: b.total_beneficiaries || 0, description: b.description || "",
    });
    setBatchOpen(true);
  };
  const saveBatch = async () => {
    if (!bForm.name.trim()) { toast.error("Batch name required"); return; }
    if (!bForm.project_id) { toast.error("Project required"); return; }
    try {
      const payload = { ...bForm, total_beneficiaries: +bForm.total_beneficiaries || 0, center_id: bForm.center_id || null };
      if (editingBatch) await api.put(`/batches/${editingBatch.id}`, payload);
      else {
        const r = await api.post("/batches", payload);
        setSelectedBatchId(r.data.id);
      }
      setBatchOpen(false);
      // refresh list
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
    setPForm({ batch_id: selectedBatchId, milestone, amount: "", expected_date: "", description: "" });
    setPayOpen(true);
  };
  const openEditPayment = (p) => {
    setEditingPay(p);
    setPForm({ batch_id: p.batch_id, milestone: p.milestone, amount: p.amount, expected_date: p.expected_date || "", description: p.description || "" });
    setPayOpen(true);
  };
  const savePayment = async () => {
    if (!(parseFloat(pForm.amount) > 0)) { toast.error("Amount must be > 0"); return; }
    try {
      const payload = { ...pForm, amount: parseFloat(pForm.amount) };
      if (editingPay) await api.put(`/batch-payments/${editingPay.id}`, payload);
      else await api.post("/batch-payments", payload);
      setPayOpen(false);
      const r = await api.get("/batch-payments", { params: { batch_id: selectedBatchId } });
      setPayments(r.data);
      toast.success("Saved");
    } catch (e) { toast.error(formatError(e)); }
  };
  const receivePayment = async (p) => {
    if (!window.confirm(`Mark ${p.milestone} milestone as received? This will create an approved income transaction of ${inr(p.amount)}.`)) return;
    try {
      await api.patch(`/batch-payments/${p.id}/receive`);
      const r = await api.get("/batch-payments", { params: { batch_id: selectedBatchId } });
      setPayments(r.data);
      toast.success("Received & income recorded");
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
          {/* Project tabs (JSDMS, BOCWW, PRI, ...) */}
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
              {/* Center + Batch selector */}
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
                  {/* Batch summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="swiss-card p-3"><div className="overline">Batch</div><div className="font-heading font-bold text-lg truncate">{activeBatch.name}</div></div>
                    <div className="swiss-card p-3"><div className="overline">Center</div><div className="font-heading font-bold text-lg truncate">{activeBatch.center_id ? centerName(activeBatch.center_id) : "—"}</div></div>
                    <div className="swiss-card p-3"><div className="overline">Total Configured</div><div className="num font-bold text-xl">{inr(totalConfigured)}</div></div>
                    <div className="swiss-card p-3"><div className="overline">Total Received</div><div className="num font-bold text-xl value-positive">{inr(totalReceived)}</div></div>
                  </div>

                  {/* Milestone cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="milestones-grid">
                    {MILESTONES.map((m) => (
                      <MilestoneCard
                        key={m}
                        milestone={m}
                        payment={paymentByMilestone[m]}
                        canEdit={canEditPayments}
                        canReceive={canReceive}
                        onAdd={() => openNewPayment(m)}
                        onReceive={receivePayment}
                        onEdit={openEditPayment}
                        onDelete={deletePayment}
                      />
                    ))}
                  </div>

                  {/* Detailed table for print + audit */}
                  <div className="swiss-card overflow-x-auto" data-testid="payments-table">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
                        <th className="text-left p-3">Milestone</th>
                        <th className="text-right p-3">Amount</th>
                        <th className="text-left p-3">Expected Date</th>
                        <th className="text-left p-3">Status</th>
                        <th className="text-left p-3">Received Date</th>
                        <th className="text-left p-3">Description</th>
                      </tr></thead>
                      <tbody>
                        {MILESTONES.map((m) => {
                          const p = paymentByMilestone[m];
                          return (
                            <tr key={m} className="border-b border-[var(--border)]">
                              <td className="p-3 font-medium">{m}</td>
                              <td className="p-3 num">{p ? inr(p.amount) : <span className="text-[var(--muted)]">—</span>}</td>
                              <td className="p-3 num">{p?.expected_date || "—"}</td>
                              <td className="p-3 overline text-xs">{p?.status || "—"}</td>
                              <td className="p-3 num">{p?.received_date || "—"}</td>
                              <td className="p-3 text-[var(--muted)] max-w-xs truncate">{p?.description || "—"}</td>
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
        <DialogContent className="rounded-none">
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
            <div className="col-span-2">
              <Label>Total Beneficiaries</Label>
              <Input type="number" value={bForm.total_beneficiaries} onChange={(e) => setBForm({ ...bForm, total_beneficiaries: e.target.value })} className="rounded-none num" />
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Milestone</Label>
              <Select value={pForm.milestone} onValueChange={(v) => setPForm({ ...pForm, milestone: v })} disabled={!!editingPay}>
                <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                <SelectContent>{MILESTONES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount</Label>
              <Input type="number" step="0.01" value={pForm.amount} onChange={(e) => setPForm({ ...pForm, amount: e.target.value })} className="rounded-none num" data-testid="pay-amount" />
            </div>
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
    </div>
  );
}

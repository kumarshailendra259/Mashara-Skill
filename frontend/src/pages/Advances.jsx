import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Wallet, Receipt, Search, X as XIcon } from "lucide-react";
import ApprovalTimelineModal from "@/components/ApprovalTimelineModal";
import AttachmentUploader from "@/components/AttachmentUploader";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const STATUS_BADGE = {
  draft:      "bg-gray-100 text-gray-700",
  pending:    "bg-amber-100 text-amber-700",
  in_progress:"bg-amber-100 text-amber-700",
  approved:   "bg-blue-100 text-blue-700",
  released:   "bg-emerald-100 text-emerald-700",
  adjusting:  "bg-indigo-100 text-indigo-700",
  settled:    "bg-green-100 text-green-700",
  rejected:   "bg-red-100 text-red-700",
  sent_back:  "bg-orange-100 text-orange-700",
  cancelled:  "bg-gray-200 text-gray-500 line-through",
};

export default function Advances() {
  const { user } = useAuth();
  const canFinance = ["admin", "accountant"].includes(user?.role);
  const isStaffOnly = !["admin", "hr", "accountant", "senior_manager", "manager", "center_manager"].includes(user?.role);

  const [tab, setTab] = useState(isStaffOnly ? "my" : "all");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const PAGE = 20;

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ purpose: "", category: "", amount: "", required_till: "", description: "", center_id: "", project_id: "", attachments: [] });
  const [centers, setCenters] = useState([]);
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(false);

  const [detailRow, setDetailRow] = useState(null);
  const [trackId, setTrackId] = useState(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [payers, setPayers] = useState([]);
  const [releaseForm, setReleaseForm] = useState({
    payment_mode: "bank", payment_date: new Date().toISOString().slice(0, 10),
    transaction_ref: "", paid_amount: "", paid_by_user_id: "", remarks: "", attachments: [],
  });

  const load = useCallback(async () => {
    try {
      if (tab === "my") {
        const { data } = await api.get("/advance-requests/my");
        setRows(data || []);
        setTotal((data || []).length);
      } else {
        const params = { skip: page * PAGE, limit: PAGE };
        if (statusFilter && statusFilter !== "all") params.status = statusFilter;
        if (q) params.q = q;
        const res = await api.get("/advance-requests", { params });
        setRows(res.data || []);
        const t = res.headers?.["x-total-count"];
        if (t != null) setTotal(Number(t));
      }
    } catch (e) { toast.error(formatError(e)); }
  }, [tab, page, statusFilter, q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/entities/center").then((r) => setCenters(r.data || [])).catch(() => {});
    api.get("/entities/project").then((r) => setProjects(r.data || [])).catch(() => {});
    api.get("/users/payers").then((r) => setPayers(r.data || [])).catch(() => {});
  }, []);

  const create = async () => {
    if (!form.purpose.trim() || !Number(form.amount)) {
      toast.error("Purpose and Amount are required"); return;
    }
    setBusy(true);
    try {
      const payload = { ...form, amount: Number(form.amount) };
      if (!payload.center_id) delete payload.center_id;
      if (!payload.project_id) delete payload.project_id;
      await api.post("/advance-requests", payload);
      toast.success("Advance request submitted for approval");
      setCreateOpen(false);
      setForm({ purpose: "", category: "", amount: "", required_till: "", description: "", center_id: "", project_id: "", attachments: [] });
      await load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const openRelease = (row) => {
    setDetailRow(row);
    setReleaseForm({
      payment_mode: "bank", payment_date: new Date().toISOString().slice(0, 10),
      transaction_ref: "", paid_amount: String(row.amount || ""),
      paid_by_user_id: user?.id || "", remarks: "", attachments: [],
    });
    setReleaseOpen(true);
  };

  const submitRelease = async () => {
    if (!detailRow) return;
    const paid = Number(releaseForm.paid_amount) || detailRow.amount;
    if (!paid || paid <= 0) { toast.error("Paid amount is required"); return; }
    if (!releaseForm.paid_by_user_id) { toast.error("Please select who is paying"); return; }
    try {
      await api.post(`/advance-requests/${detailRow.id}/release`, {
        ...releaseForm,
        paid_amount: paid,
      });
      toast.success("Advance released — transaction created");
      setReleaseOpen(false); setDetailRow(null);
      await load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const cancel = async (row) => {
    if (!window.confirm(`Cancel advance ${row.advance_no}? This cannot be undone.`)) return;
    try {
      await api.delete(`/advance-requests/${row.id}`);
      toast.success("Advance cancelled");
      await load();
    } catch (e) { toast.error(formatError(e)); }
  };

  // Employee-wise totals (roll-up card at the top when viewing "All")
  const totals = useMemo(() => {
    const s = rows.reduce((a, r) => {
      a.count += 1;
      if (r.status === "released" || r.status === "adjusting") a.released += r.paid_amount || r.amount || 0;
      if (r.status === "pending" || r.status === "in_progress") a.pending += r.amount || 0;
      if (r.status === "approved") a.approved += r.amount || 0;
      if (r.status === "settled") a.settled += r.paid_amount || 0;
      return a;
    }, { count: 0, released: 0, pending: 0, approved: 0, settled: 0 });
    return s;
  }, [rows]);

  return (
    <div className="space-y-4" data-testid="advances-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="overline">Finance</div>
          <h1 className="font-heading font-black tracking-tight text-2xl md:text-3xl">Advances</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Raise, approve, release and track employee advances.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="brand-btn rounded-none" data-testid="advance-new-btn">
          <Plus size={14} className="mr-1" /> Raise Advance
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Rows" value={totals.count} accent="text-[var(--brand)]" />
        <StatCard label="Awaiting Approval" value={inr(totals.pending)} accent="text-amber-700" />
        <StatCard label="Approved (not released)" value={inr(totals.approved)} accent="text-blue-700" />
        <StatCard label="Released (open)" value={inr(totals.released)} accent="text-emerald-700" />
        <StatCard label="Settled" value={inr(totals.settled)} accent="text-green-700" />
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(0); }}>
        <TabsList className="rounded-none">
          <TabsTrigger value="my" data-testid="tab-my-advances"><Receipt size={14} className="mr-1" /> My Advances</TabsTrigger>
          {!isStaffOnly && <TabsTrigger value="all" data-testid="tab-all-advances"><Wallet size={14} className="mr-1" /> All Advances</TabsTrigger>}
        </TabsList>

        <TabsContent value="my" className="mt-4">
          <AdvanceTable
            rows={rows}
            canFinance={false}
            onTrack={(r) => setTrackId(r.id)}
            onCancel={cancel}
            onRelease={null}
          />
        </TabsContent>
        <TabsContent value="all" className="mt-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
                <Input
                  type="search" placeholder="Search advance no / employee / voucher / purpose"
                  value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
                  className="rounded-none pl-8 w-80"
                  data-testid="advance-search"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                <SelectTrigger className="rounded-none w-44" data-testid="advance-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending Approval</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                  <SelectItem value="settled">Settled</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="sent_back">Sent Back</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-[var(--muted)]">Showing {rows.length} of {total}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-none" data-testid="advance-prev">Prev</Button>
              <span className="text-xs">Page {page + 1} / {Math.max(1, Math.ceil(total / PAGE))}</span>
              <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE >= total} className="rounded-none" data-testid="advance-next">Next</Button>
            </div>
          </div>
          <AdvanceTable
            rows={rows}
            canFinance={canFinance}
            onTrack={(r) => setTrackId(r.id)}
            onCancel={cancel}
            onRelease={canFinance ? openRelease : null}
          />
        </TabsContent>
      </Tabs>

      {/* Create advance dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-none max-w-lg" data-testid="advance-create-modal">
          <DialogHeader>
            <DialogTitle>Raise Advance Request</DialogTitle>
            <DialogDescription>Approval workflow will route this to your reporting chain automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[65vh] overflow-y-auto">
            <div>
              <Label className="overline">Purpose <span className="text-red-600">*</span></Label>
              <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Site material purchase" className="rounded-none" data-testid="adv-purpose" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="overline">Amount ₹ <span className="text-red-600">*</span></Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-none num" data-testid="adv-amount" />
              </div>
              <div>
                <Label className="overline">Required Till</Label>
                <Input type="date" value={form.required_till} onChange={(e) => setForm({ ...form, required_till: e.target.value })} className="rounded-none" data-testid="adv-required-till" />
              </div>
            </div>
            <div>
              <Label className="overline">Category</Label>
              <Select value={form.category || "__none"} onValueChange={(v) => setForm({ ...form, category: v === "__none" ? "" : v })}>
                <SelectTrigger className="rounded-none" data-testid="adv-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Select —</SelectItem>
                  <SelectItem value="material">Material Purchase</SelectItem>
                  <SelectItem value="travel">Travel / Transport</SelectItem>
                  <SelectItem value="office">Office Expenses</SelectItem>
                  <SelectItem value="repair">Repair / Maintenance</SelectItem>
                  <SelectItem value="event">Event / Program</SelectItem>
                  <SelectItem value="misc">Miscellaneous</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="overline">Center</Label>
                <Select value={form.center_id || "__none"} onValueChange={(v) => setForm({ ...form, center_id: v === "__none" ? "" : v })}>
                  <SelectTrigger className="rounded-none" data-testid="adv-center"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— None —</SelectItem>
                    {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="overline">Project</Label>
                <Select value={form.project_id || "__none"} onValueChange={(v) => setForm({ ...form, project_id: v === "__none" ? "" : v })}>
                  <SelectTrigger className="rounded-none" data-testid="adv-project"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— None —</SelectItem>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="overline">Description / Justification</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="rounded-none" data-testid="adv-description" />
            </div>
            <div>
              <Label className="overline">Attachments (estimate / quotation)</Label>
              <AttachmentUploader
                attachments={form.attachments}
                onChange={(atts) => setForm({ ...form, attachments: atts })}
                testId="adv-attach"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={create} disabled={busy} className="brand-btn rounded-none" data-testid="adv-submit-btn">
              {busy ? "Submitting…" : "Submit for Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release advance dialog */}
      <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
        <DialogContent className="rounded-none max-w-md" data-testid="advance-release-modal">
          <DialogHeader>
            <DialogTitle>Release Advance</DialogTitle>
            <DialogDescription>
              {detailRow && (
                <>Voucher will be generated for <b>{detailRow.employee_name}</b> · <b>{detailRow.advance_no}</b> · Approved amount <b>{inr(detailRow.amount)}</b></>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="overline">Payment Mode</Label>
                <Select value={releaseForm.payment_mode} onValueChange={(v) => setReleaseForm({ ...releaseForm, payment_mode: v })}>
                  <SelectTrigger className="rounded-none" data-testid="rel-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="overline">Payment Date</Label>
                <Input type="date" value={releaseForm.payment_date} onChange={(e) => setReleaseForm({ ...releaseForm, payment_date: e.target.value })} className="rounded-none" data-testid="rel-date" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="overline">Paid Amount ₹ <span className="text-red-600">*</span></Label>
                <Input type="number" value={releaseForm.paid_amount} onChange={(e) => setReleaseForm({ ...releaseForm, paid_amount: e.target.value })} className="rounded-none num" data-testid="rel-amount" />
              </div>
              <div>
                <Label className="overline">Txn / UTR Ref</Label>
                <Input value={releaseForm.transaction_ref} onChange={(e) => setReleaseForm({ ...releaseForm, transaction_ref: e.target.value })} className="rounded-none" data-testid="rel-txn" />
              </div>
            </div>
            <div>
              <Label className="overline">Paid By <span className="text-red-600">*</span></Label>
              <Select value={releaseForm.paid_by_user_id || "__none"} onValueChange={(v) => setReleaseForm({ ...releaseForm, paid_by_user_id: v === "__none" ? "" : v })}>
                <SelectTrigger className="rounded-none" data-testid="rel-paid-by"><SelectValue placeholder="Select payer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Select —</SelectItem>
                  {payers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name || p.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="overline">Remarks</Label>
              <Textarea value={releaseForm.remarks} onChange={(e) => setReleaseForm({ ...releaseForm, remarks: e.target.value })} rows={2} className="rounded-none" />
            </div>
            <div>
              <Label className="overline">Payment Proof (bank slip / receipt)</Label>
              <AttachmentUploader
                attachments={releaseForm.attachments}
                onChange={(atts) => setReleaseForm({ ...releaseForm, attachments: atts })}
                testId="rel-attach"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={submitRelease} className="brand-btn rounded-none" data-testid="rel-submit-btn">Release Advance</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApprovalTimelineModal type="advance_request" requestId={trackId} onClose={() => setTrackId(null)} />
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="swiss-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">{label}</div>
      <div className={`font-heading font-black text-xl md:text-2xl mt-1 ${accent || ""}`}>{value}</div>
    </div>
  );
}

function AdvanceTable({ rows, canFinance, onTrack, onCancel, onRelease }) {
  if (rows.length === 0) {
    return (
      <div className="swiss-card p-8 text-center text-sm text-[var(--muted)]">
        No advance requests yet.
      </div>
    );
  }
  return (
    <div className="swiss-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Advance #</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead>Voucher</TableHead>
            <TableHead>Required Till</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid={`adv-row-${r.id}`}>
              <TableCell className="font-medium whitespace-nowrap">{r.advance_no}</TableCell>
              <TableCell>
                <div className="font-medium truncate max-w-[140px]" title={r.employee_name}>{r.employee_name || "—"}</div>
                <div className="text-[10px] text-[var(--muted)]">{r.employee_code || ""}</div>
              </TableCell>
              <TableCell><div className="max-w-[220px] truncate" title={r.purpose}>{r.purpose}</div></TableCell>
              <TableCell><span className="text-[11px] uppercase text-[var(--muted)]">{r.category || "—"}</span></TableCell>
              <TableCell className="text-right num font-medium">{inr(r.amount)}</TableCell>
              <TableCell className="text-right num text-green-700">{r.paid_amount ? inr(r.paid_amount) : "—"}</TableCell>
              <TableCell className="text-[11px]">{r.voucher_no || "—"}</TableCell>
              <TableCell className="text-[11px]">{r.required_till || "—"}</TableCell>
              <TableCell>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 ${STATUS_BADGE[r.status] || "bg-gray-100"}`}>
                  {(r.status || "").replace("_", " ")}
                </span>
                {r.current_level > 0 && (r.chain_snapshot?.length > 0) && (
                  <div className="text-[10px] text-amber-700 mt-1" data-testid={`adv-step-${r.id}`}>
                    Step {r.current_level}/{r.chain_snapshot.length} · {r.current_step_label || ""}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <div className="flex gap-1 justify-end">
                  <button className="text-[11px] text-[var(--brand)] hover:underline" onClick={() => onTrack(r)} data-testid={`adv-track-${r.id}`}>Track</button>
                  {onRelease && r.status === "approved" && (
                    <Button size="sm" onClick={() => onRelease(r)} className="brand-btn rounded-none h-7 px-2 text-[11px]" data-testid={`adv-release-${r.id}`}>Release</Button>
                  )}
                  {["pending", "in_progress", "sent_back", "approved"].includes(r.status) && (
                    <button className="text-[11px] text-red-600 hover:underline" onClick={() => onCancel(r)} data-testid={`adv-cancel-${r.id}`} title="Cancel"><XIcon size={12} /></button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

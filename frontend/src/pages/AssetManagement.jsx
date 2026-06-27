import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Box, Plus, ArrowLeftRight, ListChecks, Trash2, RefreshCw, ShieldCheck,
} from "lucide-react";

// Phase-3 RBAC: Asset Purchase Workflow + Asset Registry + Asset Transfer.
// Tabs:
//   1. Purchase Requests — Center Manager raises; flows through 4-level chain.
//   2. Asset Registry    — final-approved assets land here (also admin-direct entry).
//   3. Transfers         — move asset between centers (admin/sr-mgr decides).

const STATUS_BADGE = {
  pending:     "bg-amber-50 text-amber-700 border-amber-200",
  approved:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected:    "bg-rose-50 text-rose-700 border-rose-200",
  active:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  transferred: "bg-blue-50 text-[var(--brand)] border-blue-200",
  disposed:    "bg-gray-100 text-gray-600 border-gray-200",
  maintenance: "bg-amber-50 text-amber-700 border-amber-200",
};

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("en-IN") : "—");

export default function AssetManagement() {
  const { user } = useAuth();
  const [centers, setCenters] = useState([]);
  const [requests, setRequests] = useState([]);
  const [assets, setAssets] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [tab, setTab] = useState("requests");
  const [loading, setLoading] = useState(true);

  const [reqDialog, setReqDialog] = useState(false);
  const [reqForm, setReqForm] = useState(defaultReqForm());
  const [transferDialog, setTransferDialog] = useState(null); // asset
  const [transferForm, setTransferForm] = useState({ to_center_id: "", reason: "" });

  const canRaise = ["admin", "center_manager", "senior_manager"].includes(user?.role);
  const canDecideTransfer = ["admin", "senior_manager"].includes(user?.role);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [c, r, a, t] = await Promise.all([
        api.get("/entities/center"),
        api.get("/asset-purchase-requests"),
        api.get("/assets"),
        api.get("/asset-transfers"),
      ]);
      setCenters(c.data || []);
      setRequests(r.data || []);
      setAssets(a.data || []);
      setTransfers(t.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadAll(); }, []);

  const centerName = (id) => centers.find((c) => c.id === id)?.name || (id ? id.slice(0, 8) : "—");

  // --- Counts ---
  const counts = useMemo(() => ({
    requests:  requests.length,
    pendingR:  requests.filter((r) => r.status === "pending").length,
    assets:    assets.length,
    transfers: transfers.length,
    pendingT:  transfers.filter((t) => t.status === "pending").length,
    totalCost: assets.reduce((s, a) => s + (Number(a.purchase_amount) || 0), 0),
  }), [requests, assets, transfers]);

  // --- Submit purchase request ---
  const submitRequest = async () => {
    if (!reqForm.name?.trim() || (reqForm.est_amount ?? 0) <= 0) {
      toast.error("Asset name & estimated amount are mandatory");
      return;
    }
    try {
      await api.post("/asset-purchase-requests", {
        ...reqForm,
        est_amount: Number(reqForm.est_amount || 0),
        depreciation_rate_pct: Number(reqForm.depreciation_rate_pct || 0),
        useful_life_years: reqForm.useful_life_years ? Number(reqForm.useful_life_years) : null,
      });
      toast.success("Purchase request raised — awaiting approval");
      setReqDialog(false);
      setReqForm(defaultReqForm());
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  const deleteRequest = async (id) => {
    if (!window.confirm("Delete this pending request?")) return;
    try {
      await api.delete(`/asset-purchase-requests/${id}`);
      toast.success("Deleted");
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  // --- Transfer asset ---
  const submitTransfer = async () => {
    if (!transferForm.to_center_id || !transferForm.reason || transferForm.reason.length < 3) {
      toast.error("Destination center & reason (min 3 chars) are mandatory");
      return;
    }
    try {
      await api.post("/asset-transfers", {
        asset_id: transferDialog.id,
        to_center_id: transferForm.to_center_id,
        reason: transferForm.reason,
      });
      toast.success("Transfer request raised");
      setTransferDialog(null);
      setTransferForm({ to_center_id: "", reason: "" });
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  const decideTransfer = async (tid, action) => {
    const remarks = window.prompt(`Remarks for ${action}:`) || "";
    if (!remarks.trim() || remarks.trim().length < 3) {
      toast.error("Remarks (min 3 chars) required");
      return;
    }
    try {
      await api.post(`/asset-transfers/${tid}/decide`, { action, remarks });
      toast.success(`Transfer ${action}d`);
      loadAll();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="asset-management-page">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="overline">Phase-3 RBAC</div>
          <h1 className="font-heading font-black tracking-tight text-3xl flex items-center gap-2">
            <Box size={28} className="text-[var(--brand)]" />
            Asset Management
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            Capex requests → approval chain → asset registry → inter-center transfers.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadAll} className="rounded-none gap-1" data-testid="btn-refresh-assets">
            <RefreshCw size={14} /> Refresh
          </Button>
          {canRaise && (
            <Button onClick={() => setReqDialog(true)} className="brand-btn rounded-none gap-1" data-testid="btn-new-asset-request">
              <Plus size={16} /> New Purchase Request
            </Button>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Requests" value={counts.requests} />
        <Kpi label="Pending" value={counts.pendingR} accent="text-amber-700" />
        <Kpi label="Assets" value={counts.assets} />
        <Kpi label="Total Capex" value={inr(counts.totalCost)} accent="value-positive" />
        <Kpi label="Pending Transfers" value={counts.pendingT} accent="text-amber-700" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-none">
          <TabsTrigger value="requests" data-testid="tab-asset-requests" className="rounded-none gap-1">
            <ListChecks size={14} /> Purchase Requests
            {counts.pendingR > 0 && <Badge variant="outline" className="ml-1 num">{counts.pendingR}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="assets" data-testid="tab-assets" className="rounded-none gap-1">
            <ShieldCheck size={14} /> Asset Registry
          </TabsTrigger>
          <TabsTrigger value="transfers" data-testid="tab-transfers" className="rounded-none gap-1">
            <ArrowLeftRight size={14} /> Transfers
            {counts.pendingT > 0 && <Badge variant="outline" className="ml-1 num">{counts.pendingT}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ---- Purchase Requests ---- */}
        <TabsContent value="requests" className="pt-3">
          {loading ? <Loading /> : requests.length === 0 ? (
            <Empty icon={ListChecks} title="No purchase requests yet" subtitle="Raise the first capex request to start the approval chain." />
          ) : (
            <div className="overflow-x-auto swiss-card">
              <table className="min-w-full text-sm" data-testid="asset-requests-table">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Asset</Th><Th>Center</Th><Th>Amount</Th><Th>Required</Th>
                    <Th>Level</Th><Th>Status</Th><Th>By</Th><Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--border)]" data-testid={`req-row-${r.id}`}>
                      <Td>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-[var(--muted)]">{r.category || "—"}{r.serial_no ? ` · SN ${r.serial_no}` : ""}</div>
                      </Td>
                      <Td>{centerName(r.center_id)}</Td>
                      <Td className="num font-semibold">{inr(r.est_amount)}</Td>
                      <Td className="num text-xs">{fmtDate(r.required_date)}</Td>
                      <Td>{r.current_level > 0
                        ? `L${r.current_level}${r.chain_snapshot?.length ? `/${r.chain_snapshot.length}` : ""}`
                        : "—"}</Td>
                      <Td><StatusPill s={r.status} /></Td>
                      <Td className="text-xs">{r.created_by_name}<div className="text-[var(--muted)]">{fmtDate(r.created_at)}</div></Td>
                      <Td>
                        {r.status === "pending" && (user?.id === r.created_by || user?.role === "admin") && (
                          <Button variant="outline" size="sm" className="rounded-none h-7" onClick={() => deleteRequest(r.id)} data-testid={`btn-del-req-${r.id}`}>
                            <Trash2 size={12} />
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ---- Asset Registry ---- */}
        <TabsContent value="assets" className="pt-3">
          {loading ? <Loading /> : assets.length === 0 ? (
            <Empty icon={ShieldCheck} title="No assets in registry" subtitle="Approved purchase requests show up here." />
          ) : (
            <div className="overflow-x-auto swiss-card">
              <table className="min-w-full text-sm" data-testid="assets-table">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Asset</Th><Th>Center</Th><Th>Cost</Th><Th>Purchase Date</Th>
                    <Th>Dep%</Th><Th>Status</Th><Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id} className="border-t border-[var(--border)]" data-testid={`asset-row-${a.id}`}>
                      <Td>
                        <div className="font-medium">{a.name}</div>
                        <div className="text-xs text-[var(--muted)]">
                          {a.category || "—"}{a.serial_no ? ` · SN ${a.serial_no}` : ""}{a.vendor ? ` · ${a.vendor}` : ""}
                        </div>
                      </Td>
                      <Td>{centerName(a.center_id)}</Td>
                      <Td className="num font-semibold">{inr(a.purchase_amount)}</Td>
                      <Td className="num text-xs">{fmtDate(a.purchase_date)}</Td>
                      <Td className="num">{a.depreciation_rate_pct || 0}%</Td>
                      <Td><StatusPill s={a.status} /></Td>
                      <Td>
                        {a.status === "active" && canRaise && (
                          <Button variant="outline" size="sm" className="rounded-none h-7 gap-1" onClick={() => setTransferDialog(a)} data-testid={`btn-transfer-${a.id}`}>
                            <ArrowLeftRight size={12} /> Transfer
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ---- Transfers ---- */}
        <TabsContent value="transfers" className="pt-3">
          {loading ? <Loading /> : transfers.length === 0 ? (
            <Empty icon={ArrowLeftRight} title="No transfers yet" subtitle="Move an active asset between centers." />
          ) : (
            <div className="overflow-x-auto swiss-card">
              <table className="min-w-full text-sm" data-testid="transfers-table">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Asset</Th><Th>From</Th><Th>To</Th><Th>Reason</Th>
                    <Th>Status</Th><Th>By</Th><Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id} className="border-t border-[var(--border)]" data-testid={`transfer-row-${t.id}`}>
                      <Td className="font-medium">{t.asset_name}</Td>
                      <Td>{centerName(t.from_center_id)}</Td>
                      <Td>{centerName(t.to_center_id)}</Td>
                      <Td className="text-xs max-w-[250px] truncate">{t.reason}</Td>
                      <Td><StatusPill s={t.status} /></Td>
                      <Td className="text-xs">{t.created_by_name}<div className="text-[var(--muted)]">{fmtDate(t.created_at)}</div></Td>
                      <Td>
                        {t.status === "pending" && canDecideTransfer && (
                          <div className="flex gap-1">
                            <Button size="sm" className="brand-btn rounded-none h-7" onClick={() => decideTransfer(t.id, "approve")} data-testid={`btn-approve-${t.id}`}>Approve</Button>
                            <Button variant="outline" size="sm" className="rounded-none h-7 hover:text-[var(--danger)] hover:border-[var(--danger)]" onClick={() => decideTransfer(t.id, "reject")} data-testid={`btn-reject-${t.id}`}>Reject</Button>
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ---- New Purchase Request Dialog ---- */}
      <Dialog open={reqDialog} onOpenChange={setReqDialog}>
        <DialogContent className="rounded-none max-w-2xl" data-testid="asset-request-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">New Asset Purchase Request</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Asset Name *">
              <Input value={reqForm.name} onChange={(e) => setReqForm({ ...reqForm, name: e.target.value })} className="rounded-none" data-testid="inp-asset-name" />
            </Field>
            <Field label="Category">
              <Input value={reqForm.category} onChange={(e) => setReqForm({ ...reqForm, category: e.target.value })} placeholder="Furniture / IT / Vehicle…" className="rounded-none" />
            </Field>
            <Field label="Center">
              <Select value={reqForm.center_id} onValueChange={(v) => setReqForm({ ...reqForm, center_id: v })}>
                <SelectTrigger className="rounded-none" data-testid="sel-center"><SelectValue placeholder="Select center" /></SelectTrigger>
                <SelectContent className="rounded-none">
                  {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Estimated Amount (₹) *">
              <Input type="number" value={reqForm.est_amount} onChange={(e) => setReqForm({ ...reqForm, est_amount: e.target.value })} className="rounded-none num" data-testid="inp-est-amount" />
            </Field>
            <Field label="Vendor">
              <Input value={reqForm.vendor} onChange={(e) => setReqForm({ ...reqForm, vendor: e.target.value })} className="rounded-none" />
            </Field>
            <Field label="Serial / Model No">
              <Input value={reqForm.serial_no} onChange={(e) => setReqForm({ ...reqForm, serial_no: e.target.value })} className="rounded-none" />
            </Field>
            <Field label="Required By">
              <Input type="date" value={reqForm.required_date} onChange={(e) => setReqForm({ ...reqForm, required_date: e.target.value })} className="rounded-none" />
            </Field>
            <Field label="Depreciation Rate (%)">
              <Input type="number" step="0.01" value={reqForm.depreciation_rate_pct} onChange={(e) => setReqForm({ ...reqForm, depreciation_rate_pct: e.target.value })} className="rounded-none num" />
            </Field>
            <Field label="Useful Life (years)">
              <Input type="number" step="0.5" value={reqForm.useful_life_years} onChange={(e) => setReqForm({ ...reqForm, useful_life_years: e.target.value })} className="rounded-none num" />
            </Field>
            <div className="col-span-2">
              <Field label="Description / Justification">
                <Textarea rows={3} value={reqForm.description} onChange={(e) => setReqForm({ ...reqForm, description: e.target.value })} className="rounded-none" />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqDialog(false)} className="rounded-none">Cancel</Button>
            <Button onClick={submitRequest} className="brand-btn rounded-none" data-testid="btn-submit-request">Submit for Approval</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Transfer Dialog ---- */}
      <Dialog open={!!transferDialog} onOpenChange={(v) => !v && setTransferDialog(null)}>
        <DialogContent className="rounded-none" data-testid="transfer-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Transfer Asset</DialogTitle>
          </DialogHeader>
          {transferDialog && (
            <div className="space-y-3">
              <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-3 text-sm">
                <div className="font-medium">{transferDialog.name}</div>
                <div className="text-xs num mt-1">
                  Current center: <span className="font-medium">{centerName(transferDialog.center_id)}</span>
                </div>
              </div>
              <Field label="Destination Center *">
                <Select value={transferForm.to_center_id} onValueChange={(v) => setTransferForm({ ...transferForm, to_center_id: v })}>
                  <SelectTrigger className="rounded-none" data-testid="sel-to-center"><SelectValue placeholder="Select destination center" /></SelectTrigger>
                  <SelectContent className="rounded-none">
                    {centers.filter((c) => c.id !== transferDialog.center_id).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Reason *">
                <Textarea rows={3} value={transferForm.reason} onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })} className="rounded-none" data-testid="inp-transfer-reason" />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(null)} className="rounded-none">Cancel</Button>
            <Button onClick={submitTransfer} className="brand-btn rounded-none" data-testid="btn-submit-transfer">Raise Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function defaultReqForm() {
  return {
    name: "", category: "", description: "", serial_no: "", vendor: "",
    est_amount: "", required_date: "", depreciation_rate_pct: "",
    useful_life_years: "", center_id: "",
  };
}

const Kpi = ({ label, value, accent }) => (
  <div className="swiss-card p-3">
    <div className="overline">{label}</div>
    <div className={`num font-bold text-xl mt-1 ${accent || ""}`}>{value}</div>
  </div>
);

const StatusPill = ({ s }) => (
  <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border ${STATUS_BADGE[s] || "bg-gray-100 text-gray-700"}`}>
    {(s || "").toUpperCase()}
  </span>
);

const Field = ({ label, children }) => (
  <div>
    <Label className="overline text-xs">{label}</Label>
    <div className="mt-1">{children}</div>
  </div>
);

const Th = ({ children }) => <th className="text-left px-3 py-2 overline text-xs whitespace-nowrap">{children}</th>;
const Td = ({ children, className }) => <td className={`px-3 py-2 ${className || ""}`}>{children}</td>;

const Loading = () => <div className="swiss-card p-12 text-center overline">Loading…</div>;
const Empty = ({ icon: Icon, title, subtitle }) => (
  <div className="swiss-card p-12 text-center">
    <Icon size={48} className="text-[var(--muted)] mx-auto mb-3" />
    <div className="font-heading font-bold text-lg">{title}</div>
    <div className="overline text-sm mt-1">{subtitle}</div>
  </div>
);

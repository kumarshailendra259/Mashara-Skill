import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CreditCard, Lock, ShieldCheck, Sparkles, Clock, ChevronRight, ReceiptText, HistoryIcon } from "lucide-react";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const RZP_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector(`script[src="${RZP_CHECKOUT_SRC}"]`);
    if (existing) { existing.addEventListener("load", () => resolve(true)); return; }
    const s = document.createElement("script");
    s.src = RZP_CHECKOUT_SRC;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const inr = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format((paise || 0) / 100);
const dt = (iso) => iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_STYLE = {
  active:        { chip: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", label: "Active" },
  admin:         { chip: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",         label: "Admin Access" },
  expired:       { chip: "bg-red-50 text-red-700 ring-1 ring-red-200",             label: "Expired" },
  not_subscribed:{ chip: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",      label: "Locked" },
};

export default function SubscriptionBilling() {
  const { user, refresh } = useAuth();
  const [modules, setModules] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(null);          // module currently being purchased
  const [orderCtx, setOrderCtx] = useState(null);      // {module, duration_months}
  const [durationDialog, setDurationDialog] = useState(null); // module obj
  const [duration, setDuration] = useState(1);
  const [audit, setAudit] = useState([]);
  const [orders, setOrders] = useState([]);

  const isAdmin = user?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/subscription/me");
      setModules(r.data.modules || []);
      setCompanyId(r.data.company_id || "");
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [aud, adm] = await Promise.all([
        api.get("/subscription/admin/audit?limit=50"),
        api.get("/subscription/admin/subscriptions"),
      ]);
      setAudit(aud.data || []);
      setOrders(adm.data?.orders || []);
    } catch (e) { /* silent */ }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAdminData(); }, [loadAdminData]);

  const openDurationDialog = (m) => {
    setDuration(1);
    setDurationDialog(m);
  };

  const startCheckout = async () => {
    if (!durationDialog) return;
    const m = durationDialog;
    setDurationDialog(null);
    setBuying(m.module);
    try {
      const scriptOk = await loadRazorpayScript();
      if (!scriptOk) { toast.error("Payment SDK failed to load"); setBuying(null); return; }

      const { data: order } = await api.post("/subscription/orders", { module: m.module, duration_months: duration });
      setOrderCtx({ module: m.module, duration_months: duration });

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: "Mashara Finance ERP",
        description: `${m.name} · ${duration} month${duration > 1 ? "s" : ""}`,
        order_id: order.order_id,
        prefill: { email: user?.email, name: user?.name || user?.email },
        theme: { color: "#2563eb" },
        modal: { ondismiss: () => { setBuying(null); toast.info("Payment cancelled"); } },
        handler: async (resp) => {
          try {
            await api.post("/subscription/verify", {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            toast.success(`${m.name} activated successfully`);
            await load();
            await loadAdminData();
            await refresh();   // reload auth scope so blocked_modules updates immediately
          } catch (e) {
            toast.error(formatError(e));
          } finally {
            setBuying(null);
          }
        },
      });
      rzp.on("payment.failed", (r) => {
        toast.error(`Payment failed: ${r.error?.description || "unknown error"}`);
        setBuying(null);
      });
      rzp.open();
    } catch (e) {
      toast.error(formatError(e));
      setBuying(null);
    }
  };

  const activeModules   = modules.filter((m) => m.status === "active" || m.status === "admin");
  const lockedModules   = modules.filter((m) => m.status === "not_subscribed");
  const totalActive     = activeModules.length;
  const totalLocked     = lockedModules.length;
  const monthlyBill     = useMemo(() => modules.reduce((sum, m) => (m.status === "active" ? sum + m.price_paise : sum), 0), [modules]);

  if (loading) return (
    <div className="p-8 text-center text-slate-500" data-testid="sub-loading">Loading subscription…</div>
  );

  return (
    <div className="p-6 space-y-6" data-testid="subscription-page">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-slate-500 text-[11px] uppercase tracking-widest font-semibold">
            <CreditCard size={14} /> Subscription & Billing
          </div>
          <h1 className="text-3xl font-black tracking-tight mt-1 text-slate-900" data-testid="sub-heading">Manage Your Modules</h1>
          <div className="text-sm text-slate-500 mt-1">
            Purchase, view or renew feature access for your company.
            <span className="ml-2 text-[11px] font-mono bg-slate-100 rounded px-1.5 py-0.5">company: {companyId?.slice(0, 8)}…</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => { load(); loadAdminData(); }} data-testid="sub-refresh">
            <RefreshCw size={14} className="mr-2" /> Refresh
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryTile icon={CheckCircle2}   accent="emerald" label="Active Modules"     value={totalActive}                data-testid="kpi-active" />
        <SummaryTile icon={Lock}           accent="slate"   label="Locked Modules"     value={totalLocked}                data-testid="kpi-locked" />
        <SummaryTile icon={ReceiptText}    accent="blue"    label="Monthly Commitment" value={inr(monthlyBill)}           data-testid="kpi-billing" />
      </div>

      {/* Non-admin friendly banner */}
      {!isAdmin && lockedModules.length > 0 && (
        <Card className="p-4 border-amber-200 bg-amber-50" data-testid="sub-lock-banner">
          <div className="flex items-start gap-3">
            <ShieldCheck className="text-amber-600 mt-0.5" size={20} />
            <div className="text-sm text-amber-900">
              <div className="font-semibold">Some features are locked for your company.</div>
              <div>Ask an admin to complete a one-click purchase — access unlocks instantly on successful payment.</div>
            </div>
          </div>
        </Card>
      )}

      <Tabs defaultValue="modules" className="w-full">
        <TabsList data-testid="sub-tablist">
          <TabsTrigger value="modules" data-testid="tab-modules">Modules</TabsTrigger>
          {isAdmin && <TabsTrigger value="audit" data-testid="tab-audit"><HistoryIcon size={14} className="mr-1" /> Audit & Orders</TabsTrigger>}
        </TabsList>

        <TabsContent value="modules" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="modules-grid">
            {modules.map((m) => (
              <ModuleCard
                key={m.module}
                m={m}
                canBuy={isAdmin}
                buying={buying === m.module}
                onBuy={() => openDurationDialog(m)}
                onManage={() => openDurationDialog(m)}   // "Extend" reuses same dialog
              />
            ))}
          </div>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="audit" className="mt-4 space-y-4">
            <Card className="p-4" data-testid="audit-orders-card">
              <div className="text-sm font-bold text-slate-900 mb-3">Recent Orders</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-widest text-slate-500 border-b">
                    <tr>
                      <th className="text-left py-2">Order ID</th>
                      <th className="text-left">Module</th>
                      <th className="text-left">Amount</th>
                      <th className="text-left">Status</th>
                      <th className="text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 && (
                      <tr><td colSpan={5} className="py-6 text-center text-slate-400">No orders yet</td></tr>
                    )}
                    {orders.slice(0, 20).map((o) => (
                      <tr key={o.razorpay_order_id} className="border-b last:border-0" data-testid={`order-row-${o.razorpay_order_id}`}>
                        <td className="py-2 font-mono text-[11px]">{o.razorpay_order_id}</td>
                        <td>{o.module}</td>
                        <td>{inr(o.amount_paise)}</td>
                        <td>
                          <Badge className={o.status === "captured" ? "bg-emerald-100 text-emerald-700" : o.status === "failed" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}>
                            {o.status}
                          </Badge>
                        </td>
                        <td className="text-slate-500">{dt(o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-4" data-testid="audit-log-card">
              <div className="text-sm font-bold text-slate-900 mb-3">Audit Trail</div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {audit.length === 0 && <div className="text-sm text-slate-400 py-6 text-center">No audit events yet</div>}
                {audit.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 border-l-2 border-slate-200 pl-3 py-1">
                    <Badge variant="outline" className="text-[10px] uppercase">{a.event.replaceAll("_", " ")}</Badge>
                    <div className="text-xs text-slate-600 flex-1">
                      <span className="font-semibold text-slate-800">{a.actor_email || a.actor_id?.slice(0, 8)}</span>
                      {a.target?.module && <span className="ml-1 text-slate-500">· {a.target.module}</span>}
                      {a.target?.order_id && <span className="ml-1 text-slate-400 font-mono">· {a.target.order_id.slice(0, 14)}</span>}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">{dt(a.at)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Duration selection dialog */}
      <Dialog open={!!durationDialog} onOpenChange={(o) => !o && setDurationDialog(null)}>
        <DialogContent data-testid="duration-dialog">
          <DialogHeader>
            <DialogTitle>Purchase · {durationDialog?.name}</DialogTitle>
            <DialogDescription>
              Choose how many months of access to activate. You can extend anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Duration (months)</Label>
              <Input
                type="number" min={1} max={24}
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Math.min(24, parseInt(e.target.value || "1", 10))))}
                data-testid="duration-input"
              />
              <div className="text-xs text-slate-500 mt-1">1 – 24 months. Discounts coming soon.</div>
            </div>
            <Card className="p-3 bg-slate-50 border-slate-200 flex items-center justify-between">
              <div className="text-xs text-slate-500">Total (incl. GST)</div>
              <div className="text-2xl font-black text-slate-900 tabular-nums" data-testid="duration-total">
                {inr((durationDialog?.price_paise || 0) * duration)}
              </div>
            </Card>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDurationDialog(null)}>Cancel</Button>
            <Button onClick={startCheckout} disabled={!isAdmin} data-testid="proceed-checkout">
              {isAdmin ? <>Proceed to Payment <ChevronRight size={14} className="ml-1" /></> : "Admin only"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile({ icon: Icon, accent, label, value, ...rest }) {
  const map = {
    emerald: "bg-emerald-50 ring-emerald-100 text-emerald-700",
    slate:   "bg-slate-50 ring-slate-200 text-slate-600",
    blue:    "bg-blue-50 ring-blue-100 text-blue-700",
  };
  return (
    <Card className={`p-4 ring-1 ${map[accent]}`} {...rest}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-semibold">
        <Icon size={14} /> {label}
      </div>
      <div className="text-2xl font-black tracking-tight mt-1 tabular-nums">{value}</div>
    </Card>
  );
}

function ModuleCard({ m, canBuy, buying, onBuy, onManage }) {
  const style = STATUS_STYLE[m.status] || STATUS_STYLE.not_subscribed;
  const isActive = m.status === "active" || m.status === "admin";
  const daysLeft = m.expires_at ? Math.max(0, Math.round((new Date(m.expires_at) - new Date()) / 86400000)) : null;
  return (
    <Card
      className={`p-5 flex flex-col gap-3 border ring-1 transition-shadow hover:shadow-md ${
        isActive ? "border-emerald-100 ring-emerald-50" : "border-slate-200 ring-slate-100"
      }`}
      data-testid={`module-card-${m.module}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {isActive
            ? <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center"><Sparkles size={18} className="text-emerald-700" /></div>
            : <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><Lock size={18} className="text-slate-500" /></div>}
          <div>
            <div className="font-bold text-slate-900">{m.name}</div>
            <div className="text-[11px] uppercase tracking-widest text-slate-400 font-mono">{m.module}</div>
          </div>
        </div>
        <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md ${style.chip}`} data-testid={`module-status-${m.module}`}>
          {style.label}
        </span>
      </div>

      <div className="text-sm text-slate-600 leading-snug min-h-[40px]">{m.description}</div>

      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-black text-slate-900 tabular-nums">{inr(m.price_paise)}</span>
        <span className="text-xs text-slate-500">/ month</span>
      </div>

      {isActive && m.expires_at && (
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <Clock size={12} /> Renews on <span className="font-semibold text-slate-700 ml-1">{dt(m.expires_at)}</span>
          {daysLeft != null && <span className="ml-1">({daysLeft}d left)</span>}
        </div>
      )}

      <div className="mt-auto pt-1">
        {isActive
          ? (
            <Button variant="outline" className="w-full" onClick={onManage} disabled={!canBuy || m.status === "admin"} data-testid={`btn-extend-${m.module}`}>
              {m.status === "admin" ? "Included for Admins" : "Extend Access"}
            </Button>
          )
          : (
            <Button className="w-full" onClick={onBuy} disabled={!canBuy || buying} data-testid={`btn-buy-${m.module}`}>
              {buying ? "Opening Checkout…" : canBuy ? "Unlock Module" : "Admin only"}
            </Button>
          )}
      </div>
    </Card>
  );
}

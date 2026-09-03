import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CreditCard, Users, Sparkles, Package, ReceiptText, Clock, RefreshCw,
  Check, Plus, Minus, X, BadgePercent, HistoryIcon, Zap, Info, Trash2,
  Building2, Percent, ArrowUpRight, Wallet, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
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

const inr  = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format((paise || 0) / 100);
const inr0 = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format((paise || 0) / 100);
const dt   = (iso) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export default function SubscriptionBilling() {
  const { user, refresh } = useAuth();
  const isAdmin = user?.role === "admin";

  const [pricing, setPricing]   = useState({ license_pricing: [], features: [], addons: [], gst_rate_pct: 18 });
  const [hrmsQty, setHrmsQty]   = useState(20);
  const [roleQty, setRoleQty]   = useState(5);
  const [features, setFeatures] = useState(new Set());
  const [addons, setAddons]     = useState(new Set());
  const [duration, setDuration] = useState(1);
  const [staffBGV, setStaffBGV] = useState(1);
  const [coupon, setCoupon]     = useState("");
  const [couponApplied, setCA]  = useState("");
  const [gstInvoice, setGst]    = useState(false);
  const [gstin, setGstin]       = useState("");
  const [topupOnly, setTopup]   = useState(false);

  const [quote, setQuote]       = useState(null);
  const [licenses, setLicenses] = useState({ company: {}, licenses: [] });
  const [coupons, setCoupons]   = useState([]);
  const [orders, setOrders]     = useState([]);
  const [audit, setAudit]       = useState([]);
  const [couponDialog, setCD]   = useState(false);
  const [pricingDialog, setPD]  = useState(false);
  const [payBusy, setPayBusy]   = useState(false);

  const loadPricing = useCallback(async () => {
    try {
      const r = await api.get("/subscription/pricing");
      setPricing(r.data);
    } catch (e) { toast.error(formatError(e)); }
  }, []);

  const loadLicenses = useCallback(async () => {
    try {
      const r = await api.get("/subscription/licenses");
      setLicenses(r.data);
    } catch (e) { /* silent */ }
  }, []);

  const loadAdmin = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [c, s, a] = await Promise.all([
        api.get("/subscription/admin/coupons"),
        api.get("/subscription/admin/subscriptions"),
        api.get("/subscription/admin/audit?limit=50"),
      ]);
      setCoupons(c.data || []);
      setOrders(s.data?.orders || []);
      setAudit(a.data || []);
    } catch (e) { /* silent */ }
  }, [isAdmin]);

  useEffect(() => { loadPricing(); loadLicenses(); loadAdmin(); }, [loadPricing, loadLicenses, loadAdmin]);

  const cartKey = useMemo(() => JSON.stringify({
    hrmsQty, roleQty, features: Array.from(features), addons: Array.from(addons),
    duration, staffBGV, couponApplied,
  }), [hrmsQty, roleQty, features, addons, duration, staffBGV, couponApplied]);

  const runQuote = useMemo(() => debounce(async (payload) => {
    try {
      const r = await api.post("/subscription/quote", payload);
      setQuote(r.data);
    } catch (e) { setQuote(null); /* keep last quote when total = 0 */ }
  }, 200), []);

  useEffect(() => {
    if ((hrmsQty || 0) + (roleQty || 0) <= 0) { setQuote(null); return; }
    runQuote({
      hrms_staff_qty: hrmsQty,
      role_user_staff_qty: roleQty,
      feature_codes: Array.from(features),
      addon_codes: Array.from(addons),
      staff_count_for_bgv: Math.max(1, staffBGV),
      duration_months: duration,
      coupon_code: couponApplied || null,
    });
  }, [cartKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyCoupon = () => {
    const c = (coupon || "").trim().toUpperCase();
    if (!c) return toast.info("Enter a coupon code");
    setCA(c); toast.success("Coupon applied");
  };
  const clearCoupon = () => { setCA(""); setCoupon(""); };

  const startTopup = (role) => {
    // Buy Additional Licenses — pre-fill cart with only the missing side and clear features/addons.
    setTopup(true);
    setFeatures(new Set());
    setAddons(new Set());
    if (role === "hrms_staff") { setHrmsQty(5); setRoleQty(0); }
    else { setHrmsQty(0); setRoleQty(5); }
    setDuration(1);
    // Scroll to top so user sees the builder.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const checkout = async () => {
    if (!quote) return toast.info("Please wait for quote");
    if (quote.grand_total_paise <= 0) return toast.error("Cart total is zero");
    if (gstInvoice && !gstin.trim()) return toast.error("Enter GSTIN for tax invoice");
    setPayBusy(true);
    try {
      const scriptOk = await loadRazorpayScript();
      if (!scriptOk) { toast.error("Payment SDK failed to load"); setPayBusy(false); return; }
      const { data: order } = await api.post("/subscription/orders", {
        hrms_staff_qty: hrmsQty,
        role_user_staff_qty: roleQty,
        feature_codes: Array.from(features),
        addon_codes: Array.from(addons),
        staff_count_for_bgv: Math.max(1, staffBGV),
        duration_months: duration,
        coupon_code: couponApplied || null,
        gst_invoice: gstInvoice,
        gstin: gstin.trim() || null,
        is_topup: topupOnly,
      });
      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: "Mashara Finance ERP",
        description: `${licenses?.company?.name || "Subscription"} · ${order.company_code || ""}`,
        order_id: order.order_id,
        prefill: { email: user?.email, name: user?.name || user?.email },
        theme: { color: "#2563eb" },
        modal: { ondismiss: () => { setPayBusy(false); toast.info("Payment cancelled"); } },
        handler: async (resp) => {
          try {
            await api.post("/subscription/verify", {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            toast.success("Subscription activated!");
            setTopup(false);
            await loadLicenses();
            await loadAdmin();
            await refresh();
          } catch (e) { toast.error(formatError(e)); }
          finally { setPayBusy(false); }
        },
      });
      rzp.on("payment.failed", (r) => {
        toast.error(`Payment failed: ${r.error?.description || "unknown"}`);
        setPayBusy(false);
      });
      rzp.open();
    } catch (e) {
      toast.error(formatError(e));
      setPayBusy(false);
    }
  };

  const hrmsRow = licenses.licenses?.find((r) => r.role === "hrms_staff") || {};
  const roleRow = licenses.licenses?.find((r) => r.role === "role_user_staff") || {};
  const totalPurchased = (hrmsRow.purchased_qty || 0) + (roleRow.purchased_qty || 0);
  const totalUsed = (hrmsRow.used_qty || 0) + (roleRow.used_qty || 0);
  const totalAvailable = totalPurchased - totalUsed;

  const priceHrms = pricing.license_pricing?.find((p) => p.role === "hrms_staff")?.price_paise || 0;
  const priceRole = pricing.license_pricing?.find((p) => p.role === "role_user_staff")?.price_paise || 0;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="subscription-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
            <CreditCard size={14} /> Subscription &amp; Billing
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 mt-1" data-testid="sub-heading">
            {topupOnly ? "Buy Additional Licenses" : "Build Your Plan"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setPD(true)} data-testid="edit-pricing-btn">
              <Percent size={14} className="mr-1"/> Edit Pricing
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { loadPricing(); loadLicenses(); loadAdmin(); }} data-testid="sub-refresh">
            <RefreshCw size={14} className="mr-1"/> Refresh
          </Button>
        </div>
      </div>

      {/* Company + License Usage Panel */}
      {(licenses.company?.company_code || totalPurchased > 0) && (
        <Card className="p-5 bg-gradient-to-br from-blue-50 via-white to-white border-blue-100" data-testid="license-usage-card">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-lg bg-blue-100 flex items-center justify-center">
                <Building2 className="text-blue-700" size={20}/>
              </div>
              <div>
                <div className="text-slate-900 font-bold text-lg">{licenses.company?.name || "Your Company"}</div>
                <div className="text-xs font-mono text-slate-500" data-testid="company-code">Company Code: {licenses.company?.company_code || "—"}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center flex-1 max-w-lg">
              <UsageStat label="Total Licenses"     value={totalPurchased}  color="slate"   testid="total-purchased"/>
              <UsageStat label="Used"               value={totalUsed}       color="blue"    testid="total-used"/>
              <UsageStat label="Available"          value={totalAvailable}  color="emerald" testid="total-available"/>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
            <LicenseRow row={hrmsRow} label="HRMS Staff" onTopup={() => startTopup("hrms_staff")} isAdmin={isAdmin} testid="hrms" />
            <LicenseRow row={roleRow} label="Role/User Staff" onTopup={() => startTopup("role_user_staff")} isAdmin={isAdmin} testid="role_user" />
          </div>
        </Card>
      )}

      <Tabs defaultValue="build" className="w-full">
        <TabsList data-testid="sub-tabs">
          <TabsTrigger value="build" data-testid="tab-build">Build Plan</TabsTrigger>
          {isAdmin && <TabsTrigger value="coupons" data-testid="tab-coupons"><BadgePercent size={14} className="mr-1"/>Coupons</TabsTrigger>}
          {isAdmin && <TabsTrigger value="history" data-testid="tab-history"><HistoryIcon size={14} className="mr-1"/>Payment History</TabsTrigger>}
        </TabsList>

        <TabsContent value="build" className="mt-4">
          {topupOnly && (
            <Card className="p-3 mb-3 bg-amber-50 border-amber-200 flex items-center justify-between" data-testid="topup-mode-banner">
              <div className="text-amber-900 text-sm flex items-center gap-2">
                <Shield size={16}/> Additional license purchase mode — features &amp; addons cleared. Only licenses will be added to your existing plan.
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTopup(false)} data-testid="topup-exit">Cancel</Button>
            </Card>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* LEFT — Cart Builder */}
            <div className="lg:col-span-2 space-y-4">
              {/* Staff & User Licenses */}
              <Card className="p-5" data-testid="licenses-card">
                <div className="mb-3">
                  <div className="text-slate-900 font-bold flex items-center gap-2">
                    <Users size={16}/> Staff &amp; User Licenses
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Select the number of users required for each role.</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <RoleStepper
                    label="HRMS Staff"
                    subtitle="Human Resource & HRMS management"
                    price={priceHrms}
                    qty={hrmsQty}
                    onQty={setHrmsQty}
                    color="blue"
                    testid="hrms"
                  />
                  <RoleStepper
                    label="Role/User Staff"
                    subtitle="General application users"
                    price={priceRole}
                    qty={roleQty}
                    onQty={setRoleQty}
                    color="emerald"
                    testid="role_user"
                  />
                </div>
              </Card>

              {/* Features */}
              {!topupOnly && (
                <Card className="p-5" data-testid="features-card">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-slate-900 font-bold flex items-center gap-2"><Sparkles size={16}/> Features</div>
                      <div className="text-xs text-slate-500 mt-1">{features.size} feature{features.size === 1 ? "" : "s"} added</div>
                    </div>
                    {features.size > 0 && <Button variant="ghost" size="sm" onClick={() => setFeatures(new Set())} data-testid="clear-features">Clear</Button>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {pricing.features?.map((f) => {
                      const on = features.has(f.code);
                      return (
                        <button
                          key={f.code}
                          type="button"
                          onClick={() => setFeatures((s) => { const n = new Set(s); if (n.has(f.code)) n.delete(f.code); else n.add(f.code); return n; })}
                          data-testid={`feature-${f.code}`}
                          className={`text-left border rounded-lg p-3 transition-all ${on ? "border-blue-500 ring-2 ring-blue-100 bg-blue-50/40" : "border-slate-200 hover:border-slate-300 bg-white"}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-5 h-5 rounded flex items-center justify-center mt-0.5 ${on ? "bg-blue-600" : "bg-slate-100 border border-slate-300"}`}>
                              {on && <Check size={14} className="text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <div className="font-semibold text-slate-900 text-sm">{f.name}</div>
                                <div className="text-xs font-bold text-slate-700 tabular-nums whitespace-nowrap">{inr0(f.price_paise)}/mo</div>
                              </div>
                              <div className="text-[11px] text-slate-500 leading-snug mt-1">{f.description}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Addons */}
              {!topupOnly && (
                <Card className="p-5" data-testid="addons-card">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-slate-900 font-bold flex items-center gap-2"><Package size={16}/> Add-ons</div>
                      <div className="text-xs text-slate-500 mt-1">{addons.size === 0 ? "No add-ons added" : `${addons.size} add-on${addons.size === 1 ? "" : "s"} added`}</div>
                    </div>
                    {addons.size > 0 && <Button variant="ghost" size="sm" onClick={() => setAddons(new Set())} data-testid="clear-addons">Clear</Button>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {pricing.addons?.map((a) => {
                      const on = addons.has(a.code);
                      const unitLabel = a.unit === "per_staff" ? "per staff" : "/mo";
                      return (
                        <button
                          key={a.code}
                          type="button"
                          onClick={() => setAddons((s) => { const n = new Set(s); if (n.has(a.code)) n.delete(a.code); else n.add(a.code); return n; })}
                          data-testid={`addon-${a.code}`}
                          className={`text-left border rounded-lg p-3 transition-all ${on ? "border-emerald-500 ring-2 ring-emerald-100 bg-emerald-50/40" : "border-slate-200 hover:border-slate-300 bg-white"}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-5 h-5 rounded flex items-center justify-center mt-0.5 ${on ? "bg-emerald-600" : "bg-slate-100 border border-slate-300"}`}>
                              {on && <Check size={14} className="text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <div className="font-semibold text-slate-900 text-sm">{a.name}</div>
                                <div className="text-xs font-bold text-slate-700 tabular-nums whitespace-nowrap">{inr0(a.price_paise)} {unitLabel}</div>
                              </div>
                              <div className="text-[11px] text-slate-500 leading-snug mt-1">{a.description}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {addons.has("bgv") && (
                    <div className="mt-3 flex items-center gap-3 border-t pt-3">
                      <Label className="text-xs">Background Verification — staff count</Label>
                      <Input type="number" min={1} value={staffBGV} onChange={(e) => setStaffBGV(Math.max(1, parseInt(e.target.value || "1", 10)))} className="w-24" data-testid="bgv-count"/>
                    </div>
                  )}
                </Card>
              )}

              {/* Duration */}
              <Card className="p-5" data-testid="duration-card">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-slate-900 font-bold flex items-center gap-2"><Clock size={16}/> Duration</div>
                    <div className="text-xs text-slate-500 mt-1">Subscription length in months (max 24)</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" onClick={() => setDuration((d) => Math.max(1, d - 1))} data-testid="duration-minus"><Minus size={14}/></Button>
                    <Input type="number" min={1} max={24} value={duration} onChange={(e) => setDuration(Math.max(1, Math.min(24, parseInt(e.target.value || "1", 10))))} className="w-16 text-center" data-testid="duration-input"/>
                    <Button size="icon" variant="outline" onClick={() => setDuration((d) => Math.min(24, d + 1))} data-testid="duration-plus"><Plus size={14}/></Button>
                    <span className="text-sm text-slate-500 ml-2">{duration === 1 ? "month" : "months"}</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* RIGHT — Cart Summary (sticky) */}
            <div className="lg:sticky lg:top-4 self-start space-y-3">
              <Card className="p-5" data-testid="cart-summary">
                <div className="text-slate-900 font-bold text-lg flex items-center gap-2 mb-1">
                  <ReceiptText size={18}/> Order Summary
                </div>
                <div className="text-xs text-slate-500 mb-4 flex flex-col gap-0.5">
                  <div>Company: <span className="font-semibold text-slate-700">{licenses.company?.name || "—"}</span></div>
                  <div>Company Code: <span className="font-mono font-semibold text-slate-700">{licenses.company?.company_code || "—"}</span></div>
                </div>

                <div className="space-y-2 text-sm mb-4 max-h-52 overflow-y-auto pr-1">
                  {quote?.line_items?.length ? quote.line_items.map((li) => (
                    <div key={`${li.kind}-${li.code}`} className="flex items-start justify-between gap-2" data-testid={`line-${li.code}`}>
                      <div className="text-slate-700 leading-snug">
                        <span className="text-[10px] uppercase font-mono text-slate-400 mr-1">{li.kind}</span>
                        {li.name}
                        <span className="text-[11px] text-slate-500"> × {li.qty}{li.kind === "license" ? ` × ${li.months}mo` : li.meta?.unit === "per_staff" ? " staff" : ""}</span>
                      </div>
                      <div className="text-slate-900 font-medium tabular-nums whitespace-nowrap">{inr0(li.total_paise)}</div>
                    </div>
                  )) : (
                    <div className="text-slate-400 text-xs text-center py-4">Add at least 1 license to see quote</div>
                  )}
                </div>

                {/* Coupon */}
                <div className="border-t pt-3 mb-3">
                  {couponApplied ? (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-emerald-700 font-semibold" data-testid="coupon-applied">
                        <BadgePercent size={14}/> {couponApplied} applied
                      </div>
                      <Button size="icon" variant="ghost" onClick={clearCoupon} data-testid="coupon-remove"><X size={14}/></Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input placeholder="Apply coupon" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} data-testid="coupon-input"/>
                      <Button size="sm" variant="outline" onClick={applyCoupon} data-testid="coupon-apply">Apply</Button>
                    </div>
                  )}
                  {quote?.coupon_status?.code && !quote?.coupon_status?.ok && couponApplied && (
                    <div className="text-xs text-red-600 mt-2 flex items-center gap-1" data-testid="coupon-error">
                      <X size={12}/> Coupon rejected: {quote.coupon_status.reason.replace(/_/g, " ")}
                    </div>
                  )}
                </div>

                {/* Totals */}
                <div className="border-t pt-3 space-y-1.5 text-sm">
                  <Row label="Subtotal" value={inr(quote?.subtotal_paise || 0)} testid="sub-subtotal"/>
                  {(quote?.discount_paise || 0) > 0 && <Row label="Coupon Discount" value={`− ${inr(quote.discount_paise)}`} accent="emerald" testid="sub-discount"/>}
                  <Row label={`GST (${quote?.gst_rate_pct || 18}%)`} value={inr(quote?.gst_paise || 0)} testid="sub-gst"/>
                </div>
                <div className="border-t mt-3 pt-3 flex items-center justify-between" data-testid="grand-total-row">
                  <div className="font-bold text-slate-900">Grand Total</div>
                  <div className="text-2xl font-black text-slate-900 tabular-nums">{inr(quote?.grand_total_paise || 0)}</div>
                </div>
                <div className="text-[10px] text-slate-400 text-right mt-1">+ Payment handling charges may apply</div>

                {/* GST invoice */}
                <div className="mt-4 border-t pt-3">
                  <div className="text-sm font-semibold text-slate-900 mb-2">Do you want GST Invoice?</div>
                  <div className="text-[11px] text-slate-500 mb-2">Claim input tax credit on GST invoice</div>
                  <div className="flex items-center gap-4 mb-2">
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" checked={gstInvoice} onChange={() => setGst(true)} data-testid="gst-yes"/> Yes
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" checked={!gstInvoice} onChange={() => setGst(false)} data-testid="gst-no"/> No
                    </label>
                  </div>
                  {gstInvoice && <Input placeholder="GSTIN (15 chars)" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} data-testid="gstin-input"/>}
                </div>

                <Button
                  className="w-full mt-4 h-11 text-base font-bold"
                  disabled={!isAdmin || !quote || quote.grand_total_paise <= 0 || payBusy}
                  onClick={checkout}
                  data-testid="continue-to-pay"
                >
                  {payBusy ? "Opening Checkout…" : isAdmin ? <><Zap size={16} className="mr-1"/> Continue to Pay</> : "Admin only"}
                </Button>
                {!isAdmin && <div className="text-[11px] text-slate-400 text-center mt-2">Only company admins can purchase.</div>}
              </Card>
            </div>
          </div>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="coupons" className="mt-4">
            <Card className="p-5" data-testid="coupons-panel">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-slate-900 font-bold flex items-center gap-2"><BadgePercent size={16}/> Coupons</div>
                  <div className="text-xs text-slate-500">Create discount codes for promotions</div>
                </div>
                <Button onClick={() => setCD(true)} data-testid="new-coupon-btn"><Plus size={14} className="mr-1"/> New Coupon</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-widest text-slate-500 border-b">
                    <tr>
                      <th className="text-left py-2">Code</th>
                      <th className="text-left">Discount</th>
                      <th className="text-left">Uses</th>
                      <th className="text-left">Expires</th>
                      <th className="text-left">Status</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No coupons yet</td></tr>}
                    {coupons.map((c) => (
                      <tr key={c.id} className="border-b last:border-0" data-testid={`coupon-row-${c.code}`}>
                        <td className="py-2 font-mono font-bold text-slate-900">{c.code}</td>
                        <td>{c.discount_pct ? `${c.discount_pct}%` : `Flat ${inr0(c.discount_paise)}`}</td>
                        <td>{(c.used_count || 0)}{c.max_uses ? ` / ${c.max_uses}` : ""}</td>
                        <td className="text-slate-500">{c.expires_at ? dt(c.expires_at) : "Never"}</td>
                        <td><Badge className={c.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}>{c.is_active ? "Active" : "Disabled"}</Badge></td>
                        <td className="text-right">
                          {c.is_active && (
                            <Button size="icon" variant="ghost" onClick={async () => {
                              try { await api.delete(`/subscription/admin/coupons/${c.id}`); toast.success("Coupon deactivated"); loadAdmin(); }
                              catch (e) { toast.error(formatError(e)); }
                            }} data-testid={`coupon-delete-${c.code}`}><Trash2 size={14}/></Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <CouponDialog open={couponDialog} onClose={() => setCD(false)} onCreated={loadAdmin}/>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="history" className="mt-4">
            <Card className="p-5" data-testid="orders-panel">
              <div className="text-slate-900 font-bold mb-3 flex items-center gap-2"><Wallet size={16}/> Payment History</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-widest text-slate-500 border-b">
                    <tr>
                      <th className="text-left py-2">Order ID</th>
                      <th className="text-left">Company Code</th>
                      <th className="text-left">HRMS</th>
                      <th className="text-left">Role/User</th>
                      <th className="text-left">Features</th>
                      <th className="text-left">Total</th>
                      <th className="text-left">GST Invoice</th>
                      <th className="text-left">Status</th>
                      <th className="text-left">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-slate-400">No orders yet</td></tr>}
                    {orders.slice(0, 50).map((o) => (
                      <tr key={o.razorpay_order_id} className="border-b last:border-0">
                        <td className="py-2 font-mono text-[11px]">{o.razorpay_order_id}</td>
                        <td className="font-mono text-[11px]">{o.company_code || "—"}</td>
                        <td className="tabular-nums">{o.hrms_staff_qty || 0}</td>
                        <td className="tabular-nums">{o.role_user_staff_qty || 0}</td>
                        <td className="text-xs text-slate-500 max-w-[200px] truncate">{(o.feature_codes || []).join(", ") || "—"}</td>
                        <td className="tabular-nums font-medium">{inr(o.amount_paise)}</td>
                        <td>{o.gst_invoice ? <Badge className="bg-blue-50 text-blue-700">Yes · {o.gstin}</Badge> : <span className="text-slate-400 text-xs">No</span>}</td>
                        <td><Badge className={o.status === "captured" ? "bg-emerald-100 text-emerald-700" : o.status === "failed" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}>{o.status}</Badge></td>
                        <td className="text-slate-500 text-xs">{dt(o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <PricingEditorDialog
        open={pricingDialog}
        onClose={() => setPD(false)}
        pricing={pricing}
        onSaved={() => { loadPricing(); }}
      />
    </div>
  );
}

// ---- Small helpers ------------------------------------------------------

function Row({ label, value, accent, testid }) {
  const color = accent === "emerald" ? "text-emerald-700" : "text-slate-700";
  return (
    <div className="flex items-center justify-between" data-testid={testid}>
      <div className="text-slate-600">{label}</div>
      <div className={`tabular-nums font-medium ${color}`}>{value}</div>
    </div>
  );
}

function RoleStepper({ label, subtitle, price, qty, onQty, color, testid }) {
  const c = color === "blue"
    ? { bg: "bg-blue-50", ring: "ring-blue-100", text: "text-blue-700" }
    : { bg: "bg-emerald-50", ring: "ring-emerald-100", text: "text-emerald-700" };
  return (
    <div className={`p-4 border rounded-lg ${c.bg} ring-1 ${c.ring}`} data-testid={`role-card-${testid}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className={`font-bold text-sm ${c.text}`}>{label}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => onQty(Math.max(0, qty - 1))} data-testid={`role-${testid}-minus`}><Minus size={14}/></Button>
        <Input
          type="number" min={0} value={qty}
          onChange={(e) => onQty(Math.max(0, parseInt(e.target.value || "0", 10)))}
          className="w-20 text-center font-bold text-lg" data-testid={`role-${testid}-qty`}
        />
        <Button size="icon" variant="outline" onClick={() => onQty(qty + 1)} data-testid={`role-${testid}-plus`}><Plus size={14}/></Button>
      </div>
      <div className="text-xs text-slate-600 mt-2">
        <span className="font-bold text-slate-800">{inr0(price)}</span> / staff / month
      </div>
    </div>
  );
}

function UsageStat({ label, value, color, testid }) {
  const map = {
    slate:   "text-slate-700",
    blue:    "text-blue-700",
    emerald: "text-emerald-700",
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className={`text-2xl font-black tabular-nums ${map[color]}`} data-testid={testid}>{value}</div>
    </div>
  );
}

function LicenseRow({ row, label, onTopup, isAdmin, testid }) {
  const p = row.purchased_qty || 0;
  const u = row.used_qty || 0;
  const a = Math.max(0, p - u);
  const pct = p > 0 ? Math.min(100, Math.round((u / p) * 100)) : 0;
  const bar = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="border rounded-lg p-3 bg-white" data-testid={`license-row-${testid}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={onTopup} data-testid={`topup-${testid}`}>
            <ArrowUpRight size={12} className="mr-1"/> Buy More
          </Button>
        )}
      </div>
      <div className="text-xs text-slate-500 mb-1">Purchased: <span className="font-bold text-slate-800">{p}</span> · Used: <span className="font-bold text-slate-800">{u}</span> · Available: <span className="font-bold text-emerald-700">{a}</span></div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }}/>
      </div>
    </div>
  );
}

function CouponDialog({ open, onClose, onCreated }) {
  const [code, setCode] = useState("");
  const [desc, setDesc] = useState("");
  const [mode, setMode] = useState("pct");
  const [pct, setPct] = useState(10);
  const [flat, setFlat] = useState(500);
  const [minSub, setMinSub] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!code.trim()) return toast.error("Coupon code required");
    setSaving(true);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        description: desc,
        max_uses: maxUses ? parseInt(maxUses, 10) : null,
        min_subtotal_paise: minSub ? parseInt(minSub, 10) * 100 : null,
        expires_at: expires ? new Date(expires + "T23:59:59Z").toISOString() : null,
      };
      if (mode === "pct") body.discount_pct = pct;
      else body.discount_paise = flat * 100;
      await api.post("/subscription/admin/coupons", body);
      toast.success(`Coupon ${body.code} created`);
      setCode(""); setDesc(""); setPct(10); setFlat(500); setMinSub(""); setMaxUses(""); setExpires("");
      onCreated?.(); onClose();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="coupon-dialog">
        <DialogHeader>
          <DialogTitle>New Coupon</DialogTitle>
          <DialogDescription>Discount codes that buyers can apply on checkout</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Code *</Label><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH50" data-testid="c-code"/></div>
            <div><Label>Description</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Launch discount" data-testid="c-desc"/></div>
          </div>
          <div>
            <Label>Discount Type</Label>
            <div className="flex items-center gap-3 mt-1">
              <label className="text-sm flex items-center gap-1"><input type="radio" checked={mode === "pct"} onChange={() => setMode("pct")}/> Percentage</label>
              <label className="text-sm flex items-center gap-1"><input type="radio" checked={mode === "flat"} onChange={() => setMode("flat")}/> Flat ₹</label>
            </div>
          </div>
          {mode === "pct" ? (
            <div><Label>Discount % *</Label><Input type="number" min={1} max={100} value={pct} onChange={(e) => setPct(parseInt(e.target.value || "1", 10))} data-testid="c-pct"/></div>
          ) : (
            <div><Label>Flat Amount (₹) *</Label><Input type="number" min={1} value={flat} onChange={(e) => setFlat(parseInt(e.target.value || "1", 10))} data-testid="c-flat"/></div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Min Subtotal (₹)</Label><Input type="number" value={minSub} onChange={(e) => setMinSub(e.target.value)} placeholder="Optional" data-testid="c-minsub"/></div>
            <div><Label>Max Uses</Label><Input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" data-testid="c-maxuses"/></div>
            <div><Label>Expires On</Label><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} data-testid="c-expires"/></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="c-save">{saving ? "Saving…" : "Create Coupon"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PricingEditorDialog({ open, onClose, pricing, onSaved }) {
  const [licRows, setLicRows] = useState([]);
  const [featRows, setFeatRows] = useState([]);
  const [addonRows, setAddonRows] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setLicRows((pricing.license_pricing || []).map((r) => ({ ...r, _price: r.price_paise / 100 })));
      setFeatRows((pricing.features || []).map((r) => ({ ...r, _price: r.price_paise / 100 })));
      setAddonRows((pricing.addons || []).map((r) => ({ ...r, _price: r.price_paise / 100 })));
    }
  }, [open, pricing]);

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const r of licRows) {
        await api.patch("/subscription/admin/license-pricing", { role: r.role, price_paise: Math.round((r._price || 0) * 100) });
      }
      for (const r of featRows) {
        await api.patch("/subscription/admin/features", { code: r.code, price_paise: Math.round((r._price || 0) * 100) });
      }
      for (const r of addonRows) {
        await api.patch("/subscription/admin/addons", { code: r.code, price_paise: Math.round((r._price || 0) * 100) });
      }
      toast.success("Pricing updated");
      onSaved?.(); onClose();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="pricing-editor">
        <DialogHeader>
          <DialogTitle>Edit Pricing</DialogTitle>
          <DialogDescription>Modify per-staff, feature and addon prices. Changes apply immediately.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <PriceGrid title="Staff Licenses (per staff / month)" rows={licRows} setRows={setLicRows} labelKey="name" />
          <PriceGrid title="Features (per month)" rows={featRows} setRows={setFeatRows} labelKey="name" />
          <PriceGrid title="Add-ons" rows={addonRows} setRows={setAddonRows} labelKey="name" suffix={(r) => r.unit === "per_staff" ? " per staff" : " /mo"}/>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={saveAll} disabled={saving} data-testid="save-pricing">{saving ? "Saving…" : "Save All"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceGrid({ title, rows, setRows, labelKey, suffix }) {
  return (
    <div>
      <div className="text-sm font-bold text-slate-900 mb-2">{title}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {rows.map((r, idx) => (
          <div key={r.code || r.role} className="flex items-center gap-2 border rounded-md p-2">
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-900">{r[labelKey]}</div>
              <div className="text-[10px] text-slate-400 font-mono">{r.code || r.role}</div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500">₹</span>
              <Input
                type="number" min={0} step={1} className="w-24 text-right"
                value={r._price || 0}
                onChange={(e) => setRows((prev) => prev.map((x, i) => i === idx ? { ...x, _price: parseFloat(e.target.value || "0") } : x))}
                data-testid={`price-${r.code || r.role}`}
              />
              {suffix && <span className="text-[10px] text-slate-500">{suffix(r)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

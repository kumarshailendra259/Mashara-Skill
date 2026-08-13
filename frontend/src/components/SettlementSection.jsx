import React, { useState } from "react";
import { api } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

/**
 * Renders the Partner Settlement section.
 * - Shows ONLY post-cutoff balances by default (auto cutoff from last recorded settlement).
 * - "View Settled History" toggle reveals lifetime (pre-cutoff) totals & past settlements.
 * - Per-partner "Settle" button opens a modal to record a partner-to-partner payment.
 * - "View Contributing Txns" opens a drill-down modal listing the exact transactions
 *   currently counted in the active cycle.
 */
export default function SettlementSection({ settlement, onSettled }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [showHistory, setShowHistory] = useState(false);
  const [historyByCenter, setHistoryByCenter] = useState({});
  const [openModal, setOpenModal] = useState(null); // { center, fromPartner, toCandidates }
  const [form, setForm] = useState({ to_partner_id: "", amount: "", date: "", note: "" });
  const [submitting, setSubmitting] = useState(false);
  const [txnDrill, setTxnDrill] = useState(null); // { center, scope, loading, data }

  const canRecord = ["admin", "senior_manager", "manager", "accountant", "partner"].includes(user?.role);

  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (!next) return;
    // Fetch past settlement records for each center
    try {
      const entries = await Promise.all(
        (settlement?.centers || []).map((c) =>
          api.get("/dashboard/settlement/history", { params: { center_id: c.center_id } })
            .then((r) => [c.center_id, r.data.records || []])
            .catch(() => [c.center_id, []]),
        ),
      );
      setHistoryByCenter(Object.fromEntries(entries));
    } catch {
      setHistoryByCenter({});
    }
  };

  const openSettleModal = (center, fromPartner) => {
    const candidates = center.partners.filter((p) => p.id !== fromPartner.id && p.adjustment < 0);
    // Pre-fill amount = absolute adjustment of payer (what they owe overall)
    setForm({
      to_partner_id: candidates[0]?.id || "",
      amount: Math.abs(Math.round(fromPartner.adjustment)).toString(),
      date: new Date().toISOString().slice(0, 10),
      note: "",
    });
    setOpenModal({ center, fromPartner, toCandidates: candidates });
  };

  const submitSettlement = async () => {
    if (!form.to_partner_id || !form.amount || !form.date) {
      toast.error("Please fill recipient, amount and date");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/dashboard/settlement/record", {
        center_id: openModal.center.center_id,
        from_partner_id: openModal.fromPartner.id,
        to_partner_id: form.to_partner_id,
        amount: parseFloat(form.amount),
        date: form.date,
        note: form.note || null,
      });
      toast.success("Settlement recorded — balances reset from this date");
      setOpenModal(null);
      onSettled?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to record settlement");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteHistoryRecord = async (recId) => {
    if (!window.confirm("Undo this settlement? Post-cutoff balances will be recalculated.")) return;
    try {
      await api.delete(`/dashboard/settlement/record/${recId}`);
      toast.success("Settlement record removed");
      onSettled?.();
      // Refresh history view
      const entries = await Promise.all(
        (settlement?.centers || []).map((c) =>
          api.get("/dashboard/settlement/history", { params: { center_id: c.center_id } })
            .then((r) => [c.center_id, r.data.records || []])
            .catch(() => [c.center_id, []]),
        ),
      );
      setHistoryByCenter(Object.fromEntries(entries));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to remove settlement");
    }
  };

  const openTxnDrill = async (c, scope) => {
    setTxnDrill({ center: c, scope, loading: true, data: null });
    try {
      const r = await api.get("/dashboard/settlement/txns", { params: { center_id: c.center_id, scope } });
      setTxnDrill({ center: c, scope, loading: false, data: r.data });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load transactions");
      setTxnDrill(null);
    }
  };

  const isAdmin = user?.role === "admin";
  const runNormalizeDates = async () => {
    if (!window.confirm(
      "Ye maintenance action legacy transactions ke DD-MM-YYYY / DD/MM/YYYY dates ko YYYY-MM-DD me convert karega. " +
      "Ye zaroori hai kyunki galat format se puraani expenses \"Current Cycle\" me leak ho jaati hain. Continue?"
    )) return;
    try {
      const dry = await api.post("/admin/normalize-txn-dates?dry_run=true");
      const preview = dry.data;
      if (preview.fixed === 0) {
        toast.success(`Kuch nahi karna — sab ${preview.scanned} rows already sahi format me hain.`);
        return;
      }
      if (!window.confirm(
        `Dry run: ${preview.fixed} rows fix hoge, ${preview.unfixable} unfixable. ` +
        `Real update karein?`
      )) return;
      const real = await api.post("/admin/normalize-txn-dates?dry_run=false");
      toast.success(`Fixed ${real.data.fixed} txn dates. Refresh…`);
      onSettled?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Normalize failed");
    }
  };

  if (!settlement?.centers?.length) return null;

  return (
    <div className="swiss-card p-5" data-testid="settlement-section">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="font-heading font-bold tracking-tight text-lg">{t("settlement")}</div>
        <div className="flex items-center gap-3">
          <div className="overline">Equal-split fair share</div>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={runNormalizeDates}
              className="rounded-none text-xs"
              data-testid="normalize-dates-btn"
              title="Fix legacy DD-MM-YYYY dates that leak into current cycle"
            >
              Fix Legacy Dates
            </Button>
          )}
          <Button
            size="sm"
            variant={showHistory ? "default" : "outline"}
            onClick={toggleHistory}
            className="rounded-none"
            data-testid="toggle-settled-history"
          >
            {showHistory ? "Hide" : "View"} Settled History
          </Button>
        </div>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">
        <b>Cycle Math:</b> Contribution = Investment + Expense · Profit/Loss = Total Income − Total Contribution ·
        Final Share = Contribution + 50% × P/L. Only <b>active cycle</b> transactions (after the last settlement) are counted.
      </p>

      <div className="space-y-6">
        {settlement.centers.map((c) => (
          <div
            key={c.center_id}
            className="border border-[var(--border)]"
            data-testid={`settlement-center-${c.center_id}`}
          >
            <div className="px-4 py-2 bg-gray-50 border-b border-[var(--border)] flex justify-between items-center flex-wrap gap-2">
              <div>
                <span className="overline mr-2">Center</span>
                <span className="font-heading font-bold">{c.center_name}</span>
                {c.settled_till && (
                  <span className="ml-3 text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Settled till {c.settled_till} • Active cycle from next day
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-none text-xs"
                  onClick={() => openTxnDrill(c, "current")}
                  data-testid={`view-txns-current-${c.center_id}`}
                >
                  View Contributing Txns
                </Button>
              </div>
            </div>

            {/* Active Cycle KPI strip */}
            {c.partners.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border-b border-[var(--border)] bg-white text-sm">
                <div className="p-3 border-r border-[var(--border)]" data-testid={`kpi-income-${c.center_id}`}>
                  <div className="overline text-[10px]">Total Income</div>
                  <div className="num font-semibold value-positive">{inr(c.total_income || 0)}</div>
                </div>
                <div className="p-3 border-r border-[var(--border)]" data-testid={`kpi-expense-${c.center_id}`}>
                  <div className="overline text-[10px]">Total Contribution (Expense)</div>
                  <div className="num font-semibold value-negative">{inr(c.total_contribution || 0)}</div>
                </div>
                <div className="p-3 border-r border-[var(--border)]" data-testid={`kpi-pl-${c.center_id}`}>
                  <div className="overline text-[10px]">Profit / Loss</div>
                  <div className={`num font-bold ${(c.profit_loss || 0) >= 0 ? "value-positive" : "value-negative"}`}>
                    {inr(c.profit_loss || 0)}
                  </div>
                </div>
                <div className="p-3 border-r border-[var(--border)]" data-testid={`kpi-pshare-${c.center_id}`}>
                  <div className="overline text-[10px]">Profit Share / Partner (50/50)</div>
                  <div className={`num font-semibold ${(c.profit_share_each || 0) >= 0 ? "value-positive" : "value-negative"}`}>
                    {inr(c.profit_share_each || 0)}
                  </div>
                </div>
                <div className="p-3" data-testid={`kpi-fair-${c.center_id}`}>
                  <div className="overline text-[10px]">Fair Share / Partner</div>
                  <div className="num font-semibold">{inr(c.fair_share_each || 0)}</div>
                </div>
              </div>
            )}

            {c.partners.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--muted)]">
                All settled. No new transactions after {c.settled_till || "cutoff"}.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] overline">
                    <th className="text-left p-3">{t("partner")}</th>
                    <th className="text-right p-3">{t("investment")}</th>
                    <th className="text-right p-3">{t("expense")}</th>
                    <th className="text-right p-3">Contribution</th>
                    <th className="text-right p-3">Profit Share (50%)</th>
                    <th className="text-right p-3">Final Share</th>
                    <th className="text-right p-3">{t("adjustment")}</th>
                    {canRecord && <th className="text-right p-3">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {c.partners.map((p) => {
                    const adj = p.adjustment;
                    const isSettled = Math.abs(adj) < 0.5;
                    const label = isSettled ? t("settled") : adj > 0 ? t("to_pay") : t("to_receive");
                    const color = isSettled ? "text-[var(--muted)]" : adj > 0 ? "value-negative" : "value-positive";
                    const psColor = (p.profit_share || 0) >= 0 ? "value-positive" : "value-negative";
                    return (
                      <tr key={p.id} className="border-b border-[var(--border)] last:border-0" data-testid={`settle-row-${c.center_id}-${p.id}`}>
                        <td className="p-3 font-medium">{p.name}</td>
                        <td className="p-3 num">{inr(p.investment)}</td>
                        <td className="p-3 num value-negative">{inr(p.expense)}</td>
                        <td className="p-3 num font-semibold" data-testid={`p-contrib-${p.id}`}>{inr(p.total_contribution)}</td>
                        <td className={`p-3 num ${psColor}`} data-testid={`p-pshare-${p.id}`}>{inr(p.profit_share || 0)}</td>
                        <td className="p-3 num font-bold" data-testid={`p-final-${p.id}`}>{inr(p.final_share || 0)}</td>
                        <td className={`p-3 num font-bold ${color}`}>
                          <div className="flex justify-end items-center gap-2">
                            <span className="overline text-[10px]">{label}</span>
                            <span>{inr(Math.abs(adj))}</span>
                          </div>
                        </td>
                        {canRecord && (
                          <td className="p-3 text-right">
                            {adj > 0.5 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-none text-xs"
                                onClick={() => openSettleModal(c, p)}
                                data-testid={`settle-btn-${c.center_id}-${p.id}`}
                              >
                                Settle Dues
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Settled History block */}
            {showHistory && (
              <div className="border-t border-[var(--border)] bg-gray-50 p-4 space-y-3" data-testid={`history-${c.center_id}`}>
                <div className="overline">Lifetime totals (info-only, ignores cutoff)</div>
                {c.lifetime ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-[var(--border)] bg-white text-sm">
                      <div className="p-2 border-r border-[var(--border)]">
                        <div className="overline text-[10px]">Lifetime Income</div>
                        <div className="num font-semibold value-positive">{inr(c.lifetime.total_income || 0)}</div>
                      </div>
                      <div className="p-2 border-r border-[var(--border)]">
                        <div className="overline text-[10px]">Lifetime Contribution</div>
                        <div className="num font-semibold value-negative">{inr(c.lifetime.total_contribution || 0)}</div>
                      </div>
                      <div className="p-2 border-r border-[var(--border)]">
                        <div className="overline text-[10px]">Lifetime P/L</div>
                        <div className={`num font-bold ${(c.lifetime.profit_loss || 0) >= 0 ? "value-positive" : "value-negative"}`}>
                          {inr(c.lifetime.profit_loss || 0)}
                        </div>
                      </div>
                      <div className="p-2">
                        <div className="overline text-[10px]">Fair Share / Partner</div>
                        <div className="num font-semibold">{inr(c.lifetime.fair_share_each || 0)}</div>
                      </div>
                    </div>
                    <table className="w-full text-sm bg-white border border-[var(--border)]">
                    <thead>
                      <tr className="border-b border-[var(--border)] overline">
                        <th className="text-left p-2">{t("partner")}</th>
                        <th className="text-right p-2">{t("investment")}</th>
                        <th className="text-right p-2">{t("expense")}</th>
                        <th className="text-right p-2">{t("income")}</th>
                        <th className="text-right p-2">Contribution</th>
                        <th className="text-right p-2">Final Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.lifetime.partners.map((p) => (
                        <tr key={`lt-${p.id}`} className="border-b border-[var(--border)] last:border-0">
                          <td className="p-2 font-medium">{p.name}</td>
                          <td className="p-2 num">{inr(p.investment)}</td>
                          <td className="p-2 num value-negative">{inr(p.expense)}</td>
                          <td className="p-2 num value-positive">{inr(p.income)}</td>
                          <td className="p-2 num font-semibold">{inr(p.total_contribution)}</td>
                          <td className="p-2 num font-bold">{inr(p.final_share || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </>
                ) : (
                  <div className="text-sm text-[var(--muted)]">No lifetime data.</div>
                )}

                <div className="overline mt-3">Past settlements</div>
                {(historyByCenter[c.center_id] || []).length === 0 ? (
                  <div className="text-sm text-[var(--muted)]">No settlements recorded.</div>
                ) : (
                  <div className="bg-white border border-[var(--border)]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] overline">
                          <th className="text-left p-2">Date</th>
                          <th className="text-left p-2">From</th>
                          <th className="text-left p-2">To</th>
                          <th className="text-right p-2">Amount</th>
                          <th className="text-left p-2">Note</th>
                          {(user?.role === "admin" || user?.role === "accountant" || user?.role === "senior_manager") && (
                            <th className="text-right p-2">Action</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {historyByCenter[c.center_id].map((h) => (
                          <tr key={h.id} className="border-b border-[var(--border)] last:border-0">
                            <td className="p-2 num">{h.date}</td>
                            <td className="p-2">{h.from_partner_name}</td>
                            <td className="p-2">{h.to_partner_name}</td>
                            <td className="p-2 num font-medium">{inr(h.amount)}</td>
                            <td className="p-2 text-[var(--muted)]">{h.note || "—"}</td>
                            {(user?.role === "admin" || user?.role === "accountant" || user?.role === "senior_manager") && (
                              <td className="p-2 text-right">
                                <button
                                  className="text-xs text-red-600 hover:underline"
                                  onClick={() => deleteHistoryRecord(h.id)}
                                  data-testid={`undo-settlement-${h.id}`}
                                >
                                  Undo
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Contributing Transactions Drill-Down */}
      <Dialog open={!!txnDrill} onOpenChange={(o) => !o && setTxnDrill(null)}>
        <DialogContent className="rounded-none max-w-4xl" data-testid="txn-drill-dialog">
          <DialogHeader>
            <DialogTitle>
              Contributing Transactions — {txnDrill?.center?.center_name}
            </DialogTitle>
            <DialogDescription>
              {txnDrill?.scope === "current"
                ? `Active cycle (${txnDrill?.data?.cutoff ? `after ${txnDrill?.data?.cutoff}` : "no cutoff yet"}). If this list is empty and the totals above are ₹0, everything is settled.`
                : "All approved partner-tagged transactions for this center (lifetime)."}
            </DialogDescription>
          </DialogHeader>
          {txnDrill?.loading ? (
            <div className="text-sm text-[var(--muted)] p-4">Loading…</div>
          ) : txnDrill?.data ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-0 border border-[var(--border)] bg-gray-50 text-sm">
                <div className="p-2 border-r border-[var(--border)]">
                  <div className="overline text-[10px]">Total Investment</div>
                  <div className="num font-semibold">{inr(txnDrill.data.totals.investment)}</div>
                </div>
                <div className="p-2 border-r border-[var(--border)]">
                  <div className="overline text-[10px]">Total Expense</div>
                  <div className="num font-semibold value-negative">{inr(txnDrill.data.totals.expense)}</div>
                </div>
                <div className="p-2">
                  <div className="overline text-[10px]">Total Income</div>
                  <div className="num font-semibold value-positive">{inr(txnDrill.data.totals.income)}</div>
                </div>
              </div>
              <div className="text-xs text-[var(--muted)]">
                <b>{txnDrill.data.count}</b> transaction{txnDrill.data.count === 1 ? "" : "s"} counted
                {txnDrill.data.cutoff && ` — cutoff: ${txnDrill.data.cutoff}`}
              </div>
              {txnDrill.data.rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--muted)] border border-dashed border-[var(--border)]">
                  No transactions in this scope. Current Cycle totals should read ₹0.
                </div>
              ) : (
                <div className="max-h-[50vh] overflow-y-auto border border-[var(--border)]">
                  <table className="w-full text-xs" data-testid="txn-drill-table">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="overline border-b border-[var(--border)]">
                        <th className="text-left p-2">Date</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-left p-2">Partner</th>
                        <th className="text-left p-2">Source</th>
                        <th className="text-right p-2">Amount</th>
                        <th className="text-left p-2">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txnDrill.data.rows.map((r) => (
                        <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-gray-50">
                          <td className="p-2 num whitespace-nowrap">{r.date}</td>
                          <td className={`p-2 font-semibold ${r.type === "income" ? "value-positive" : r.type === "expense" ? "value-negative" : ""}`}>
                            {r.type}
                          </td>
                          <td className="p-2">{r.partner_name}</td>
                          <td className="p-2 text-[var(--muted)]">{r.source || "—"}</td>
                          <td className={`p-2 num font-semibold ${r.type === "income" ? "value-positive" : r.type === "expense" ? "value-negative" : ""}`}>
                            {inr(r.amount)}
                          </td>
                          <td className="p-2 text-[var(--muted)] max-w-md truncate" title={r.description}>
                            {r.description || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setTxnDrill(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settle Dialog */}
      <Dialog open={!!openModal} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="rounded-none" data-testid="settle-dialog">
          <DialogHeader>
            <DialogTitle>Settle Dues</DialogTitle>
            <DialogDescription>
              Recording this payment will reset balances from the chosen date — only transactions
              after this date will be counted going forward.
            </DialogDescription>
          </DialogHeader>
          {openModal && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="overline mr-2">Center</span>
                <span className="font-medium">{openModal.center.center_name}</span>
              </div>
              <div className="text-sm">
                <span className="overline mr-2">Paying Partner</span>
                <span className="font-medium">{openModal.fromPartner.name}</span>
              </div>
              <div className="space-y-1">
                <Label className="overline">Receiving Partner</Label>
                <select
                  className="w-full h-10 border border-[var(--border)] px-3 text-sm"
                  value={form.to_partner_id}
                  onChange={(e) => setForm({ ...form, to_partner_id: e.target.value })}
                  data-testid="settle-to-partner"
                >
                  <option value="">— Select —</option>
                  {(openModal.toCandidates.length ? openModal.toCandidates : openModal.center.partners.filter(p => p.id !== openModal.fromPartner.id)).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.adjustment < 0 ? `(to receive ${inr(Math.abs(p.adjustment))})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="overline">Amount Paid (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="rounded-none"
                  data-testid="settle-amount"
                />
              </div>
              <div className="space-y-1">
                <Label className="overline">Payment Date (cutoff)</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="rounded-none"
                  data-testid="settle-date"
                />
              </div>
              <div className="space-y-1">
                <Label className="overline">Note (optional)</Label>
                <Input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="UTR / cheque no. / reference"
                  className="rounded-none"
                  data-testid="settle-note"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setOpenModal(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitSettlement}
              disabled={submitting}
              className="rounded-none"
              data-testid="settle-submit"
            >
              {submitting ? "Recording…" : "Record Settlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

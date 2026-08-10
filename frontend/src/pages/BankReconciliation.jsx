import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { toast } from "sonner";
import KpiCard from "@/components/KpiCard";
import PrintButton from "@/components/PrintButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Building2, Wallet, Smartphone, Plus, ArrowDown, Settings, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const TYPE_META = {
  bank: { label: "Bank", icon: Building2, tone: "bg-blue-50 text-blue-700 border-blue-200" },
  cash: { label: "Cash-in-Hand", icon: Wallet, tone: "bg-amber-50 text-amber-700 border-amber-200" },
  upi_wallet: { label: "UPI Wallet", icon: Smartphone, tone: "bg-purple-50 text-purple-700 border-purple-200" },
};

const SOURCE_LABEL = {
  payment: "Payment", advance: "Advance Release", reimbursement: "Reimbursement",
  payroll: "Payroll", deposit: "Deposit", adjustment: "Adjustment", opening_balance: "Opening Balance",
};

const EMPTY_ACCT = {
  name: "", type: "bank", bank_name: "", account_no: "", ifsc: "",
  upi_id: "", opening_balance: 0, is_active: true, remarks: "",
};

export default function BankReconciliation() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [accounts, setAccounts] = useState([]);
  const [txns, setTxns] = useState([]);
  const [txnTotals, setTxnTotals] = useState({ total_credit: 0, total_debit: 0, net: 0 });
  const [txnLoading, setTxnLoading] = useState(false);
  const [filter, setFilter] = useState({ account_id: "", source: "", from: "", to: "", q: "" });

  const [acctDlgOpen, setAcctDlgOpen] = useState(false);
  const [acctForm, setAcctForm] = useState(EMPTY_ACCT);
  const [editingAcctId, setEditingAcctId] = useState(null);
  const [acctBusy, setAcctBusy] = useState(false);

  const [depDlgOpen, setDepDlgOpen] = useState(false);
  const [depTarget, setDepTarget] = useState(null);
  const [depForm, setDepForm] = useState({ amount: "", remarks: "", source_label: "" });
  const [depBusy, setDepBusy] = useState(false);

  const loadAccounts = () => {
    api.get("/bank-accounts").then((r) => setAccounts(r.data)).catch(() => setAccounts([]));
  };

  const loadTxns = () => {
    setTxnLoading(true);
    const params = {};
    Object.entries(filter).forEach(([k, v]) => { if (v) params[k] = v; });
    params.limit = 200;
    api.get("/bank-transactions", { params })
      .then((r) => {
        const d = r.data || {};
        setTxns(d.rows || []);
        setTxnTotals({
          total_credit: d.total_credit || 0,
          total_debit: d.total_debit || 0,
          net: d.net || 0,
        });
      })
      .catch(() => setTxns([]))
      .finally(() => setTxnLoading(false));
  };

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { loadTxns(); }, [filter]);

  const totalBalance = useMemo(
    () => accounts.filter((a) => a.is_active).reduce((s, a) => s + Number(a.current_balance || 0), 0),
    [accounts]
  );

  const openNewAcct = () => {
    setEditingAcctId(null);
    setAcctForm(EMPTY_ACCT);
    setAcctDlgOpen(true);
  };
  const openEditAcct = (a) => {
    setEditingAcctId(a.id);
    setAcctForm({ ...EMPTY_ACCT, ...a, opening_balance: 0 });
    setAcctDlgOpen(true);
  };
  const saveAcct = async () => {
    if (acctBusy) return;
    if (!acctForm.name.trim()) { toast.error("Account name is required"); return; }
    if (acctForm.type === "bank" && (!acctForm.account_no || !acctForm.ifsc)) {
      toast.error("Bank requires Account No + IFSC"); return;
    }
    if (acctForm.type === "upi_wallet" && !acctForm.upi_id) {
      toast.error("UPI Wallet requires UPI ID"); return;
    }
    setAcctBusy(true);
    try {
      if (editingAcctId) {
        await api.patch(`/bank-accounts/${editingAcctId}`, acctForm);
        toast.success("Account updated");
      } else {
        await api.post("/bank-accounts", acctForm);
        toast.success("Account created");
      }
      setAcctDlgOpen(false);
      loadAccounts();
    } catch (e) { toast.error(formatError(e)); }
    finally { setAcctBusy(false); }
  };

  const openDeposit = (a) => {
    setDepTarget(a);
    setDepForm({ amount: "", remarks: "", source_label: "" });
    setDepDlgOpen(true);
  };
  const submitDeposit = async () => {
    if (depBusy || !depTarget) return;
    const amt = parseFloat(depForm.amount || "0");
    if (!amt || amt <= 0) { toast.error("Enter valid amount"); return; }
    if (!depForm.remarks.trim() || depForm.remarks.trim().length < 3) {
      toast.error("Remarks required (min 3 chars)"); return;
    }
    setDepBusy(true);
    try {
      await api.post(`/bank-accounts/${depTarget.id}/deposit`, {
        amount: amt, remarks: depForm.remarks.trim(),
        source_label: depForm.source_label || undefined,
      });
      toast.success(`Deposited ${inr(amt)} to ${depTarget.name}`);
      setDepDlgOpen(false);
      loadAccounts();
      loadTxns();
    } catch (e) { toast.error(formatError(e)); }
    finally { setDepBusy(false); }
  };

  return (
    <div className="space-y-5" data-testid="bank-recon-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">Bank &amp; Cash</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">Bank / Cash Reconciliation</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Live balances across all accounts, wallets and cash — every outflow debits automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadAccounts(); loadTxns(); }} className="rounded-none" data-testid="br-refresh">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={openNewAcct} className="brand-btn rounded-none gap-1" data-testid="br-new-account">
              <Plus className="w-4 h-4" /> New Account
            </Button>
          )}
          <PrintButton />
        </div>
      </div>

      <Tabs defaultValue="balances" className="w-full">
        <TabsList className="rounded-none">
          <TabsTrigger value="balances" data-testid="tab-balances">Account Balances</TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-ledger">Transactions Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label="Total Live Balance" value={totalBalance} accent="positive" testId="br-kpi-total" />
            <KpiCard label="Active Accounts" value={accounts.filter((a) => a.is_active).length} testId="br-kpi-active" />
            <KpiCard label="Inactive Accounts" value={accounts.filter((a) => !a.is_active).length} testId="br-kpi-inactive" />
          </div>

          {accounts.length === 0 ? (
            <div className="swiss-card p-10 text-center text-sm text-[var(--muted)]" data-testid="br-empty">
              No accounts yet. {isAdmin ? 'Click New Account above to add your first bank/cash account.' : "Ask an admin to add accounts."}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((a) => {
                const meta = TYPE_META[a.type] || TYPE_META.bank;
                const Icon = meta.icon;
                return (
                  <div key={a.id} className={`swiss-card p-5 ${!a.is_active ? "opacity-60" : ""}`} data-testid={`br-acct-${a.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon size={18} className="text-[var(--muted)]" />
                        <div>
                          <div className="font-heading font-bold text-base leading-tight">{a.name}</div>
                          <Badge className={`mt-1 rounded-none text-[10px] uppercase border ${meta.tone}`}>{meta.label}</Badge>
                        </div>
                      </div>
                      {!a.is_active && <Badge className="rounded-none bg-gray-100 border-gray-300 text-gray-600">Inactive</Badge>}
                    </div>
                    {a.type === "bank" && (
                      <div className="text-xs text-[var(--muted)] mt-2 space-y-0.5 num">
                        <div>A/C: {a.account_no}</div>
                        <div>IFSC: {a.ifsc}</div>
                      </div>
                    )}
                    {a.type === "upi_wallet" && (
                      <div className="text-xs text-[var(--muted)] mt-2 num">UPI: {a.upi_id}</div>
                    )}
                    <div className="mt-3 pt-3 border-t border-[var(--border)]">
                      <div className="overline text-[10px]">Current Balance</div>
                      <div className="num font-black text-2xl mt-0.5" data-testid={`br-balance-${a.id}`}>
                        {inr(a.current_balance)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                      <Button size="sm" variant="outline" onClick={() => openDeposit(a)} className="rounded-none gap-1 flex-1" data-testid={`br-deposit-${a.id}`}>
                        <ArrowDown className="w-3.5 h-3.5" /> Deposit
                      </Button>
                      {isAdmin && (
                        <Button size="sm" variant="outline" onClick={() => openEditAcct(a)} className="rounded-none" data-testid={`br-edit-${a.id}`}>
                          <Settings className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ledger" className="space-y-4 mt-4">
          <div className="swiss-card p-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
              <div>
                <Label className="text-xs">Account</Label>
                <Select
                  value={filter.account_id || "__all__"}
                  onValueChange={(v) => setFilter({ ...filter, account_id: v === "__all__" ? "" : v })}
                >
                  <SelectTrigger data-testid="br-filter-account"><SelectValue placeholder="All Accounts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Accounts</SelectItem>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select
                  value={filter.source || "__all__"}
                  onValueChange={(v) => setFilter({ ...filter, source: v === "__all__" ? "" : v })}
                >
                  <SelectTrigger data-testid="br-filter-source"><SelectValue placeholder="All Types" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Types</SelectItem>
                    {Object.entries(SOURCE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} data-testid="br-filter-from" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} data-testid="br-filter-to" />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Search (vendor / center / remarks)</Label>
                <Input placeholder="Type to search…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} data-testid="br-filter-search" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label="Credits" value={txnTotals.total_credit} accent="positive" testId="br-kpi-credit" />
            <KpiCard label="Debits" value={txnTotals.total_debit} accent="negative" testId="br-kpi-debit" />
            <KpiCard label="Net" value={txnTotals.net} accent={txnTotals.net >= 0 ? "positive" : "negative"} testId="br-kpi-net" />
          </div>

          <div className="swiss-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="br-ledger-table">
                <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Account</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Vendor / Payee</th>
                    <th className="text-left px-3 py-2">Center</th>
                    <th className="text-left px-3 py-2">Remarks</th>
                    <th className="text-right px-3 py-2">Debit</th>
                    <th className="text-right px-3 py-2">Credit</th>
                    <th className="text-right px-3 py-2">Balance</th>
                    <th className="text-left px-3 py-2">Recorded By</th>
                  </tr>
                </thead>
                <tbody>
                  {txnLoading && (
                    <tr><td colSpan={10} className="text-center py-8 text-[var(--muted)]">Loading…</td></tr>
                  )}
                  {!txnLoading && txns.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-8 text-[var(--muted)]">No transactions match the filter.</td></tr>
                  )}
                  {!txnLoading && txns.map((t) => (
                    <tr key={t.id} className="border-t border-[var(--border)]" data-testid={`br-row-${t.id}`}>
                      <td className="px-3 py-2 num text-xs">{t.date}</td>
                      <td className="px-3 py-2 text-xs">{t.account_name}</td>
                      <td className="px-3 py-2 text-xs">
                        <Badge className="rounded-none text-[10px] bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]">
                          {SOURCE_LABEL[t.source] || t.source}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">{t.vendor_name || "—"}</td>
                      <td className="px-3 py-2 text-xs">{t.center_name || "—"}</td>
                      <td className="px-3 py-2 text-xs max-w-md truncate" title={t.remarks}>{t.remarks}</td>
                      <td className="px-3 py-2 num text-xs text-right text-red-600">{t.direction === "debit" ? inr(t.amount) : "—"}</td>
                      <td className="px-3 py-2 num text-xs text-right text-green-700">{t.direction === "credit" ? inr(t.amount) : "—"}</td>
                      <td className="px-3 py-2 num text-xs text-right font-semibold">{inr(t.balance_after)}</td>
                      <td className="px-3 py-2 text-xs">{t.created_by_name || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Account dialog */}
      <Dialog open={acctDlgOpen} onOpenChange={setAcctDlgOpen}>
        <DialogContent className="rounded-none max-w-lg" data-testid="br-acct-dialog">
          <DialogHeader><DialogTitle>{editingAcctId ? "Edit Account" : "New Bank/Cash Account"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Type *</Label>
              <Select value={acctForm.type} onValueChange={(v) => setAcctForm({ ...acctForm, type: v })}>
                <SelectTrigger data-testid="br-acct-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank Account</SelectItem>
                  <SelectItem value="cash">Cash-in-Hand</SelectItem>
                  <SelectItem value="upi_wallet">UPI Wallet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Display Name *</Label>
              <Input value={acctForm.name} onChange={(e) => setAcctForm({ ...acctForm, name: e.target.value })} placeholder="e.g., SBI Current 1234" data-testid="br-acct-name" />
            </div>
            {acctForm.type === "bank" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Bank Name</Label>
                  <Input value={acctForm.bank_name || ""} onChange={(e) => setAcctForm({ ...acctForm, bank_name: e.target.value })} placeholder="SBI" data-testid="br-acct-bank" />
                </div>
                <div>
                  <Label className="text-xs">A/C No *</Label>
                  <Input value={acctForm.account_no || ""} onChange={(e) => setAcctForm({ ...acctForm, account_no: e.target.value })} data-testid="br-acct-no" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">IFSC *</Label>
                  <Input value={acctForm.ifsc || ""} onChange={(e) => setAcctForm({ ...acctForm, ifsc: e.target.value.toUpperCase() })} data-testid="br-acct-ifsc" />
                </div>
              </div>
            )}
            {acctForm.type === "upi_wallet" && (
              <div>
                <Label className="text-xs">UPI ID *</Label>
                <Input value={acctForm.upi_id || ""} onChange={(e) => setAcctForm({ ...acctForm, upi_id: e.target.value })} placeholder="user@upi" data-testid="br-acct-upi" />
              </div>
            )}
            {!editingAcctId && (
              <div>
                <Label className="text-xs">Opening Balance</Label>
                <Input type="number" min="0" step="0.01" value={acctForm.opening_balance} onChange={(e) => setAcctForm({ ...acctForm, opening_balance: e.target.value })} data-testid="br-acct-opening" />
                <p className="text-xs text-[var(--muted)] mt-1">This will be recorded as an Opening Balance credit in the ledger.</p>
              </div>
            )}
            <div>
              <Label className="text-xs">Remarks</Label>
              <Textarea rows={2} value={acctForm.remarks || ""} onChange={(e) => setAcctForm({ ...acctForm, remarks: e.target.value })} data-testid="br-acct-remarks" />
            </div>
            {editingAcctId && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={acctForm.is_active} onChange={(e) => setAcctForm({ ...acctForm, is_active: e.target.checked })} data-testid="br-acct-active" />
                Account is active (uncheck to hide from selection lists)
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcctDlgOpen(false)} disabled={acctBusy} className="rounded-none">Cancel</Button>
            <Button onClick={saveAcct} disabled={acctBusy} className="brand-btn rounded-none" data-testid="br-acct-save">
              {acctBusy ? "Saving…" : editingAcctId ? "Update" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deposit dialog */}
      <Dialog open={depDlgOpen} onOpenChange={setDepDlgOpen}>
        <DialogContent className="rounded-none max-w-md" data-testid="br-deposit-dialog">
          <DialogHeader><DialogTitle>Deposit to {depTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Amount *</Label>
              <Input type="number" min="0" step="0.01" value={depForm.amount} onChange={(e) => setDepForm({ ...depForm, amount: e.target.value })} data-testid="br-dep-amount" />
              <div className="text-xs text-[var(--muted)] mt-1">Current: {inr(depTarget?.current_balance || 0)} → New: <b>{inr((Number(depTarget?.current_balance || 0)) + (parseFloat(depForm.amount || "0") || 0))}</b></div>
            </div>
            <div>
              <Label className="text-xs">Source label (optional)</Label>
              <Input value={depForm.source_label} onChange={(e) => setDepForm({ ...depForm, source_label: e.target.value })} placeholder="e.g., Milestone received BOCWW" data-testid="br-dep-source" />
            </div>
            <div>
              <Label className="text-xs">Remarks *</Label>
              <Textarea rows={3} value={depForm.remarks} onChange={(e) => setDepForm({ ...depForm, remarks: e.target.value })} data-testid="br-dep-remarks" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepDlgOpen(false)} disabled={depBusy} className="rounded-none">Cancel</Button>
            <Button onClick={submitDeposit} disabled={depBusy} className="brand-btn rounded-none" data-testid="br-dep-submit">
              {depBusy ? "Depositing…" : "Confirm Deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

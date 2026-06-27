import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { History, RefreshCw, Check, X, Globe } from "lucide-react";

// Admin/HR view of all login attempts (success + failures).
// Non-privileged users see only their own attempts.
export default function LoginHistory() {
  const [items, setItems] = useState([]);
  const [emailFilter, setEmailFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/auth/login-history", {
        params: emailFilter ? { email: emailFilter, limit: 500 } : { limit: 500 },
      });
      setItems(r.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const stats = items.reduce((s, r) => {
    s.total++;
    if (r.success) s.success++;
    else s.failure++;
    return s;
  }, { total: 0, success: 0, failure: 0 });

  const uniqueIps = new Set(items.map((r) => (r.ip || "").split(",")[0].trim())).size;

  return (
    <div className="space-y-5 p-6 max-w-6xl mx-auto" data-testid="login-history-page">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="overline">Audit</div>
          <h1 className="font-heading font-black tracking-tight text-3xl flex items-center gap-2 mt-1">
            <History size={28} className="text-[var(--brand)]" /> Login History
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            Tracks every login attempt — successful + failed — with IP, device & timestamp.
          </div>
        </div>
        <Button variant="outline" onClick={load} className="rounded-none gap-1" disabled={loading} data-testid="btn-refresh-logins">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="swiss-card p-3 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Label className="overline">Filter by Email</Label>
          <Input
            type="email" value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="user@example.com" className="rounded-none"
            data-testid="filter-email"
          />
        </div>
        <Button onClick={load} className="brand-btn rounded-none">Apply</Button>
        {emailFilter && <Button variant="outline" onClick={() => { setEmailFilter(""); setTimeout(load, 50); }} className="rounded-none">Clear</Button>}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="swiss-card p-3"><div className="overline">Total Attempts</div><div className="num font-bold text-2xl">{stats.total}</div></div>
        <div className="swiss-card p-3"><div className="overline">Success</div><div className="num font-bold text-2xl value-positive">{stats.success}</div></div>
        <div className="swiss-card p-3"><div className="overline">Failed</div><div className="num font-bold text-2xl value-negative">{stats.failure}</div></div>
        <div className="swiss-card p-3"><div className="overline">Unique IPs</div><div className="num font-bold text-2xl flex items-center gap-1"><Globe size={20} className="text-[var(--brand)]" />{uniqueIps}</div></div>
      </div>

      {/* List */}
      <div className="swiss-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--border)] overline bg-gray-50">
            <th className="text-left p-3">When</th>
            <th className="text-left p-3">Email</th>
            <th className="text-center p-3">Result</th>
            <th className="text-left p-3">IP Address</th>
            <th className="text-left p-3 hidden lg:table-cell">Device / Browser</th>
          </tr></thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 overline">No login attempts logged yet</td></tr>
            ) : items.map((r) => {
              const ipFirst = (r.ip || "").split(",")[0].trim() || "unknown";
              return (
                <tr key={r.id} className="border-b border-[var(--border)] hover:bg-gray-50" data-testid={`login-row-${r.id}`}>
                  <td className="p-3 num">{r.at ? new Date(r.at).toLocaleString("en-IN") : "—"}</td>
                  <td className="p-3 font-medium">{r.email}</td>
                  <td className="p-3 text-center">
                    {r.success ? (
                      <span className="inline-flex items-center gap-1 text-[var(--success)]"><Check size={14} /> <span className="overline text-[10px]">Success</span></span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--danger)]" title={r.reason || ""}><X size={14} /> <span className="overline text-[10px]">{r.reason || "Failed"}</span></span>
                    )}
                  </td>
                  <td className="p-3 num text-xs">{ipFirst}</td>
                  <td className="p-3 text-xs text-[var(--muted)] max-w-md truncate hidden lg:table-cell">{r.user_agent || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

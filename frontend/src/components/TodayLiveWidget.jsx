import React, { useEffect, useState } from "react";
import { Plane, UserPlus } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Same-day "pulse" widget shown on every dashboard: who is on leave today
 * and who is joining today. Refreshes at midnight-ish rollover by re-fetching
 * every 10 minutes. Renders nothing if both lists are empty to avoid clutter.
 */
export default function TodayLiveWidget() {
  const [data, setData] = useState({ on_leave: [], new_joinees: [] });

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const { data } = await api.get("/dashboard/today-live");
        if (!cancelled) setData(data || { on_leave: [], new_joinees: [] });
      } catch { /* best-effort */ }
    };
    fetchData();
    const t = setInterval(fetchData, 10 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const total = (data.on_leave?.length || 0) + (data.new_joinees?.length || 0);
  if (total === 0) return null;

  return (
    <div className="swiss-card p-4 space-y-3" data-testid="today-live-widget">
      <div className="overline font-heading font-bold flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
        Today · Live Pulse
      </div>

      {(data.on_leave?.length || 0) > 0 && (
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 mb-1.5">
            <Plane size={13} /> On Leave Today ({data.on_leave.length})
          </div>
          <div className="space-y-1">
            {data.on_leave.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs bg-amber-50 border border-amber-200 px-2 py-1" data-testid={`onleave-${s.id}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-[10px] text-[var(--muted)] truncate">{s.designation || s.employee_code || "—"}</div>
                </div>
                <span className="text-[10px] text-amber-900 truncate ml-2 max-w-[40%]" title={s.reason}>{s.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(data.new_joinees?.length || 0) > 0 && (
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 mb-1.5">
            <UserPlus size={13} /> New Joinees Today ({data.new_joinees.length})
          </div>
          <div className="space-y-1">
            {data.new_joinees.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs bg-emerald-50 border border-emerald-200 px-2 py-1" data-testid={`joinee-${s.id}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">🎉 {s.name}</div>
                  <div className="text-[10px] text-[var(--muted)] truncate">{s.designation || "—"}</div>
                </div>
                <span className="text-[10px] font-mono text-emerald-900 ml-2">{s.employee_code || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

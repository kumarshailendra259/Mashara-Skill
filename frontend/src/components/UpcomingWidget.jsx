import React, { useEffect, useState } from "react";
import { Cake, PartyPopper, CalendarDays } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Dashboard side widget listing upcoming birthdays (from staff.date_of_birth)
 * and holidays within the next 15 days. Runs on any dashboard the user lands
 * on so nobody misses a celebration or an off day.
 */
export default function UpcomingWidget() {
  const [data, setData] = useState({ birthdays: [], holidays: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/dashboard/upcoming", { params: { days: 15 } });
        if (!cancelled) setData(data || { birthdays: [], holidays: [] });
      } catch {
        // best-effort widget; keep the dashboard usable if the roster is empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const relDay = (days_away) => {
    if (days_away === 0) return "Today";
    if (days_away === 1) return "Tomorrow";
    return `in ${days_away}d`;
  };

  return (
    <div className="swiss-card p-4 space-y-4" data-testid="upcoming-widget">
      <div className="flex items-center gap-2">
        <CalendarDays size={16} className="text-[var(--brand)]" />
        <div className="overline font-heading font-bold">Upcoming (next 15 days)</div>
      </div>

      {/* Birthdays */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Cake size={14} className="text-pink-600" /> Birthdays
        </div>
        {loading ? (
          <div className="text-xs text-[var(--muted)]">Loading…</div>
        ) : data.birthdays.length === 0 ? (
          <div className="text-xs text-[var(--muted)]">No birthdays coming up</div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {data.birthdays.map((b) => (
              <li key={b.staff_id} className="py-1.5 flex items-center justify-between text-xs" data-testid={`birthday-${b.staff_id}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {b.name}
                    <span className="text-[var(--muted)] font-normal ml-1">turns {b.turning_age}</span>
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">{b.designation || ""}</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 border ${b.days_away === 0 ? "bg-pink-100 text-pink-800 border-pink-300 font-bold" : "bg-white text-[var(--muted)] border-[var(--border)]"}`}>
                  {relDay(b.days_away)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Holidays */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <PartyPopper size={14} className="text-emerald-600" /> Holidays
        </div>
        {loading ? (
          <div className="text-xs text-[var(--muted)]">Loading…</div>
        ) : data.holidays.length === 0 ? (
          <div className="text-xs text-[var(--muted)]">No holidays coming up</div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {data.holidays.map((h) => (
              <li key={h.id || h.date} className="py-1.5 flex items-center justify-between text-xs" data-testid={`holiday-${h.id || h.date}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{h.name}</div>
                  <div className="text-[10px] text-[var(--muted)]">{new Date(h.date).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 border border-emerald-200 bg-emerald-50 text-emerald-800">
                  {h.type || "holiday"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

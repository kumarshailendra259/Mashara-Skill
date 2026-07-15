import React, { useEffect, useState, useCallback } from "react";
import { Megaphone, X } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Sits at the top of every authenticated page. Shows unread HR announcements
 * with a blinking-dot indicator until the user dismisses them. Polls every
 * 60s so freshly published announcements light up without a reload.
 */
export default function AnnouncementBanner() {
  const [items, setItems] = useState([]);
  const [dismissedIds, setDismissedIds] = useState(new Set());

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/announcements/active");
      setItems(data || []);
    } catch {
      // silent — announcements are best-effort UI candy
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const dismiss = async (a) => {
    setDismissedIds((s) => new Set([...s, a.id]));
    try { await api.post(`/announcements/${a.id}/read`); } catch { /* best-effort */ }
  };

  const visible = items.filter((a) => !a.read && !dismissedIds.has(a.id));
  if (visible.length === 0) return null;

  const priorityCls = (p) => {
    if (p === "urgent") return "border-red-400 bg-red-50 text-red-900";
    if (p === "important") return "border-amber-400 bg-amber-50 text-amber-900";
    return "border-blue-300 bg-blue-50 text-blue-900";
  };

  return (
    <div className="border-b border-[var(--border)] bg-white" data-testid="announcement-banner">
      {visible.slice(0, 3).map((a) => (
        <div key={a.id} className={`flex items-start gap-3 px-4 py-2 border-l-4 ${priorityCls(a.priority)}`}>
          {/* Blinking indicator so the announcement clearly pulls attention */}
          <span className="relative mt-1 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-3 w-3 rounded-full bg-current opacity-60 animate-ping" />
            <Megaphone size={14} className="relative" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              {a.priority === "urgent" && <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.5">URGENT</span>}
              {a.priority === "important" && <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.5">IMPORTANT</span>}
              {a.title}
              <span className="text-[10px] font-normal opacity-70">· {a.created_by_name}</span>
            </div>
            <div className="text-xs mt-0.5 leading-relaxed">{a.body}</div>
          </div>
          <button
            type="button"
            onClick={() => dismiss(a)}
            className="shrink-0 p-1 rounded-none hover:bg-white/60"
            data-testid={`announcement-dismiss-${a.id}`}
            aria-label="Dismiss announcement"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

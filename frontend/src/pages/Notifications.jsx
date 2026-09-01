import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MessageSquare, Send, RefreshCw, Phone, CheckCircle2, XCircle, Clock } from "lucide-react";

const STATUS_TONE = {
  queued:      { cls: "bg-slate-100 text-slate-700 border-slate-300", icon: Clock, label: "Queued" },
  sending:     { cls: "bg-blue-100 text-blue-700 border-blue-300", icon: Clock, label: "Sending" },
  sent:        { cls: "bg-indigo-100 text-indigo-700 border-indigo-300", icon: Clock, label: "Sent" },
  delivered:   { cls: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: CheckCircle2, label: "Delivered" },
  read:        { cls: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: CheckCircle2, label: "Read" },
  failed:      { cls: "bg-red-100 text-red-700 border-red-300", icon: XCircle, label: "Failed" },
  undelivered: { cls: "bg-red-100 text-red-700 border-red-300", icon: XCircle, label: "Undelivered" },
};

export default function Notifications() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ channel: "sms", recipient: "", body: "", event_type: "manual" });
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);

  const loadConfig = async () => {
    try { const r = await api.get("/notifications/config"); setConfig(r.data); }
    catch { /* admin-only — hide config panel for non-admin */ }
  };
  const loadLogs = async () => {
    try { const r = await api.get("/notifications/logs?limit=100"); setLogs(r.data || []); }
    catch (e) { toast.error(formatError(e)); }
  };
  const syncStatus = async (silent = false) => {
    setSyncing(true);
    try {
      const r = await api.post("/notifications/sync-status");
      if (!silent && r.data.synced > 0) toast.success(`Synced ${r.data.synced} message${r.data.synced > 1 ? "s" : ""} from Twilio`);
      await loadLogs();
    } catch (e) { if (!silent) toast.error(formatError(e)); }
    finally { setSyncing(false); }
  };
  useEffect(() => {
    (async () => {
      await loadConfig();
      await loadLogs();
      // Auto-sync once on mount so users see fresh Twilio status even if the
      // async delivery webhook didn't reach us (e.g. env pointing at preview).
      await syncStatus(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    if (!form.recipient.trim()) { toast.error("Recipient phone required"); return; }
    if (!form.body.trim()) { toast.error("Message body required"); return; }
    setBusy(true);
    try {
      const r = await api.post("/notifications/send", form);
      toast.success(`Queued — ${r.data.message_sid}. Fetching real Twilio status…`);
      setForm({ ...form, body: "" });
      // Twilio needs a moment to move from queued → sent/delivered/failed.
      // Poll twice: at 2 s and 8 s for a snappy UX.
      await loadLogs();
      setTimeout(() => syncStatus(true), 2000);
      setTimeout(() => syncStatus(true), 8000);
    } catch (e) {
      toast.error(formatError(e));
    } finally { setBusy(false); }
  };

  const filtered = useMemo(
    () => filter === "all" ? logs : logs.filter((l) => l.channel === filter),
    [logs, filter],
  );

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto" data-testid="notifications-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="overline">Communications</div>
          <h1 className="font-heading font-black tracking-tight text-3xl flex items-center gap-2">
            <MessageSquare size={28} className="text-[var(--brand)]" />
            SMS & WhatsApp Notifications
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            Send Twilio SMS / WhatsApp messages and track delivery status.
          </div>
        </div>
        <Button variant="outline" onClick={loadLogs} className="rounded-none gap-1" data-testid="btn-refresh-logs">
          <RefreshCw size={14} /> Refresh
        </Button>
        <Button onClick={() => syncStatus(false)} disabled={syncing} className="brand-btn rounded-none gap-1" data-testid="btn-sync-twilio">
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync from Twilio"}
        </Button>
      </div>

      {/* Twilio config panel — admin only */}
      {config && (
        <div className="swiss-card p-4 border-l-4 border-purple-500" data-testid="notif-config">
          <div className="overline text-[10px] mb-2">Twilio Configuration</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><div className="overline text-[9px]">Status</div><div className="font-bold">{config.configured ? <span className="text-emerald-700">✓ Configured</span> : <span className="text-red-700">✗ Not Configured</span>}</div></div>
            <div><div className="overline text-[9px]">SMS From</div><div className="font-mono">{config.sms_from || "—"}</div></div>
            <div><div className="overline text-[9px]">WhatsApp From</div><div className="font-mono">{config.whatsapp_from || "—"}</div></div>
            <div><div className="overline text-[9px]">Webhook Base</div><div className="font-mono truncate" title={config.public_base}>{config.public_base || "—"}</div></div>
          </div>
        </div>
      )}

      {/* Sandbox alert — huge, prominent so nobody misses it. */}
      {config?.whatsapp_from?.includes("+14155238886") && (
        <div className="swiss-card p-4 border-l-4 border-amber-500 bg-amber-50/60" data-testid="sandbox-alert">
          <div className="flex items-start gap-3">
            <div className="bg-amber-500 text-white p-2 shrink-0"><MessageSquare size={18} /></div>
            <div className="flex-1 text-sm space-y-1.5">
              <div className="font-bold text-amber-900">⚠️ WhatsApp is in TWILIO SANDBOX mode</div>
              <div className="text-amber-900">
                Har recipient ko <b>ek baar</b> apne WhatsApp se ye message bhejna zaroori hai — warna message
                <span className="font-mono bg-red-100 text-red-800 px-1 mx-1">Error 63015 (channel not enabled)</span>
                ke saath fail hoga:
              </div>
              <div className="my-2 border border-amber-300 bg-white p-3 font-mono text-sm text-amber-900">
                📩 Send WhatsApp message: <b className="font-mono">join &lt;your-sandbox-code&gt;</b><br />
                &nbsp;&nbsp;&nbsp;&nbsp;To: <b className="font-mono">+1 415 523 8886</b>
              </div>
              <div className="text-[12px] text-amber-800">
                Sandbox code aapko Twilio Console → Messaging → <b>Try it out</b> → <b>Send a WhatsApp message</b> se milega
                (usually looks like <span className="font-mono bg-amber-100 px-1">join abc-defg</span>). Ek baar join karne ke baad recipient WhatsApp messages receive kar sakega. Production ke liye Twilio pe WhatsApp Business Sender register karna hoga.
              </div>
              <a
                href="https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn"
                target="_blank" rel="noreferrer"
                className="inline-block text-xs text-amber-900 underline mt-1"
              >
                → Twilio Sandbox setup guide
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Compose */}
      <div className="swiss-card p-5" data-testid="notif-compose">
        <div className="overline text-[10px] mb-3">Send a message</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Channel</Label>
            <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
              <SelectTrigger className="rounded-none" data-testid="channel-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sms">📱 SMS</SelectItem>
                <SelectItem value="whatsapp">💬 WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Recipient phone</Label>
            <Input
              value={form.recipient}
              onChange={(e) => setForm({ ...form, recipient: e.target.value })}
              placeholder="e.g. 9876543210 or +919876543210"
              className="rounded-none"
              data-testid="recipient-input"
            />
          </div>
          <div>
            <Label className="text-xs">Event tag (audit)</Label>
            <Input
              value={form.event_type}
              onChange={(e) => setForm({ ...form, event_type: e.target.value })}
              placeholder="e.g. bg_expiry, payroll_paid"
              className="rounded-none"
              data-testid="event-input"
            />
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-xs">Message</Label>
          <Textarea
            rows={4}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="e.g. BG-1042 expires in 30 days on 2026-10-01. Please initiate renewal."
            className="rounded-none"
            data-testid="body-input"
          />
          <div className="text-[10px] text-[var(--muted)] mt-1">
            {form.body.length} chars · SMS Unicode split at 70 chars, GSM-7 at 160 chars
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={send} disabled={busy} className="brand-btn rounded-none gap-1" data-testid="btn-send">
            {busy ? "Sending…" : <><Send size={14} /> Send</>}
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {[
          { key: "all", label: "All" },
          { key: "sms", label: "SMS" },
          { key: "whatsapp", label: "WhatsApp" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            data-testid={`filter-${t.key}`}
            className={`px-4 py-2 text-sm border-b-2 transition-colors -mb-px ${
              filter === t.key
                ? "border-[var(--brand)] text-[var(--brand)] font-semibold"
                : "border-transparent hover:text-[var(--brand)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Logs */}
      {filtered.length === 0 ? (
        <div className="swiss-card p-12 text-center overline">No messages yet.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => {
            const tone = STATUS_TONE[l.status] || STATUS_TONE.queued;
            const Icon = tone.icon;
            return (
              <div key={l.id} className="swiss-card p-3 flex items-start gap-3 flex-wrap" data-testid={`log-row-${l.id}`}>
                <div className="p-2 bg-slate-50">
                  <Phone size={14} className="text-slate-700" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="overline text-[10px] font-bold">{l.channel?.toUpperCase()}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 border ${tone.cls} inline-flex items-center gap-1`}>
                      <Icon size={10} /> {tone.label}
                    </span>
                    {l.event_type && <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 font-medium">{l.event_type}</span>}
                    <span className="font-mono text-xs text-slate-800">{l.recipient}</span>
                  </div>
                  <div className="text-sm text-slate-900 mt-1 whitespace-pre-wrap break-words">{l.body}</div>
                  <div className="text-[10px] text-[var(--muted)] mt-1 flex items-center gap-2 flex-wrap">
                    {l.message_sid && <span className="font-mono">SID: {l.message_sid.slice(0, 14)}…</span>}
                    {l.sent_by_name && <span>· by <b>{l.sent_by_name}</b></span>}
                    <span>· {new Date(l.created_at).toLocaleString("en-IN")}</span>
                    {l.error_code && <span className="text-red-700">· Err {l.error_code}: {l.error_message || "(no detail)"}</span>}
                  </div>
                  {/* Human-readable fix hint for the most common Twilio errors. */}
                  {l.error_code == 63015 && (
                    <div className="mt-2 text-[11px] bg-amber-50 border border-amber-300 text-amber-900 px-2 py-1.5">
                      🩹 <b>Fix:</b> Recipient ne abhi tak WhatsApp Sandbox join nahi kiya. Unse kehna hai ki <b className="font-mono">join &lt;sandbox-code&gt;</b> message bhejein Twilio ke sandbox number pe (<span className="font-mono">+14155238886</span>).
                    </div>
                  )}
                  {(l.error_code == 30003 || l.error_code == 30005 || l.error_code == 30006) && (
                    <div className="mt-2 text-[11px] bg-amber-50 border border-amber-300 text-amber-900 px-2 py-1.5">
                      🩹 <b>Fix:</b> Recipient device / carrier reachable nahi hai. Number verify karo aur dobara try karo.
                    </div>
                  )}
                  {l.error_code == 30008 && (
                    <div className="mt-2 text-[11px] bg-amber-50 border border-amber-300 text-amber-900 px-2 py-1.5">
                      🩹 <b>Fix:</b> Number invalid ya unreachable — Twilio ne "Unknown error" return kiya. Real, verified E.164 number try karo.
                    </div>
                  )}
                  {l.error_code == 21608 && (
                    <div className="mt-2 text-[11px] bg-amber-50 border border-amber-300 text-amber-900 px-2 py-1.5">
                      🩹 <b>Fix:</b> Twilio trial account — recipient number Twilio Console → Verified Caller IDs me add karo pehle.
                    </div>
                  )}
                  {l.error_code == 63016 && (
                    <div className="mt-2 text-[11px] bg-amber-50 border border-amber-300 text-amber-900 px-2 py-1.5">
                      🩹 <b>Fix:</b> Business-initiated WhatsApp message 24-hour window ke bahar bheja — approved Content Template use karo (<span className="font-mono">content_sid</span>).
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

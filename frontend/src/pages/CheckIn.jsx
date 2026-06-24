import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Camera, MapPin, CheckCircle2, LogOut, RefreshCw } from "lucide-react";

const STATUS_OPTIONS = [
  { v: "present", label: "Present" },
  { v: "half", label: "Half Day" },
  { v: "leave", label: "On Leave" },
];

export default function CheckIn() {
  const { user, loading, login, logout } = useAuth();
  const nav = useNavigate();

  // Login form (shown when not logged in)
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [busyLogin, setBusyLogin] = useState(false);

  // Check-in state
  const [todayInfo, setTodayInfo] = useState(null); // { staff, attendance }
  const [coords, setCoords] = useState(null); // { latitude, longitude, accuracy }
  const [locErr, setLocErr] = useState("");
  const [selfie, setSelfie] = useState(null); // { path, filename, size, preview }
  const [status, setStatus] = useState("present");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingSelfie, setUploadingSelfie] = useState(false);
  const selfieRef = useRef(null);

  const loadToday = async () => {
    try {
      const { data } = await api.get("/attendance/today");
      setTodayInfo(data);
    } catch (e) {
      console.warn("loadToday failed:", e?.message || e);
    }
  };

  useEffect(() => {
    if (user && user !== false) loadToday();
  }, [user]);

  const doLogin = async (e) => {
    e.preventDefault();
    setBusyLogin(true);
    const r = await login(email, pwd);
    setBusyLogin(false);
    if (!r.ok) toast.error(r.error);
  };

  const captureLocation = () => {
    setLocErr("");
    if (!navigator.geolocation) {
      setLocErr("Geolocation is not supported by this device/browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        toast.success("Location captured");
      },
      (err) => {
        setLocErr(err.message || "Could not capture location");
        toast.error(err.message || "Location permission denied");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const onSelfieChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadingSelfie(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      // Local preview for instant feedback
      const reader = new FileReader();
      reader.onload = () => setSelfie({ ...data, preview: reader.result });
      reader.readAsDataURL(f);
    } catch (err) {
      toast.error(formatError(err));
    } finally {
      setUploadingSelfie(false);
      if (selfieRef.current) selfieRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!coords) { toast.error("Please capture your location first"); return; }
    if (!selfie) { toast.error("Please take a selfie first"); return; }
    setSubmitting(true);
    try {
      await api.post("/attendance/self", {
        status,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        selfie_path: selfie.path,
        selfie_filename: selfie.filename,
      });
      toast.success("Attendance marked");
      await loadToday();
      // reset local capture state so the user can see "Already marked" panel
      setCoords(null);
      setSelfie(null);
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-white"><div className="overline">Loading…</div></div>;
  }

  // Not logged in → mobile login form
  if (!user || user === false) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg)]" data-testid="checkin-login">
        <div className="px-5 py-6 bg-[var(--brand)] text-white">
          <div className="overline opacity-80">Mashara Skills · Attendance</div>
          <h1 className="font-heading font-black text-2xl mt-1 leading-tight">Check-In</h1>
          <p className="text-xs opacity-80 mt-1">Sign in with your staff account to mark today&apos;s attendance.</p>
        </div>
        <form onSubmit={doLogin} className="p-5 space-y-4 max-w-md w-full mx-auto">
          <div className="space-y-2">
            <Label className="overline">Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-none h-12 text-base" autoFocus data-testid="checkin-email" />
          </div>
          <div className="space-y-2">
            <Label className="overline">Password</Label>
            <Input type="password" required value={pwd} onChange={(e) => setPwd(e.target.value)} className="rounded-none h-12 text-base" data-testid="checkin-password" />
          </div>
          <Button type="submit" disabled={busyLogin} className="brand-btn rounded-none w-full h-12 text-base" data-testid="checkin-login-btn">
            {busyLogin ? "Signing in…" : "Sign In"}
          </Button>
          <button type="button" onClick={() => nav("/")} className="block w-full text-center text-sm text-[var(--muted)] hover:underline">
            Open full portal →
          </button>
        </form>
      </div>
    );
  }

  // Logged in but not mapped to staff
  if (todayInfo && !todayInfo.staff) {
    return (
      <div className="min-h-screen p-5 bg-[var(--bg)]" data-testid="checkin-not-staff">
        <div className="swiss-card p-6 max-w-md mx-auto text-center">
          <div className="font-heading font-bold text-lg">No staff profile linked</div>
          <p className="text-sm text-[var(--muted)] mt-2">Your login is active, but admin hasn&apos;t linked you to a staff record yet. Please contact your admin to enable check-in.</p>
          <Button onClick={() => { logout(); }} variant="outline" className="rounded-none mt-4 gap-2"><LogOut size={14} /> Sign out</Button>
        </div>
      </div>
    );
  }

  const alreadyMarked = todayInfo?.attendance;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" });
  const fileBase = process.env.REACT_APP_BACKEND_URL;

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-10" data-testid="checkin-page">
      {/* Header */}
      <div className="px-5 py-5 bg-[var(--brand)] text-white">
        <div className="flex items-start justify-between">
          <div>
            <div className="overline opacity-80">Mashara Skills · Attendance</div>
            <h1 className="font-heading font-black text-2xl mt-1 leading-tight">Hi, {todayInfo?.staff?.name || user.name}</h1>
            <p className="text-xs opacity-90 mt-1">{today}</p>
          </div>
          <button onClick={() => logout()} className="opacity-80 hover:opacity-100" title="Sign out" data-testid="checkin-logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto space-y-4">
        {alreadyMarked ? (
          <div className="swiss-card p-4 border-l-4 border-[var(--success)]" data-testid="already-marked">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-[var(--success)] shrink-0 mt-0.5" size={22} />
              <div className="flex-1">
                <div className="font-heading font-bold text-lg">You&apos;re checked in today</div>
                <div className="text-sm mt-1">
                  Status: <span className="font-medium uppercase">{alreadyMarked.status}</span>
                </div>
                {alreadyMarked.marked_at && (
                  <div className="text-xs text-[var(--muted)] mt-0.5">At {new Date(alreadyMarked.marked_at).toLocaleString()}</div>
                )}
                {alreadyMarked.latitude != null && (
                  <a
                    href={`https://www.google.com/maps?q=${alreadyMarked.latitude},${alreadyMarked.longitude}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[var(--brand)] hover:underline mt-2"
                  >
                    <MapPin size={14} /> View location
                  </a>
                )}
                {alreadyMarked.selfie_path && (
                  <img src={`${fileBase}/api/files/view?path=${encodeURIComponent(alreadyMarked.selfie_path)}`} alt="selfie" className="mt-3 w-32 h-32 object-cover border border-[var(--border)]" />
                )}
              </div>
            </div>
            <Button variant="outline" onClick={loadToday} className="rounded-none w-full mt-4 gap-2"><RefreshCw size={14} /> Refresh</Button>
          </div>
        ) : (
          <>
            {/* Step 1: Location */}
            <div className="swiss-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="overline">Step 1</div>
                  <div className="font-heading font-bold text-lg leading-tight">Capture Location</div>
                </div>
                {coords && <CheckCircle2 className="text-[var(--success)]" size={20} />}
              </div>
              {coords ? (
                <div className="mt-3 text-sm space-y-1">
                  <div><span className="overline text-xs">Lat:</span> <span className="num">{coords.latitude.toFixed(6)}</span></div>
                  <div><span className="overline text-xs">Lng:</span> <span className="num">{coords.longitude.toFixed(6)}</span></div>
                  <div><span className="overline text-xs">Accuracy:</span> <span className="num">±{Math.round(coords.accuracy)} m</span></div>
                  <a href={`https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline text-sm">
                    <MapPin size={12} /> Preview on map
                  </a>
                </div>
              ) : (
                <Button onClick={captureLocation} className="brand-btn rounded-none w-full h-12 mt-3 gap-2" data-testid="btn-capture-location">
                  <MapPin size={16} /> Get my current location
                </Button>
              )}
              {locErr && <div className="mt-2 text-xs text-[var(--danger)]">{locErr}</div>}
            </div>

            {/* Step 2: Selfie */}
            <div className="swiss-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="overline">Step 2</div>
                  <div className="font-heading font-bold text-lg leading-tight">Take Selfie</div>
                </div>
                {selfie && <CheckCircle2 className="text-[var(--success)]" size={20} />}
              </div>
              {selfie ? (
                <div className="mt-3 flex items-center gap-3">
                  <img src={selfie.preview} alt="selfie" className="w-24 h-24 object-cover border border-[var(--border)]" />
                  <div className="flex-1 text-sm">
                    <div className="font-medium truncate">{selfie.filename}</div>
                    <div className="overline text-xs">{(selfie.size / 1024).toFixed(0)} KB</div>
                    <button type="button" onClick={() => { setSelfie(null); selfieRef.current?.click(); }} className="text-[var(--brand)] hover:underline text-sm mt-1">Retake</button>
                  </div>
                </div>
              ) : (
                <>
                  <input ref={selfieRef} type="file" accept="image/*" capture="user" hidden onChange={onSelfieChange} data-testid="selfie-input" />
                  <Button onClick={() => selfieRef.current?.click()} disabled={uploadingSelfie} className="brand-btn rounded-none w-full h-12 mt-3 gap-2" data-testid="btn-take-selfie">
                    <Camera size={16} /> {uploadingSelfie ? "Uploading…" : "Open camera"}
                  </Button>
                </>
              )}
            </div>

            {/* Step 3: Status + submit */}
            <div className="swiss-card p-4">
              <div className="overline">Step 3</div>
              <div className="font-heading font-bold text-lg leading-tight">Confirm</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {STATUS_OPTIONS.map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setStatus(o.v)}
                    data-testid={`status-${o.v}`}
                    className={`py-2 text-sm border ${
                      status === o.v
                        ? "border-[var(--brand)] bg-[#f3f5fb] text-[var(--brand)] font-medium"
                        : "border-[var(--border)] text-[var(--muted)]"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <Button
                onClick={submit}
                disabled={submitting || !coords || !selfie}
                className="brand-btn rounded-none w-full h-14 mt-4 text-base font-bold gap-2"
                data-testid="btn-checkin-submit"
              >
                <CheckCircle2 size={18} /> {submitting ? "Saving…" : "Check In"}
              </Button>
              {(!coords || !selfie) && (
                <div className="mt-2 text-xs text-[var(--muted)] text-center">
                  Complete Step 1 (location) and Step 2 (selfie) first.
                </div>
              )}
            </div>
          </>
        )}

        <div className="text-center pt-2">
          <button type="button" onClick={() => nav("/")} className="text-sm text-[var(--muted)] hover:underline">
            Open full portal →
          </button>
        </div>
      </div>
    </div>
  );
}

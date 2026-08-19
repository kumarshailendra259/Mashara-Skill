import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Printer, RefreshCw, TrendingUp, MapPin, GraduationCap,
  Users, BarChart3, PieChart as PieIcon, LineChart as LineIcon,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

/**
 * Reports & Analytics Tab (Phase 5)
 * ----------------------------------
 * Interactive dashboard with 4 Recharts + printable Daily Report.
 * The whole page is print-friendly — clicking "Print / Save PDF" opens the
 * browser print dialog with a report-only stylesheet applied.
 */

const CHART_PALETTE = ["#1E4EAB", "#0F766E", "#B45309", "#B91C1C", "#7C3AED", "#0EA5E9", "#DC2626", "#059669"];
const num = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("en-IN");

export default function ReportsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const printRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/mis/reports/daily");
      setData(r.data);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const printReport = () => {
    // The `print-only` / `print-hide` CSS in index.css lets the browser render
    // just the printable area. Users then Save as PDF from the dialog.
    window.print();
  };

  if (loading && !data) return <div className="text-xs text-[var(--muted)]">Loading report…</div>;
  if (!data) return null;

  const e = data.executive;
  const topProjects = (data.by_project || []).slice(0, 8);
  const topCenters  = (data.by_center  || []).slice(0, 10);
  const topDistricts= (data.by_district|| []).slice(0, 8);
  const monthlyTrend= data.monthly_mob_trend || [];

  return (
    <div className="space-y-5" data-testid="mis-reports-tab">
      {/* Print-only styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #mis-print-area, #mis-print-area * { visibility: visible; }
          #mis-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; }
          .print-hide { display: none !important; }
          .print-brk { page-break-after: always; }
        }
      `}</style>

      {/* Action bar (hidden in print) */}
      <div className="flex justify-between items-center print-hide">
        <div>
          <div className="overline">Daily Report · {data.today}</div>
          <div className="font-heading font-black text-2xl">Reports &amp; Analytics</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} className="rounded-none gap-1" data-testid="reports-refresh"><RefreshCw size={12} /> Refresh</Button>
          <Button size="sm" onClick={printReport} className="brand-btn rounded-none gap-1" data-testid="reports-print"><Printer size={13} /> Print / Save PDF</Button>
        </div>
      </div>

      {/* Printable area */}
      <div id="mis-print-area" ref={printRef}>
        {/* Report Header */}
        <div className="border-b-4 border-[var(--brand)] pb-3 mb-4">
          <div className="text-[10px] tracking-widest text-[var(--muted)]">MIS · JHARKHAND SKILLS</div>
          <div className="font-heading font-black text-3xl">Daily Report</div>
          <div className="text-sm text-[var(--muted)]">Generated {new Date(data.generated_at).toLocaleString("en-IN")} · Report Date: <b>{data.today}</b></div>
        </div>

        {/* Executive Summary */}
        <div className="mb-6">
          <div className="overline mb-2">Executive Summary</div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {[
              ["Total Projects",    e.total_projects],
              ["Total Centers",     e.total_centers],
              ["Accredited",        e.accredited_centers],
              ["Total Target",      e.total_target],
              ["Achieved",          e.target_achieved, "green"],
              ["Remaining",         e.remaining_target, "amber"],
              ["Batches (Active)",  `${e.total_batches} (${e.active_batches})`],
              ["Enrolled",          e.total_enrolled],
              ["Certified",         e.total_certified, "green"],
              ["Placement",         e.total_placement, "green"],
              ["Dropout",           e.total_dropout, "red"],
              ["Achievement %",     `${e.achievement_pct}%`, "brand"],
              ["Certification %",   `${e.certification_pct}%`, "green"],
              ["Placement %",       `${e.placement_pct}%`, "green"],
              ["Today Mobilisation",e.today_mobilisation],
              ["Today Distance",    `${e.today_distance_km} km`],
            ].map(([l, v, tone], i) => (
              <div key={i} className="swiss-card p-3 border-l-4 border-[var(--brand)]/40">
                <div className="overline text-[9px]">{l}</div>
                <div className={`font-heading font-black text-lg mt-0.5 ${
                  tone === "green" ? "text-emerald-700" :
                  tone === "red"   ? "text-red-700" :
                  tone === "amber" ? "text-amber-700" : "text-[var(--brand)]"
                }`}>{typeof v === "number" ? v.toLocaleString("en-IN") : v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Charts row 1 — Target vs Achievement + District performance */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          <div className="swiss-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="overline flex items-center gap-1"><BarChart3 size={12} /> Target vs Achievement · By Project</div>
            </div>
            {topProjects.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topProjects}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="target"    name="Target"    fill="#1E4EAB" />
                  <Bar dataKey="certified" name="Certified" fill="#0F766E" />
                  <Bar dataKey="placement" name="Placement" fill="#B45309" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="swiss-card p-4">
            <div className="overline flex items-center gap-1"><MapPin size={12} /> District-wise Performance</div>
            {topDistricts.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topDistricts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="enrolled"  name="Enrolled"  fill="#7C3AED" />
                  <Bar dataKey="certified" name="Certified" fill="#0F766E" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Charts row 2 — Center-wise Enrollment + Monthly Mobilization Trend */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          <div className="swiss-card p-4">
            <div className="overline flex items-center gap-1"><Users size={12} /> Center-wise Enrollment (Top 10)</div>
            {topCenters.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topCenters}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={70} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="enrolled" name="Enrolled" fill="#1E4EAB" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="swiss-card p-4">
            <div className="overline flex items-center gap-1"><LineIcon size={12} /> Monthly Mobilization Trend (30d)</div>
            {monthlyTrend.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="left"  type="monotone" dataKey="mobilisation" name="Mobilisation" stroke="#1E4EAB" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="right" type="monotone" dataKey="distance_km"  name="Distance (km)" stroke="#B45309" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Project-wise Performance Table */}
        <div className="mb-6">
          <div className="overline mb-2">Project-wise Performance</div>
          <div className="swiss-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-[var(--border)]">
                <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[9px]">
                  <th>Project</th><th className="text-right">Batches</th>
                  <th className="text-right">Target</th><th className="text-right">Enrolled</th>
                  <th className="text-right">Certified</th><th className="text-right">Placement</th>
                  <th className="text-right">Certif %</th><th className="text-right">Ach %</th>
                </tr>
              </thead>
              <tbody>
                {topProjects.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-[var(--muted)]">No project data yet</td></tr>}
                {topProjects.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--border)]/50 [&>td]:p-2 hover:bg-gray-50">
                    <td className="font-semibold">{r.label}</td>
                    <td className="text-right">{r.batches}</td>
                    <td className="text-right">{num(r.target)}</td>
                    <td className="text-right">{num(r.enrolled)}</td>
                    <td className="text-right text-emerald-700 font-bold">{num(r.certified)}</td>
                    <td className="text-right">{num(r.placement)}</td>
                    <td className="text-right">{r.certification_pct}%</td>
                    <td className="text-right">{r.achievement_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Center-wise Performance Table */}
        <div className="mb-6">
          <div className="overline mb-2">Center-wise Performance (Top 10)</div>
          <div className="swiss-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-[var(--border)]">
                <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[9px]">
                  <th>Center</th><th className="text-right">Batches</th>
                  <th className="text-right">Target</th><th className="text-right">Enrolled</th>
                  <th className="text-right">Certified</th><th className="text-right">Placement</th>
                  <th className="text-right">Certif %</th>
                </tr>
              </thead>
              <tbody>
                {topCenters.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--muted)]">No center data yet</td></tr>}
                {topCenters.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--border)]/50 [&>td]:p-2 hover:bg-gray-50">
                    <td className="font-semibold">{r.label}</td>
                    <td className="text-right">{r.batches}</td>
                    <td className="text-right">{num(r.target)}</td>
                    <td className="text-right">{num(r.enrolled)}</td>
                    <td className="text-right text-emerald-700 font-bold">{num(r.certified)}</td>
                    <td className="text-right">{num(r.placement)}</td>
                    <td className="text-right">{r.certification_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Exception / Alerts */}
        {data.open_alerts?.length > 0 && (
          <div className="mb-2">
            <div className="overline mb-2">Exceptions &amp; Alerts</div>
            <div className="swiss-card p-3 border-l-4 border-red-500">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {data.open_alerts.map((a) => (
                  <div key={a.key} className={`p-2 border ${
                    a.severity === "red" ? "border-red-300 bg-red-50" :
                    a.severity === "amber" ? "border-amber-300 bg-amber-50" :
                    "border-blue-300 bg-blue-50"
                  }`}>
                    <div className="overline text-[9px]">{a.label}</div>
                    <div className={`font-heading font-black text-lg ${
                      a.severity === "red" ? "text-red-700" : a.severity === "amber" ? "text-amber-700" : "text-blue-700"
                    }`}>{a.count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 text-[10px] text-[var(--muted)] text-center border-t border-[var(--border)] pt-2">
          Mashara Finance · Automated MIS Daily Report · {new Date().toLocaleDateString("en-IN")}
        </div>
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-64 flex items-center justify-center text-[var(--muted)] text-xs">
      No data yet — populate project / mobilization records first.
    </div>
  );
}

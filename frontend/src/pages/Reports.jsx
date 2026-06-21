import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { inr } from "@/lib/i18n";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import PrintButton from "@/components/PrintButton";

const DIMS = ["company", "partner", "center", "project", "item"];

export default function Reports() {
  const { t } = useLang();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get("/dashboard/summary").then((r) => setSummary(r.data)).catch(() => {});
  }, []);

  const exportTable = (key) => {
    if (!summary) return;
    const rows = summary[`by_${key}`] || [];
    const header = [t(key), t("investment"), t("income"), t("expense"), t("profit")];
    const lines = [header, ...rows.map((r) => [r.name, r.investment, r.income, r.expense, r.profit])]
      .map((row) => row.map((c) => `"${String(c ?? "")}"`).join(","))
      .join("\n");
    const blob = new Blob([lines], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `report_${key}_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" data-testid="reports-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">{t("reports")}</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t("reports")}</h1>
        </div>
        <PrintButton />
      </div>

      <Tabs defaultValue="company">
        <TabsList className="rounded-none bg-transparent border-b border-[var(--border)] p-0 h-auto">
          {DIMS.map((d) => (
            <TabsTrigger key={d} value={d} data-testid={`report-tab-${d}`}
              className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand)] data-[state=active]:text-[var(--brand)] px-4 py-2">
              {t(d)}
            </TabsTrigger>
          ))}
        </TabsList>
        {DIMS.map((d) => {
          const rows = summary?.[`by_${d}`] || [];
          return (
            <TabsContent key={d} value={d} className="mt-4">
              <div className="flex justify-end mb-3">
                <Button variant="outline" onClick={() => exportTable(d)} className="rounded-none gap-2" data-testid={`export-${d}`}>
                  <Download size={14} /> {t("export_csv")}
                </Button>
              </div>
              <div className="swiss-card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] overline bg-gray-50">
                      <th className="text-left p-3">{t(d)}</th>
                      <th className="text-right p-3">{t("investment")}</th>
                      <th className="text-right p-3">{t("income")}</th>
                      <th className="text-right p-3">{t("expense")}</th>
                      <th className="text-right p-3">{t("profit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-8 overline">{t("no_data")}</td></tr>
                    ) : rows.map((r) => (
                      <tr key={r.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                        <td className="p-3 font-medium">{r.name}</td>
                        <td className="p-3 num">{inr(r.investment)}</td>
                        <td className="p-3 num value-positive">{inr(r.income)}</td>
                        <td className="p-3 num value-negative">{inr(r.expense)}</td>
                        <td className={`p-3 num font-semibold ${r.profit >= 0 ? "value-positive" : "value-negative"}`}>{inr(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

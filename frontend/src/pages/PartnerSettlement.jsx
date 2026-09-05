import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import SettlementSection from "@/components/SettlementSection";

export default function PartnerSettlement() {
  const { t } = useLang();
  const [settlement, setSettlement] = useState(null);

  const loadSettlement = () => {
    api.get("/dashboard/settlement", { params: { include_history: true } })
      .then((r) => setSettlement(r.data))
      .catch(() => setSettlement(null));
  };

  useEffect(() => { loadSettlement(); }, []);

  return (
    <div className="space-y-6" data-testid="partner-settlement-page">
      <div>
        <div className="overline">{t("grp_partnerships")}</div>
        <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t("partner_settlement")}</h1>
      </div>
      <SettlementSection settlement={settlement} onSettled={loadSettlement} />
    </div>
  );
}

import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

// Roles that may see investments / income / expense / profit-loss / milestones / TDS.
// Must mirror FINANCE_VISIBLE_ROLES in backend/server.py.
const FINANCE_VISIBLE_ROLES = ["admin", "partner", "senior_manager", "hr", "accountant"];

// Roles that DO see a dashboard at `/` (but a different, operational one — no financial data).
// Used by App.js to route `/` to the right component.
const OPS_DASHBOARD_ROLES = ["center_manager"];

// Where to send a non-finance user instead of the financial dashboard.
// Note: center_manager NOW lands on `/` (an operational dashboard auto-renders for that role)
// so they're NOT in this map any more.
const LANDING_FOR_ROLE = {
  manager:             "/hrms",
  center_staff:        "/check-in",
  viewer:              "/pending-approvals",
  reporting_authority: "/pending-approvals",
  center_partner:      "/pending-approvals",
  center_manager:      "/",
};

export default function ProtectedRoute({ children, requireFinance = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-sm overline" data-testid="loading-screen">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (requireFinance && !FINANCE_VISIBLE_ROLES.includes(user.role)) {
    // Operational roles (center_manager) get to stay ONLY on `/` — App.js will render the ops dashboard.
    // Any other requireFinance route (e.g. /payment-dashboard, /transactions, /reports) redirects to LANDING.
    if (OPS_DASHBOARD_ROLES.includes(user.role) && location.pathname === "/") return children;
    return <Navigate to={LANDING_FOR_ROLE[user.role] || "/hrms"} replace />;
  }
  return children;
}

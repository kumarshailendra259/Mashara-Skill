import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LangProvider } from "@/context/LangContext";
import { AuthProvider } from "@/context/AuthContext";
import { PermissionProvider } from "@/context/PermissionContext";
import { FYProvider } from "@/context/FYContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
const Register = lazy(() => import("@/pages/Register"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Entities = lazy(() => import("@/pages/Entities"));
const Transactions = lazy(() => import("@/pages/Transactions"));
const Reports = lazy(() => import("@/pages/Reports"));
const Users = lazy(() => import("@/pages/Users"));
const HRMS = lazy(() => import("@/pages/HRMS"));
const MyProfile = lazy(() => import("@/pages/MyProfile"));
const StaffSalaryDetail = lazy(() => import("@/pages/StaffSalaryDetail"));
const StaffProfile = lazy(() => import("@/pages/StaffProfile"));
const Advances = lazy(() => import("@/pages/Advances"));
const Stock = lazy(() => import("@/pages/Stock"));
const ApprovalLog = lazy(() => import("@/pages/ApprovalLog"));
const ApprovalWorkflows = lazy(() => import("@/pages/ApprovalWorkflows"));
const HrSettings = lazy(() => import("@/pages/HrSettings"));
const Programs = lazy(() => import("@/pages/Programs"));
const BatchManagement = lazy(() => import("@/pages/BatchManagement"));
const CheckIn = lazy(() => import("@/pages/CheckIn"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const PartnerAssociations = lazy(() => import("@/pages/PartnerAssociations"));
const TdsRegister = lazy(() => import("@/pages/TdsRegister"));
const PendingApprovals = lazy(() => import("@/pages/PendingApprovals"));
const MessManagement = lazy(() => import("@/pages/MessManagement"));
const LoginHistory = lazy(() => import("@/pages/LoginHistory"));
const AssetManagement = lazy(() => import("@/pages/AssetManagement"));
const EmployeeTransfers = lazy(() => import("@/pages/EmployeeTransfers"));
const CenterManagerDashboard = lazy(() => import("@/pages/CenterManagerDashboard"));
const Quotations = lazy(() => import("@/pages/Quotations"));
const Vendors = lazy(() => import("@/pages/Vendors"));
const Candidates = lazy(() => import("@/pages/Candidates"));
const BankGuarantees = lazy(() => import("@/pages/BankGuarantees"));
const MISDashboard = lazy(() => import("@/pages/mis/MISDashboard"));
const PaymentDashboard = lazy(() => import("@/pages/PaymentDashboard"));
const BankReconciliation = lazy(() => import("@/pages/BankReconciliation"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const InvoiceDetail = lazy(() => import("@/pages/InvoiceDetail"));
const StaffFinancialHistory = lazy(() => import("@/pages/StaffFinancialHistory"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const SubscriptionBilling = lazy(() => import("@/pages/SubscriptionBilling"));
const CompaniesAdmin = lazy(() => import("@/pages/CompaniesAdmin"));
const CenterManagement = lazy(() => import("@/pages/CenterManagement"));
const CompanySelect = lazy(() => import("@/pages/CompanySelect"));
const PartnerSettlement = lazy(() => import("@/pages/PartnerSettlement"));
const CourseMaster = lazy(() => import("@/pages/CourseMaster"));
const RateConfig = lazy(() => import("@/pages/RateConfig"));
const EntityMappings = lazy(() => import("@/pages/EntityMappings"));
const MenuAccessControl = lazy(() => import("@/pages/MenuAccessControl"));
import { useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import "@/App.css";

function Shell({ children }) {
  return <Layout>{children}</Layout>;
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-screen text-sm overline" data-testid="route-loading">
      Loading…
    </div>
  );
}

// Auth-only wrapper WITHOUT the company-select gate (used by /select-company).
function AuthedOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-sm overline">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Renders the appropriate "/" landing page based on user role.
// Finance roles → financial Dashboard. center_manager → operational CenterManagerDashboard.
function RoleHome() {
  const { user } = useAuth();
  if (user?.role === "center_manager") return <CenterManagerDashboard />;
  return <Dashboard />;
}

function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <PermissionProvider>
        <FYProvider>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/select-company" element={<AuthedOnly><CompanySelect /></AuthedOnly>} />
            <Route path="/" element={<ProtectedRoute requireFinance><Shell><RoleHome /></Shell></ProtectedRoute>} />
            <Route path="/companies" element={<ProtectedRoute><Shell><Entities etype="company" /></Shell></ProtectedRoute>} />
            <Route path="/partners" element={<ProtectedRoute><Shell><Entities etype="partner" /></Shell></ProtectedRoute>} />
            <Route path="/centers" element={<ProtectedRoute><Shell><Entities etype="center" /></Shell></ProtectedRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Shell><Entities etype="project" /></Shell></ProtectedRoute>} />
            <Route path="/transactions" element={<ProtectedRoute requireFinance><Shell><Transactions /></Shell></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute requireFinance><Shell><Reports /></Shell></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute><Shell><Users /></Shell></ProtectedRoute>} />
            <Route path="/hrms" element={<ProtectedRoute><Shell><HRMS /></Shell></ProtectedRoute>} />
            <Route path="/me/profile" element={<ProtectedRoute><Shell><MyProfile /></Shell></ProtectedRoute>} />
            <Route path="/hrms/staff/:sid/salary" element={<ProtectedRoute><Shell><StaffSalaryDetail /></Shell></ProtectedRoute>} />
            <Route path="/hrms/staff/:sid/profile" element={<ProtectedRoute><Shell><StaffProfile /></Shell></ProtectedRoute>} />
            <Route path="/advances" element={<ProtectedRoute><Shell><Advances /></Shell></ProtectedRoute>} />
            <Route path="/stock" element={<ProtectedRoute><Shell><Stock /></Shell></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute><Shell><ApprovalLog /></Shell></ProtectedRoute>} />
            <Route path="/approval-workflows" element={<ProtectedRoute><Shell><ApprovalWorkflows /></Shell></ProtectedRoute>} />
            <Route path="/hr-settings" element={<ProtectedRoute><Shell><HrSettings /></Shell></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><Shell><Notifications /></Shell></ProtectedRoute>} />
            <Route path="/subscription" element={<ProtectedRoute><Shell><SubscriptionBilling /></Shell></ProtectedRoute>} />
            <Route path="/companies-admin" element={<ProtectedRoute><Shell><CompaniesAdmin /></Shell></ProtectedRoute>} />
            <Route path="/center-management" element={<ProtectedRoute><Shell><CenterManagement /></Shell></ProtectedRoute>} />
            <Route path="/course-master" element={<ProtectedRoute><Shell><CourseMaster /></Shell></ProtectedRoute>} />
            <Route path="/rate-config" element={<ProtectedRoute requireAdmin><Shell><RateConfig /></Shell></ProtectedRoute>} />
            <Route path="/entity-mappings" element={<ProtectedRoute><Shell><EntityMappings /></Shell></ProtectedRoute>} />
            <Route path="/programs" element={<ProtectedRoute><Shell><Programs /></Shell></ProtectedRoute>} />
            <Route path="/batch-management" element={<ProtectedRoute><Shell><BatchManagement /></Shell></ProtectedRoute>} />
            <Route path="/partner-associations" element={<ProtectedRoute><Shell><PartnerAssociations /></Shell></ProtectedRoute>} />
            <Route path="/partner-settlement" element={<ProtectedRoute requireFinance><Shell><PartnerSettlement /></Shell></ProtectedRoute>} />
            <Route path="/tds-register" element={<ProtectedRoute requireFinance><Shell><TdsRegister /></Shell></ProtectedRoute>} />
            <Route path="/pending-approvals" element={<ProtectedRoute><Shell><PendingApprovals /></Shell></ProtectedRoute>} />
            <Route path="/mess" element={<ProtectedRoute><Shell><MessManagement /></Shell></ProtectedRoute>} />
            <Route path="/login-history" element={<ProtectedRoute><Shell><LoginHistory /></Shell></ProtectedRoute>} />
            <Route path="/assets" element={<ProtectedRoute><Shell><AssetManagement /></Shell></ProtectedRoute>} />
            <Route path="/employee-transfers" element={<ProtectedRoute><Shell><EmployeeTransfers /></Shell></ProtectedRoute>} />
            <Route path="/quotations" element={<ProtectedRoute><Shell><Quotations /></Shell></ProtectedRoute>} />
            <Route path="/payment-dashboard" element={<ProtectedRoute requireFinance><Shell><PaymentDashboard /></Shell></ProtectedRoute>} />
            <Route path="/bank-reconciliation" element={<ProtectedRoute><Shell><BankReconciliation /></Shell></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute><Shell><Invoices /></Shell></ProtectedRoute>} />
            <Route path="/invoices/:id" element={<ProtectedRoute><Shell><InvoiceDetail /></Shell></ProtectedRoute>} />
            <Route path="/hrms/financial-history" element={<ProtectedRoute><Shell><StaffFinancialHistory /></Shell></ProtectedRoute>} />
            <Route path="/vendors" element={<ProtectedRoute><Shell><Vendors /></Shell></ProtectedRoute>} />
            <Route path="/candidates" element={<ProtectedRoute><Shell><Candidates /></Shell></ProtectedRoute>} />
            <Route path="/bank-guarantees" element={<ProtectedRoute><Shell><BankGuarantees /></Shell></ProtectedRoute>} />
            <Route path="/mis" element={<ProtectedRoute><Shell><MISDashboard /></Shell></ProtectedRoute>} />
            <Route path="/menu-access-control" element={<ProtectedRoute requireAdmin><Shell><MenuAccessControl /></Shell></ProtectedRoute>} />
            <Route path="/check-in" element={<CheckIn />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="top-right" />
        </FYProvider>
        </PermissionProvider>
      </AuthProvider>
    </LangProvider>
  );
}

export default App;

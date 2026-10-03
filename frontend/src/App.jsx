/**
 * ============================================================
 * File: App.jsx
 *
 * Description:
 * Top-level route table. /login and /register are public; every
 * /dashboard/* route is wrapped in ProtectedRoute + AppLayout and
 * requires a valid session (checked via GET /auth/me).
 * ============================================================
 */

import { Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import ServicesPage from "./pages/ServicesPage";
import AppointmentsPage from "./pages/AppointmentsPage";
import InventoryPage from "./pages/InventoryPage";
import ShipmentsPage from "./pages/ShipmentsPage";
import CustomersPage from "./pages/CustomersPage";
import SalesPage from "./pages/SalesPage";
import BillingPage from "./pages/BillingPage";
import SuppliersPage from "./pages/SuppliersPage";
import PurchasesPage from "./pages/PurchasesPage";
import ReportsLayout from "./pages/reports/ReportsLayout";
import OverviewReport from "./pages/reports/OverviewReport";
import ProfitReport from "./pages/reports/ProfitReport";
import StaffSalesReport from "./pages/reports/StaffSalesReport";
import CashUpReport from "./pages/reports/CashUpReport";
import ProfitLossReport from "./pages/reports/ProfitLossReport";
import ExpiryReport from "./pages/reports/ExpiryReport";
import InventoryValueReport from "./pages/reports/InventoryValueReport";
import SalesByCategoryReport from "./pages/reports/SalesByCategoryReport";
import BranchComparisonReport from "./pages/reports/BranchComparisonReport";
import TaxReport from "./pages/reports/TaxReport";
import DiscountsReport from "./pages/reports/DiscountsReport";
import CustomersReport from "./pages/reports/CustomersReport";
import ReceivablesReport from "./pages/reports/ReceivablesReport";
import ExpensesPage from "./pages/ExpensesPage";
import RolesPage from "./pages/RolesPage";
import StaffPage from "./pages/StaffPage";
import BranchesPage from "./pages/BranchesPage";
import OfflineBranchesPage from "./pages/OfflineBranchesPage";
import AttendancePage from "./pages/AttendancePage";
import OrganizationsPage from "./pages/OrganizationsPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import BusinessProfilePage from "./pages/BusinessProfilePage";
import SubscriptionPage from "./pages/SubscriptionPage";
import ProtectedRoute from "./routes/ProtectedRoute";
import RequirePermission from "./routes/RequirePermission";
import RequireDeveloper from "./routes/RequireDeveloper";
import RequireSuperAdmin from "./routes/RequireSuperAdmin";
import AppLayout from "./layouts/AppLayout";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route
          path="customers"
          element={
            <RequirePermission resource="customers">
              <CustomersPage />
            </RequirePermission>
          }
        />
        <Route
          path="services/catalog"
          element={
            <RequirePermission resource="services">
              <ServicesPage />
            </RequirePermission>
          }
        />
        <Route
          path="services/appointments"
          element={
            <RequirePermission resource="appointments">
              <AppointmentsPage />
            </RequirePermission>
          }
        />
        {/*
          Products and Stock are ONE page: a product is created by entering the
          stock it starts with, and stays listed at quantity 0 when it sells
          out. Everyone who can read the catalog gets in — a cashier needs to
          look up a price or what's on the shelf — while acting (adding
          products, moving quantities, setting reorder levels) is gated inside
          the page against the grant the API actually checks. The old
          /inventory/stock path redirects so bookmarks keep working.
        */}
        <Route
          path="inventory/products"
          element={
            <RequirePermission resource="products">
              <InventoryPage />
            </RequirePermission>
          }
        />
        <Route path="inventory/stock" element={<Navigate to="/dashboard/inventory/products" replace />} />
        <Route
          path="inventory/shipments"
          element={
            <RequirePermission resource="stock_movements">
              <ShipmentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="purchasing/suppliers"
          element={
            <RequirePermission resource="suppliers">
              <SuppliersPage />
            </RequirePermission>
          }
        />
        <Route
          path="purchasing/purchases"
          element={
            <RequirePermission resource="purchases">
              <PurchasesPage />
            </RequirePermission>
          }
        />
        <Route
          path="sales"
          element={
            <RequirePermission resource="sales">
              <SalesPage />
            </RequirePermission>
          }
        />
        <Route
          path="billing"
          element={
            <RequirePermission resource={["taxes", "discounts"]}>
              <BillingPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission resource="reports">
              <ReportsLayout />
            </RequirePermission>
          }
        >
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewReport />} />
          <Route path="profit" element={<ProfitReport />} />
          <Route path="sales-by-staff" element={<StaffSalesReport />} />
          <Route path="cash-up" element={<CashUpReport />} />
          <Route path="profit-loss" element={<ProfitLossReport />} />
          <Route path="expiry" element={<ExpiryReport />} />
          <Route path="inventory-value" element={<InventoryValueReport />} />
          <Route path="sales-by-category" element={<SalesByCategoryReport />} />
          <Route path="branch-comparison" element={<BranchComparisonReport />} />
          <Route path="tax" element={<TaxReport />} />
          <Route path="discounts" element={<DiscountsReport />} />
          <Route path="customers" element={<CustomersReport />} />
          <Route path="receivables" element={<ReceivablesReport />} />
        </Route>
        <Route
          path="expenses"
          element={
            <RequirePermission resource="expenses">
              <ExpensesPage />
            </RequirePermission>
          }
        />
        <Route
          path="administration/branches"
          element={
            <RequirePermission resource="branches">
              <BranchesPage />
            </RequirePermission>
          }
        />
        <Route
          path="administration/offline"
          element={
            <RequirePermission resource={["users", "roles", "branches"]} action="manage">
              <OfflineBranchesPage />
            </RequirePermission>
          }
        />
        <Route
          path="administration/roles"
          element={
            <RequirePermission resource="roles">
              <RolesPage />
            </RequirePermission>
          }
        />
        <Route
          path="administration/staff"
          element={
            <RequirePermission resource="users">
              <StaffPage />
            </RequirePermission>
          }
        />
        <Route
          path="administration/business-profile"
          element={
            <RequirePermission resource="settings">
              <BusinessProfilePage />
            </RequirePermission>
          }
        />
        {/* No RequirePermission: every staff member may view their OWN
            attendance log — the backend scopes what the list returns
            (own records only, unless the role grants attendance). */}
        <Route path="administration/attendance" element={<AttendancePage />} />
        <Route path="administration/change-password" element={<ChangePasswordPage />} />
        <Route
          path="administration/subscription"
          element={
            <RequireSuperAdmin>
              <SubscriptionPage />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="organizations"
          element={
            <RequireDeveloper>
              <OrganizationsPage />
            </RequireDeveloper>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;

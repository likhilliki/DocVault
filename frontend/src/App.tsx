import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import DocumentDetail from "./pages/DocumentDetail";
import Receipts from "./pages/Receipts";
import Warranties from "./pages/Warranties";
import AskVault from "./pages/AskVault";
import Shared from "./pages/Shared";
import Settings from "./pages/Settings";
import PublicShare from "./pages/PublicShare";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public route — no sidebar */}
        <Route path="/s/:shareId" element={<PublicShare />} />

        {/* Authenticated routes with sidebar */}
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/receipts" element={<Receipts />} />
          <Route path="/warranties" element={<Warranties />} />
          <Route path="/vault" element={<AskVault />} />
          <Route path="/shared" element={<Shared />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

import { useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  LayoutDashboard,
  FileText,
  Receipt,
  Shield,
  MessageSquare,
  Share2,
  Settings,
  Vault,
  LogOut,
  Upload,
  Menu,
  X,
  ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/documents", icon: FileText, label: "Documents" },
  { to: "/receipts", icon: Receipt, label: "Receipts" },
  { to: "/warranties", icon: Shield, label: "Warranties" },
  { to: "/vault", icon: MessageSquare, label: "Ask Vault" },
  { to: "/shared", icon: Share2, label: "Shared Links" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/documents": "Documents",
  "/receipts": "Receipts",
  "/warranties": "Warranties",
  "/vault": "Ask Vault",
  "/shared": "Shared Links",
  "/settings": "Settings",
};

interface LayoutContextType {
  openUpload: () => void;
}

export { type LayoutContextType };

export default function Layout() {
  const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const currentPath = "/" + location.pathname.split("/")[1];
  const pageTitle = pageTitles[currentPath] || "DocVault";

  const showUploadButton = currentPath === "/documents";

  const email = user?.signInDetails?.loginId || user?.username || "";

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="DocVault" className="w-9 h-9 rounded-xl flex-shrink-0 object-cover" />
          <span className="text-lg font-bold text-white tracking-tight">
            DocVault
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative ${
                isActive
                  ? "text-primary-400 bg-primary-500/10 border-l-2 border-primary-500 pl-[10px]"
                  : "text-gray-400 hover:text-white hover:bg-surface-2"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={17}
                  className={
                    isActive
                      ? "text-primary-400"
                      : "text-gray-500 group-hover:text-gray-300"
                  }
                />
                {label}
                {isActive && (
                  <ChevronRight
                    size={14}
                    className="ml-auto text-primary-500 opacity-60"
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="px-3 py-4 border-t border-border space-y-1">
        <div className="px-2 py-2">
          <p className="text-xs text-gray-500 truncate">{email}</p>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/5 transition-all duration-150"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 flex-col bg-surface border-r border-border flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -224 }}
              animate={{ x: 0 }}
              exit={{ x: -224 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="lg:hidden fixed left-0 top-0 h-full w-56 bg-surface border-r border-border z-50"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-14 flex items-center justify-between px-4 lg:px-6 border-b border-border bg-surface flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden btn-ghost p-2"
            >
              <Menu size={18} />
            </button>
            <h1 className="text-base font-semibold text-white">{pageTitle}</h1>
          </div>

          {showUploadButton && (
            <button
              onClick={() => {
                navigate("/documents", { state: { openUpload: true } });
              }}
              className="btn-primary"
            >
              <Upload size={15} />
              Upload
            </button>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-bg">
          <Outlet context={{ openUpload: () => setUploadModalOpen(true) }} />
        </main>
      </div>
    </div>
  );
}

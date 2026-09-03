import { Outlet } from "react-router-dom";
import { Link } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { NotificationBell } from "./NotificationBell";
import { LanguageSelector } from "./LanguageSelector";
import logo from "@/assets/logo.png";

export const Layout = () => (
  <div className="min-h-screen bg-background pb-20">
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur-md">
      <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/inicio" className="inline-flex items-center gap-2">
          <img src={logo} alt="Bornaal" className="h-8 w-auto" />
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSelector />
          <NotificationBell />
        </div>
      </div>
    </header>
    <Outlet />
    <BottomNav />
  </div>
);

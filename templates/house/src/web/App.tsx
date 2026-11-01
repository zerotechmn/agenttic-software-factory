import { Routes, Route, NavLink } from "react-router";
import { Home } from "./pages/Home.tsx";
import { PRODUCT_NAME } from "../shared/product.ts";

// Route table — the Architect adds one <Route> and one nav item per page; developers implement pages.
const NAV: { to: string; label: string }[] = [{ to: "/", label: "Home" }];

export function App() {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <span className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</span>
          <nav className="flex gap-4 text-sm">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => (isActive ? "text-accent" : "text-muted hover:text-text")}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}

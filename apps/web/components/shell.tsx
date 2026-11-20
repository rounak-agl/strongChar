"use client";
// The app frame: a collapsible left rail (brand, the primary action, navigation, chain status) and the page area.
// The rail's collapsed state lives on <html data-rail>, restored from the last visit once the page mounts.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  BookOpen, Cpu, Home, Layers, Lock, Menu, PanelLeftClose, PanelLeftOpen, RefreshCw, Rocket, Trophy, X, type LucideIcon,
} from "lucide-react";
import { BrandMark } from "./brand";
import { Crumbs, cx } from "./primitives";

type NavItem = { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean };
const NAV: NavItem[] = [
  { href: "/", label: "home", icon: Home, match: (p) => p === "/" },
  { href: "/jobs", label: "jobs", icon: Layers, match: (p) => p.startsWith("/jobs") },
  { href: "/nodes", label: "nodes", icon: Cpu, match: (p) => p.startsWith("/nodes") },
  { href: "/compete", label: "competitions", icon: Trophy, match: (p) => p.startsWith("/compete") },
  { href: "/sealed", label: "what the server sees", icon: Lock, match: (p) => p.startsWith("/sealed") },
];
const DOCS: NavItem[] = [
  { href: "/how", label: "how it works", icon: BookOpen, match: (p) => p.startsWith("/how") },
];

const Rail = createContext({ narrow: false });
const root = () => document.documentElement;

function useCollapsed() {
  const [c, setC] = useState(false);
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem("rail") === "1"; } catch { /* storage may be blocked */ }
    root().dataset.rail = saved ? "collapsed" : "open";
    setC(saved);
  }, []);
  const set = (v: boolean) => {
    setC(v);
    root().dataset.rail = v ? "collapsed" : "open";
    try { localStorage.setItem("rail", v ? "1" : "0"); } catch { /* storage may be blocked */ }
  };
  return [c, set] as const;
}

export function AppFrame({ children, chain }: { children: ReactNode; chain: { name: string; block: number | null } }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useCollapsed();
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      setCollapsed(root().dataset.rail !== "collapsed");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [setCollapsed]);

  return (
    <div className="min-h-dvh bg-sunken md:flex md:h-dvh md:p-2">
      <aside className="rail-aside relative hidden shrink-0 md:block">
        <div className="rail-panel absolute inset-y-0 left-0 z-40 bg-sunken">
          <Rail.Provider value={{ narrow: collapsed }}>
            <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} chain={chain} />
          </Rail.Provider>
        </div>
      </aside>
      <MobileBar onMenu={() => setOpen(true)} />
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60 animate-fade-in" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-sidebar bg-sunken animate-drawer-in">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-2 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-band">
              <X className="size-4" />
            </button>
            <Rail.Provider value={{ narrow: false }}>
              <Sidebar collapsed={false} chain={chain} />
            </Rail.Provider>
          </aside>
        </div>
      )}
      <main id="main" className="min-w-0 flex-1 bg-surface md:overflow-y-auto md:rounded-xl md:border md:border-rule">
        {children}
      </main>
    </div>
  );
}

function MobileBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-rule bg-sunken px-3 md:hidden">
      <button type="button" onClick={onMenu} aria-label="Open menu" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-band">
        <Menu className="size-4" />
      </button>
      <Link href="/" className="flex items-center gap-2">
        <BrandMark className="size-6 p-1" />
        <span className="text-sm font-medium text-ink">strongChar</span>
      </Link>
    </header>
  );
}

/** Every rail row: a fixed 20px icon slot 12px from the edge, then a label that fades. Same geometry in both states. */
const ROW = "flex h-8 w-full items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-sm px-3 text-sm";
const HOVER = "transition-colors duration-150 hover:bg-band hover:text-ink";

function Slot({ children }: { children: ReactNode }) {
  return <span className="relative grid size-5 shrink-0 place-items-center">{children}</span>;
}

function Label({ children, className }: { children: ReactNode; className?: string }) {
  const { narrow } = useContext(Rail);
  return <span inert={narrow} className={cx("rail-label flex min-w-0 flex-1 items-center gap-2", className)}>{children}</span>;
}

function NavLink({ item }: { item: NavItem }) {
  const path = usePathname() ?? "/";
  const on = item.match(path);
  const Icon = item.icon;
  return (
    <Link href={item.href} title={item.label} aria-current={on ? "page" : undefined} className={cx(ROW, on ? "bg-band font-medium text-ink" : cx("text-muted", HOVER))}>
      <Slot><Icon className="size-5" strokeWidth={1} aria-hidden /></Slot>
      <Label>{item.label}</Label>
    </Link>
  );
}

function Sidebar({ collapsed, onToggle, chain }: { collapsed: boolean; onToggle?: () => void; chain: { name: string; block: number | null } }) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 px-2 py-3">
      <div className="mb-2 flex items-center gap-1">
        <Link href="/" aria-label="strongChar home" className={cx(ROW, "min-w-0 flex-1 rounded-md")}>
          <Slot><BrandMark className="size-6 p-0.5" /></Slot>
          <Label><span className="font-semibold text-ink">strongChar</span></Label>
        </Link>
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title="Toggle sidebar ( [ )"
                  className="rail-wide inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-band hover:text-ink">
            <ToggleIcon className="size-4" strokeWidth={1.5} />
          </button>
        )}
      </div>
      <Link href="/start" title="Get started" className={cx(ROW, "mb-2 h-9 rounded-md bg-accent font-medium text-accent-ink shadow-cta transition-opacity duration-150 hover:opacity-90")}>
        <Slot><Rocket className="size-4" strokeWidth={1.5} aria-hidden /></Slot>
        <Label>Get started</Label>
      </Link>
      {NAV.map((i) => <NavLink key={i.href} item={i} />)}
      <div className="my-2 h-px bg-rule" />
      {DOCS.map((i) => <NavLink key={i.href} item={i} />)}
      <div className="mt-auto flex items-center gap-2.5 px-3 py-2 font-mono text-xs text-subtle" title={chain.block ? `latest block ${chain.block}` : "chain unreachable"}>
        <Slot><span className={cx("size-1.5 rounded-full", chain.block ? "bg-ok live-dot" : "bg-warn")} aria-hidden /></Slot>
        <Label><span className="truncate">{chain.name}{chain.block ? ` · #${chain.block.toLocaleString("en-US")}` : ""}</span></Label>
      </div>
    </nav>
  );
}

/** Top of every page: where you are, when the data was read, and a refresh that re-reads it on the server. */
export function PageTop({ crumbs, icon, children }: { crumbs: { href?: string; label: ReactNode; mono?: boolean }[]; icon?: ReactNode; children?: ReactNode }) {
  const router = useRouter();
  // The clock starts after mount, so the server render and the first client render agree.
  const [at, setAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const start = Date.now();
    setAt(start);
    setNow(start);
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const ago = at === null || now === null ? 0 : Math.max(0, Math.round((now - at) / 1000));
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-rule bg-surface/95 px-5 backdrop-blur">
      {icon && <span className="shrink-0 text-muted [&>svg]:size-4" aria-hidden>{icon}</span>}
      <Crumbs items={crumbs} />
      <span className="hidden items-center gap-1.5 font-mono text-xs text-subtle sm:inline-flex">
        <span className="size-1.5 rounded-full bg-subtle" aria-hidden />updated {ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`} ago
      </span>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <button type="button" aria-label="Refresh" onClick={() => { router.refresh(); setAt(Date.now()); }}
                className="inline-flex size-8 items-center justify-center rounded-md border border-rule text-muted hover:bg-band hover:text-ink">
          <RefreshCw className="size-4" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}

// Page scaffold: the sticky top bar, then a title row and the content column. Server pages compose it.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageTop } from "./shell";

export function Page({ crumbs, icon: Icon, title, meta, actions, children }: {
  crumbs: { href?: string; label: ReactNode; mono?: boolean }[];
  icon?: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageTop crumbs={crumbs} icon={Icon ? <Icon strokeWidth={1.5} /> : undefined}>{actions}</PageTop>
      <div className="flex flex-col gap-6 px-5 pb-16 pt-6 md:px-7">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-medium text-ink">{title}</h1>
          {meta && <div className="flex flex-wrap items-center gap-2 text-sm text-muted">{meta}</div>}
        </div>
        {children}
      </div>
    </>
  );
}

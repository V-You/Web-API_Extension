import type { ReactNode } from "react";

interface Props {
  heading: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ heading, hint, icon, className = "" }: Props) {
  return (
    <div className={`py-12 text-center text-slate-500 ${className}`}>
      {icon && <div className="mb-2 flex justify-center text-slate-400">{icon}</div>}
      <p className="text-sm">{heading}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

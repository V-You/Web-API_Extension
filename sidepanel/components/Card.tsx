import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  compact?: boolean;
  className?: string;
}

export function Card({ children, compact = false, className = "" }: CardProps) {
  const padding = compact ? "p-2" : "p-3";
  return (
    <div className={`rounded-lg border border-slate-200 ${padding} ${className}`}>{children}</div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mb-2 text-sm font-semibold text-slate-700 ${className}`}>{children}</div>;
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-2 text-xs ${className}`}>{children}</div>;
}

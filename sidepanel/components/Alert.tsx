import type { ReactNode } from "react";

type Variant = "error" | "warning" | "info" | "success";

interface Props {
  variant?: Variant;
  children: ReactNode;
  className?: string;
  role?: string;
}

const VARIANTS: Record<Variant, string> = {
  error: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function Alert({ variant = "info", children, className = "", role }: Props) {
  return (
    <div
      role={role ?? (variant === "error" ? "alert" : undefined)}
      className={`rounded-md border p-3 text-xs ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </div>
  );
}

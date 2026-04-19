import type { ReactNode } from "react";

type Variant =
  | "env-uat"
  | "env-prod"
  | "status-ok"
  | "status-fail"
  | "write"
  | "neutral"
  | "info";

interface Props {
  variant?: Variant;
  children: ReactNode;
  className?: string;
  title?: string;
  "aria-label"?: string;
}

const VARIANTS: Record<Variant, string> = {
  "env-uat": "bg-blue-100 text-blue-700",
  "env-prod": "bg-red-100 text-red-700",
  "status-ok": "bg-emerald-100 text-emerald-700",
  "status-fail": "bg-red-100 text-red-700",
  write: "bg-amber-100 text-amber-700",
  neutral: "bg-slate-100 text-slate-500",
  info: "bg-blue-50 text-blue-700",
};

export function Badge({ variant = "neutral", children, className = "", ...rest }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const BASE =
  "inline-flex items-center justify-center rounded-md font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 " +
  "focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  danger: "border border-red-300 text-red-700 hover:bg-red-50",
  ghost: "text-slate-500 hover:text-slate-700",
};

const SIZES: Record<Size, string> = {
  sm: "text-xs px-2 py-1",
  md: "text-xs px-3 py-1.5",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

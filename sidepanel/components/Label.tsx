import type { LabelHTMLAttributes, ReactNode } from "react";

interface Props extends LabelHTMLAttributes<HTMLLabelElement> {
  children: ReactNode;
}

export function Label({ className = "", children, ...rest }: Props) {
  return (
    <label className={`mb-1 block text-xs font-medium text-slate-600 ${className}`} {...rest}>
      {children}
    </label>
  );
}

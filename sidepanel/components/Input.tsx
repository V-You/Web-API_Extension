import { forwardRef } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const BASE =
  "w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs " +
  "focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...rest }, ref) {
    return <input ref={ref} className={`${BASE} ${className}`} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", children, ...rest }, ref) {
    return (
      <select ref={ref} className={`${BASE} ${className}`} {...rest}>
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = "", ...rest }, ref) {
    return <textarea ref={ref} className={`${BASE} ${className}`} {...rest} />;
  },
);

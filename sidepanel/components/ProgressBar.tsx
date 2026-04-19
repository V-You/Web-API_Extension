type Variant = "default" | "paused" | "subtle";

interface Props {
  value: number;
  variant?: Variant;
  className?: string;
  "aria-label"?: string;
}

const VARIANTS: Record<Variant, { track: string; fill: string; height: string }> = {
  default: { track: "bg-slate-100", fill: "bg-blue-500", height: "h-2" },
  paused: { track: "bg-slate-100", fill: "bg-slate-400", height: "h-2" },
  subtle: { track: "bg-slate-100", fill: "bg-slate-400", height: "h-1" },
};

export function ProgressBar({ value, variant = "default", className = "", ...rest }: Props) {
  const pct = Math.max(0, Math.min(100, value));
  const v = VARIANTS[variant];
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`overflow-hidden rounded-full ${v.track} ${v.height} ${className}`}
      {...rest}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${v.fill}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

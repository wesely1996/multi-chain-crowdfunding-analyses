interface DeltaProps {
  value: string;
  direction: "up" | "down" | "neutral";
  label?: string;
}

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  delta?: DeltaProps;
  variant?: string;
}

const deltaColors: Record<DeltaProps["direction"], string> = {
  down: "bg-green-900/50 text-green-400",
  up: "bg-red-900/50 text-red-400",
  neutral: "bg-gray-700/50 text-gray-400",
};

const variantAccents: Record<string, string> = {
  V1: "border-blue-700",
  V2: "border-purple-700",
  V3: "border-yellow-700",
  V4: "border-green-700",
  V5: "border-pink-700",
};

export function MetricCard({
  label,
  value,
  unit,
  delta,
  variant,
}: MetricCardProps) {
  const borderColor = variant
    ? (variantAccents[variant] ?? "border-gray-700")
    : "border-gray-700";

  return (
    <div
      className={`rounded-lg bg-gray-900 border ${borderColor} p-4 flex flex-col gap-1`}
    >
      <span className="text-xs text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono text-white">{value}</span>
        {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </div>
      {delta && (
        <span
          className={`self-start mt-1 rounded px-2 py-0.5 text-xs font-mono ${deltaColors[delta.direction]}`}
        >
          {delta.value}
          {delta.label && (
            <span className="ml-1 opacity-70">{delta.label}</span>
          )}
        </span>
      )}
    </div>
  );
}

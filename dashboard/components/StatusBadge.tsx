import type { RunStatus } from "@/lib/types";

interface StatusBadgeProps {
  status: RunStatus;
  className?: string;
}

const statusStyles: Record<RunStatus, string> = {
  idle: "bg-gray-700 text-gray-300",
  running: "bg-blue-900 text-blue-300 animate-pulse",
  success: "bg-green-900 text-green-300",
  error: "bg-red-900 text-red-300",
};

const statusLabels: Record<RunStatus, string> = {
  idle: "Idle",
  running: "Running",
  success: "Success",
  error: "Error",
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]} ${className}`}
    >
      {statusLabels[status]}
    </span>
  );
}

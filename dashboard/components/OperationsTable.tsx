import { OperationRecord } from "@/lib/types";
import { formatGas, formatMs } from "@/lib/format";

interface Props {
  operations: OperationRecord[];
  platform: "EVM" | "Solana";
}

export default function OperationsTable({ operations, platform }: Props) {
  if (operations.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">No operation records in this result file.</p>
    );
  }

  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden max-h-[400px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-900 text-left text-xs uppercase tracking-wider text-gray-500">
            <th className="px-4 py-2">Operation</th>
            <th className="px-4 py-2">Scenario</th>
            {platform === "EVM" && <th className="px-4 py-2 text-right">Gas Used</th>}
            <th className="px-4 py-2 text-right">Latency</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {operations.map((op, i) => (
            <tr key={i} className="bg-gray-950 hover:bg-gray-900/60 transition-colors">
              <td className="px-4 py-2 font-mono text-gray-200">{op.name}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{op.scenario}</td>
              {platform === "EVM" && (
                <td className="px-4 py-2 text-right font-mono text-orange-400">
                  {formatGas(op.gas_used)}
                </td>
              )}
              <td className="px-4 py-2 text-right font-mono text-blue-400">
                {formatMs(op.latency_ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import { RunForm } from "@/components/RunForm";

export default function RunPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-gray-400 hover:text-white">
        ← Back to Home
      </Link>

      <h1 className="mt-4 text-3xl font-bold text-white">Run Benchmark</h1>
      <p className="mt-1 text-gray-400">
        Select a variant, client, and kind to trigger a benchmark run.
      </p>

      <div className="mt-8 rounded-lg bg-gray-900 border border-gray-700 p-6">
        <RunForm />
      </div>
    </main>
  );
}

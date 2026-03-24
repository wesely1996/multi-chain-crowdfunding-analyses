export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { allRuns } from "@/lib/run-store";

export async function GET() {
  const runs = allRuns().sort((a, b) => b.startedAt - a.startedAt);
  return NextResponse.json(runs);
}

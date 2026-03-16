export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/run-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: run.id,
    status: run.status,
    output: run.output,
    resultFile: run.resultFile,
    startedAt: run.startedAt,
  });
}

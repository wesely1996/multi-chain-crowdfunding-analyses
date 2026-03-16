export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { loadResults } from "@/lib/load-results";

export async function GET() {
  const results = loadResults();
  return NextResponse.json(results);
}

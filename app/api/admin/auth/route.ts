import { NextRequest, NextResponse } from "next/server";

const adminPassword = process.env.ADMIN_PASSWORD || "1234";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const providedPassword = typeof body?.password === "string" ? body.password : "";

  if (providedPassword !== adminPassword) {
    return NextResponse.json({ error: "Wrong admin password." }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}

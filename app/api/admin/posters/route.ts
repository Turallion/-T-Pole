import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminPassword = process.env.ADMIN_PASSWORD || "1234";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function DELETE(request: NextRequest) {
  const providedPassword = request.headers.get("x-admin-password") ?? "";

  if (providedPassword !== adminPassword) {
    return NextResponse.json({ error: "Wrong admin password." }, { status: 401 });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "Supabase admin deletion needs SUPABASE_SERVICE_ROLE_KEY on the server. Local draft mode can delete without it."
      },
      { status: 501 }
    );
  }

  const posterId = request.nextUrl.searchParams.get("id");
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const query = adminSupabase.from("posters").delete();
  const { error } = posterId ? await query.eq("id", posterId) : await query.neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

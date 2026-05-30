import { NextResponse } from "next/server";

export function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const posterBucket = process.env.NEXT_PUBLIC_SUPABASE_POSTER_BUCKET;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return NextResponse.json({
    supabaseUrl: Boolean(supabaseUrl),
    supabaseAnonKey: Boolean(supabaseAnonKey),
    posterBucket: posterBucket || "poster-images",
    adminPassword: Boolean(adminPassword),
    serviceRoleKey: Boolean(serviceRoleKey),
    readyForPublicWrites: Boolean(supabaseUrl && supabaseAnonKey),
    readyForAdminDeletes: Boolean(supabaseUrl && serviceRoleKey && adminPassword)
  });
}

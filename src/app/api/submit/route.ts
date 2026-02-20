import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url || !url.includes("github.com")) {
      return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Log the submission
    await supabase.from("activity_log").insert({
      action: "artifact_submitted",
      details: { url },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

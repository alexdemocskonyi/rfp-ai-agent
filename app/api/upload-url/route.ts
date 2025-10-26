import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client POSTs the raw file as the request body.
// We stream it straight into Vercel Blob to avoid 413 limits.
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "Vercel Blob not configured (BLOB_READ_WRITE_TOKEN)" },
      { status: 500 }
    );
  }

  const contentType = req.headers.get("content-type") || "application/octet-stream";
  const fileName = req.headers.get("x-filename") || "upload-" + Date.now();
  const pathname = "uploads/" + fileName;

  const blob = await put(pathname, req.body!, {
    access: "public",
    contentType,
  });

  return NextResponse.json({ ok: true, url: blob.url, name: fileName, pathname });
}

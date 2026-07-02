import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@autosite/database";

export async function POST(request: NextRequest, { params }: { params: { websiteId: string } }) {
  const formData = await request.formData();
  const payload = Object.fromEntries(formData.entries());

  const website = await prisma.website.findUnique({ where: { id: params.websiteId } });
  if (!website) {
    return NextResponse.json({ error: "Website not found" }, { status: 404 });
  }

  await prisma.lead.create({
    data: {
      websiteId: params.websiteId,
      payload,
    },
  });

  return NextResponse.redirect(new URL(request.headers.get("referer") ?? "/", request.url));
}

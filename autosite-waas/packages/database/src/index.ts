import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function getPublishedWebsiteForTenant(slugOrDomain: string) {
  const tenant = await prisma.tenant.findFirst({
    where: {
      isActive: true,
      OR: [{ slug: slugOrDomain }, { customDomain: slugOrDomain }],
    },
    include: {
      websites: {
        where: { isPublished: true },
        orderBy: { version: "desc" },
        take: 1,
      },
    },
  });

  return tenant?.websites[0] ?? null;
}

export * from "@prisma/client";

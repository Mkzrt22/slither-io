import { notFound } from "next/navigation";
import { getPublishedWebsiteForTenant } from "@autosite/database";
import { ASTParser } from "../../../components/ASTParser";
import type { WebsiteAST } from "@autosite/ai-core";

export default async function TenantSitePage({ params }: { params: { tenant: string } }) {
  const website = await getPublishedWebsiteForTenant(params.tenant);

  if (!website) {
    notFound();
  }

  return <ASTParser ast={website.astJson as unknown as WebsiteAST} websiteId={website.id} />;
}

"use client";

import { PageHeader } from "@/components/content/page-header";
import { AssetLibrary } from "@/components/assets/asset-library";

export default function DocumentsPage() {
  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader crumbs={[{ label: "Photos & Media", href: "/assets" }, { label: "Documents" }]} title="Documents & private files" subtitle="PDFs and private consent files. Private files open only through an authorized, expiring link." backHref="/assets" />
      <AssetLibrary view="documents" showTabs={false} />
    </div>
  );
}

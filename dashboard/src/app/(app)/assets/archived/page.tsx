"use client";

import { PageHeader } from "@/components/content/page-header";
import { AssetLibrary } from "@/components/assets/asset-library";

export default function ArchivedPage() {
  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader crumbs={[{ label: "Photos & Media", href: "/assets" }, { label: "Archived" }]} title="Archived assets" subtitle="Soft-deleted assets. Restore to make them available again." backHref="/assets" />
      <AssetLibrary view="archived" showTabs={false} />
    </div>
  );
}

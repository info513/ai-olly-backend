"use client";

import { PageHeader } from "@/components/content/page-header";
import { AssetLibrary } from "@/components/assets/asset-library";

export default function UsagePage() {
  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader crumbs={[{ label: "Photos & Media", href: "/assets" }, { label: "Usage" }]} title="Usage" subtitle="See where assets are used and find unused ones. Open any asset to manage its usages." backHref="/assets" />
      <AssetLibrary showTabs={false} />
    </div>
  );
}

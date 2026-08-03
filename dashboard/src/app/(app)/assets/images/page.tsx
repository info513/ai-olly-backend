"use client";

import { PageHeader } from "@/components/content/page-header";
import { AssetLibrary } from "@/components/assets/asset-library";

export default function ImagesPage() {
  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader crumbs={[{ label: "Assets", href: "/assets" }, { label: "Images" }]} title="Images" subtitle="Photos and graphics." backHref="/assets" />
      <AssetLibrary view="images" showTabs={false} />
    </div>
  );
}

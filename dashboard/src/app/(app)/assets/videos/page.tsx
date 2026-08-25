"use client";

import { PageHeader } from "@/components/content/page-header";
import { AssetLibrary } from "@/components/assets/asset-library";

export default function VideosPage() {
  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader crumbs={[{ label: "Photos & Media", href: "/assets" }, { label: "Videos" }]} title="Videos" subtitle="Short videos and external (Vimeo/YouTube) references." backHref="/assets" />
      <AssetLibrary view="videos" showTabs={false} />
    </div>
  );
}

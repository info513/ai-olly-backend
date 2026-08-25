"use client";

import { PageHeader } from "@/components/content/page-header";
import { AssetLibrary } from "@/components/assets/asset-library";

export default function AudioPage() {
  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader crumbs={[{ label: "Photos & Media", href: "/assets" }, { label: "Audio" }]} title="Audio" subtitle="Whisper narration and audio clips." backHref="/assets" />
      <AssetLibrary view="audio" showTabs={false} />
    </div>
  );
}

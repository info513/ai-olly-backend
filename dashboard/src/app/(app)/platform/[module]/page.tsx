"use client";

import { useParams } from "next/navigation";
import { PlatformPlaceholder } from "@/components/shell/platform/platform-placeholder";

/** Catch-all for the not-yet-built Platform CMS modules (POIs, Routes, Whispers, Events,
 *  Live Feed, Media, AI Knowledge, Translations, Content Health, Settings). Explicit routes
 *  (/platform, /platform/destinations, /platform/migration) take precedence. */
export default function PlatformModulePlaceholder() {
  const params = useParams();
  const moduleKey = Array.isArray(params.module) ? params.module[0] : (params.module as string) ?? "";
  return <PlatformPlaceholder moduleKey={moduleKey} />;
}

import { ModulePlaceholder } from "@/components/shell/module-placeholder";

/**
 * Catch-all for every module/subsection not yet built (Content, AI, Reception,
 * Guests, Assets, Newsletter, Analytics, Settings, and their sub-routes). Keeps
 * all shell/search/command links resolving to a warm "coming soon" surface.
 * /home has its own segment and takes precedence over this catch-all.
 */
export default function ModuleCatchAll({ params }: { params: { slug: string[] } }) {
  return <ModulePlaceholder slug={params.slug} />;
}

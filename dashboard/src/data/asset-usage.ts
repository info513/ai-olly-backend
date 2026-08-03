"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ak } from "./assets";
import type { AssetUsage } from "./asset-types";

const sb = () => getSupabaseBrowserClient();

/** "Where is this asset used?" via asset_usage_report (SECURITY INVOKER; RLS applies). */
export function useAssetUsages(assetId?: string) {
  return useQuery({
    queryKey: ak.usages(assetId),
    enabled: !!assetId,
    queryFn: async (): Promise<AssetUsage[]> => {
      const { data, error } = await sb().rpc("asset_usage_report", { p_asset: assetId });
      if (error) throw error;
      return (data ?? []).map((u: any): AssetUsage => ({ entityType: u.entity_type, entityId: u.entity_id, usageRole: u.usage_role, hotelId: u.hotel_id, sortOrder: u.sort_order }));
    },
  });
}

export function useAttachUsage(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { assetId: string; entityType: string; entityId: string; usageRole: string }) => {
      const { error } = await sb().from("asset_usages").insert({ asset_id: v.assetId, hotel_id: hotelId, entity_type: v.entityType, entity_id: v.entityId, usage_role: v.usageRole });
      if (error) throw error;
      return v.assetId;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ak.usages(id) }); qc.invalidateQueries({ queryKey: ak.assets(hotelId) }); qc.invalidateQueries({ queryKey: ak.asset(id) }); },
  });
}

export function useDetachUsage(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { assetId: string; entityType: string; entityId: string; usageRole: string }) => {
      const { error } = await sb().from("asset_usages").delete().match({ asset_id: v.assetId, entity_type: v.entityType, entity_id: v.entityId, usage_role: v.usageRole });
      if (error) throw error;
      return v.assetId;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ak.usages(id) }); qc.invalidateQueries({ queryKey: ak.assets(hotelId) }); qc.invalidateQueries({ queryKey: ak.asset(id) }); },
  });
}

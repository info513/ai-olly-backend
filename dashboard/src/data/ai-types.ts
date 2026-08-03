import type { BlockBody, ContentStatus } from "./types";

export type KnowledgeScope = "platform" | "destination" | "hotel" | "override";

export const SCOPE_LABEL: Record<KnowledgeScope, string> = {
  platform: "Inherited platform answer",
  destination: "Destination answer",
  hotel: "Hotel answer",
  override: "Hotel-specific override",
};
export const SCOPE_SHORT: Record<KnowledgeScope, string> = {
  platform: "Platform",
  destination: "Destination",
  hotel: "Hotel",
  override: "Hotel override",
};

export interface KnowledgeCategory {
  id: string;
  hotel_id: string | null;
  key: string;
  name: string;
  sort_order: number;
  active: boolean;
}

export interface KnowledgeArticle {
  id: string;
  hotel_id: string | null;
  destination_id: string | null;
  category_id: string | null;
  key: string;
  title: string;
  body_content: BlockBody | null;
  approved_answer: string | null;
  locale: string;
  status: ContentStatus;
  active: boolean;
  available_to_ai: boolean;
  source_type: KnowledgeScope;
  source_entity_type: string | null;
  source_entity_id: string | null;
  priority: number;
  is_critical: boolean;
  valid_from: string | null;
  valid_to: string | null;
  override_of_article_id: string | null;
  published_at: string | null;
  updated_at: string;
  published_snapshot: Record<string, any> | null;
  categoryName?: string;
}

export interface ResolvedKnowledge {
  article_id: string;
  source: KnowledgeScope;
  key: string;
  title: string;
  body_content: BlockBody | null;
  approved_answer: string | null;
  priority: number;
  is_critical: boolean;
  category_id: string | null;
  published_at: string | null;
}

export interface ArticleVersion {
  id: string;
  version_number: number;
  status: ContentStatus;
  change_summary: string | null;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  snapshot: Record<string, any>;
}

export interface KnowledgeAlias {
  id: string;
  hotel_id: string | null;
  article_id: string | null;
  intent_key: string | null;
  locale: string;
  alias_text: string;
  normalized_alias: string;
  active: boolean;
  articleTitle?: string;
}

export interface UnansweredQuestion {
  id: string;
  hotel_id: string;
  normalized_question: string;
  original_question: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  assigned_to: string | null;
  resolution_article_id: string | null;
  notes: string | null;
}

export interface AiConfig {
  id: string;
  hotel_id: string | null;
  persona: Record<string, any> | null;
  tone: string | null;
  response_formatting: Record<string, any> | null;
  safe_handoff_text: string | null;
  feature_flags: Record<string, any> | null;
  retrieval_limit: number;
  safe_keyword_aliases: Record<string, any> | null;
  status: ContentStatus;
  active: boolean;
  published_at: string | null;
}

export interface AiQualityDaily {
  hotel_id: string;
  day: string;
  total_questions: number;
  deterministic_answers: number;
  model_answers: number;
  safe_handoffs: number;
  unanswered: number;
  avg_latency_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  knowledge_articles_used: number;
  coverage_estimate: number | null;
  calc_version: string;
}

export interface KnowledgeHealth {
  publishedCount: number;
  draftCount: number;
  expiredCritical: number;
  criticalPending: number;
  missingApprovedAnswer: number;
  unresolvedUnanswered: number;
}

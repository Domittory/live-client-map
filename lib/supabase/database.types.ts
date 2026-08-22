export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_runs: {
        Row: {
          actor_user_id: string
          client_id: string
          contract_version: string
          created_at: string
          error_code: string | null
          function: string
          id: string
          idempotency_key: string
          input_hash: string
          input_tokens: number | null
          latency_ms: number | null
          model_snapshot: string
          ontology_version: string
          organization_id: string
          output_hash: string | null
          output_tokens: number | null
          prompt_version: string
          provider: string
          reasoning_effort: string
          redaction_version: string
          request_id: string
          retryable: boolean | null
          scoring_model_version: string | null
          status: string
        }
        Insert: {
          actor_user_id: string
          client_id: string
          contract_version: string
          created_at?: string
          error_code?: string | null
          function: string
          id?: string
          idempotency_key: string
          input_hash: string
          input_tokens?: number | null
          latency_ms?: number | null
          model_snapshot: string
          ontology_version: string
          organization_id: string
          output_hash?: string | null
          output_tokens?: number | null
          prompt_version: string
          provider: string
          reasoning_effort: string
          redaction_version: string
          request_id: string
          retryable?: boolean | null
          scoring_model_version?: string | null
          status: string
        }
        Update: {
          actor_user_id?: string
          client_id?: string
          contract_version?: string
          created_at?: string
          error_code?: string | null
          function?: string
          id?: string
          idempotency_key?: string
          input_hash?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model_snapshot?: string
          ontology_version?: string
          organization_id?: string
          output_hash?: string | null
          output_tokens?: number | null
          prompt_version?: string
          provider?: string
          reasoning_effort?: string
          redaction_version?: string
          request_id?: string
          retryable?: boolean | null
          scoring_model_version?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          organization_id: string
          reason: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          organization_id: string
          reason?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          organization_id?: string
          reason?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      belief_templates: {
        Row: {
          archived_at: string | null
          code: string | null
          created_at: string
          created_by: string | null
          default_life_areas: string[]
          default_tags: string[]
          diagnostic_domain_id: string
          id: string
          interpretation_hint: string | null
          is_system: boolean
          language: string
          ontology_version_id: string
          organization_id: string | null
          root_hypothesis_hint: string | null
          statement: string
          statement_polarity: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          default_life_areas?: string[]
          default_tags?: string[]
          diagnostic_domain_id: string
          id?: string
          interpretation_hint?: string | null
          is_system?: boolean
          language?: string
          ontology_version_id: string
          organization_id?: string | null
          root_hypothesis_hint?: string | null
          statement: string
          statement_polarity?: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          default_life_areas?: string[]
          default_tags?: string[]
          diagnostic_domain_id?: string
          id?: string
          interpretation_hint?: string | null
          is_system?: boolean
          language?: string
          ontology_version_id?: string
          organization_id?: string | null
          root_hypothesis_hint?: string | null
          statement?: string
          statement_polarity?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "belief_templates_diagnostic_domain_id_fkey"
            columns: ["diagnostic_domain_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "belief_templates_ontology_version_id_fkey"
            columns: ["ontology_version_id"]
            isOneToOne: false
            referencedRelation: "ontology_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "belief_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assignments: {
        Row: {
          access_role: string
          client_id: string
          created_at: string
          id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          access_role?: string
          client_id: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          access_role?: string
          client_id?: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_goals: {
        Row: {
          client_id: string
          created_at: string
          description: string | null
          id: string
          importance: string
          organization_id: string
          status: string
          target_state: string | null
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          description?: string | null
          id?: string
          importance?: string
          organization_id: string
          status?: string
          target_state?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          description?: string | null
          id?: string
          importance?: string
          organization_id?: string
          status?: string
          target_state?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_requests: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          current_progress: string | null
          description: string | null
          id: string
          life_areas: string[]
          organization_id: string
          priority: string
          started_at: string | null
          status: string
          success_criteria: string | null
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          current_progress?: string | null
          description?: string | null
          id?: string
          life_areas?: string[]
          organization_id: string
          priority?: string
          started_at?: string | null
          status?: string
          success_criteria?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          current_progress?: string | null
          description?: string | null
          id?: string
          life_areas?: string[]
          organization_id?: string
          priority?: string
          started_at?: string | null
          status?: string
          success_criteria?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          birth_date: string | null
          birth_place: string | null
          birth_time: string | null
          children_info: string | null
          client_visible_notes: string | null
          created_at: string
          current_role: string | null
          display_name: string | null
          first_name: string | null
          gender: string | null
          id: string
          last_name: string | null
          occupation: string | null
          organization_id: string
          owner_user_id: string
          relationship_status: string | null
          specialist_notes_private: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          birth_date?: string | null
          birth_place?: string | null
          birth_time?: string | null
          children_info?: string | null
          client_visible_notes?: string | null
          created_at?: string
          current_role?: string | null
          display_name?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          occupation?: string | null
          organization_id: string
          owner_user_id: string
          relationship_status?: string | null
          specialist_notes_private?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          birth_date?: string | null
          birth_place?: string | null
          birth_time?: string | null
          children_info?: string | null
          client_visible_notes?: string | null
          created_at?: string
          current_role?: string | null
          display_name?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          occupation?: string | null
          organization_id?: string
          owner_user_id?: string
          relationship_status?: string | null
          specialist_notes_private?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          client_id: string
          consent_type: string
          created_at: string
          document_version: string
          granted_at: string
          id: string
          organization_id: string
          revoked_at: string | null
          scope: string
        }
        Insert: {
          client_id: string
          consent_type: string
          created_at?: string
          document_version: string
          granted_at?: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          scope?: string
        }
        Update: {
          client_id?: string
          consent_type?: string
          created_at?: string
          document_version?: string
          granted_at?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      core_node_relations: {
        Row: {
          client_id: string
          confidence: number | null
          created_at: string
          created_by: string | null
          evidence_summary: string | null
          from_core_node_id: string
          id: string
          organization_id: string
          relation_type: string
          strength: number | null
          to_core_node_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          evidence_summary?: string | null
          from_core_node_id: string
          id?: string
          organization_id: string
          relation_type: string
          strength?: number | null
          to_core_node_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          evidence_summary?: string | null
          from_core_node_id?: string
          id?: string
          organization_id?: string
          relation_type?: string
          strength?: number | null
          to_core_node_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "core_node_relations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_node_relations_from_core_node_id_fkey"
            columns: ["from_core_node_id"]
            isOneToOne: false
            referencedRelation: "core_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_node_relations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_node_relations_to_core_node_id_fkey"
            columns: ["to_core_node_id"]
            isOneToOne: false
            referencedRelation: "core_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      core_nodes: {
        Row: {
          activation_score: number | null
          archived_at: string | null
          client_id: string
          client_relevance_score: number | null
          confidence_score: number | null
          contexts_count: number
          created_at: string
          created_by: string | null
          evidence_count: number
          hypothesis: string | null
          id: string
          impact_score: number | null
          independent_evidence_count: number
          last_confirmed_at: string | null
          last_confirmed_by: string | null
          organization_id: string
          readiness_score: number | null
          risk_score: number | null
          root_domain: string | null
          rootness_score: number | null
          status: string
          strength_score: number | null
          title: string
          trend: string | null
          unlock_score: number | null
          updated_at: string
          visibility: string
        }
        Insert: {
          activation_score?: number | null
          archived_at?: string | null
          client_id: string
          client_relevance_score?: number | null
          confidence_score?: number | null
          contexts_count?: number
          created_at?: string
          created_by?: string | null
          evidence_count?: number
          hypothesis?: string | null
          id?: string
          impact_score?: number | null
          independent_evidence_count?: number
          last_confirmed_at?: string | null
          last_confirmed_by?: string | null
          organization_id: string
          readiness_score?: number | null
          risk_score?: number | null
          root_domain?: string | null
          rootness_score?: number | null
          status?: string
          strength_score?: number | null
          title: string
          trend?: string | null
          unlock_score?: number | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          activation_score?: number | null
          archived_at?: string | null
          client_id?: string
          client_relevance_score?: number | null
          confidence_score?: number | null
          contexts_count?: number
          created_at?: string
          created_by?: string | null
          evidence_count?: number
          hypothesis?: string | null
          id?: string
          impact_score?: number | null
          independent_evidence_count?: number
          last_confirmed_at?: string | null
          last_confirmed_by?: string | null
          organization_id?: string
          readiness_score?: number | null
          risk_score?: number | null
          root_domain?: string | null
          rootness_score?: number | null
          status?: string
          strength_score?: number | null
          title?: string
          trend?: string | null
          unlock_score?: number | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "core_nodes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_nodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_expected_markers: {
        Row: {
          baseline_value: string | null
          correction_id: string
          created_at: string
          expected_direction: string
          id: string
          life_area: string | null
          marker: string
          measurement_type: string
          target_value: string | null
          updated_at: string
        }
        Insert: {
          baseline_value?: string | null
          correction_id: string
          created_at?: string
          expected_direction: string
          id?: string
          life_area?: string | null
          marker: string
          measurement_type: string
          target_value?: string | null
          updated_at?: string
        }
        Update: {
          baseline_value?: string | null
          correction_id?: string
          created_at?: string
          expected_direction?: string
          id?: string
          life_area?: string | null
          marker?: string
          measurement_type?: string
          target_value?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_expected_markers_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "corrections"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_targets: {
        Row: {
          correction_id: string
          created_at: string
          expected_effect: string | null
          id: string
          role: string
          target_id: string
          target_type: string
        }
        Insert: {
          correction_id: string
          created_at?: string
          expected_effect?: string | null
          id?: string
          role: string
          target_id: string
          target_type: string
        }
        Update: {
          correction_id?: string
          created_at?: string
          expected_effect?: string | null
          id?: string
          role?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_targets_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "corrections"
            referencedColumns: ["id"]
          },
        ]
      }
      corrections: {
        Row: {
          archived_at: string | null
          client_id: string
          client_visible_summary: string | null
          contraindications_acknowledged: boolean
          created_at: string
          created_by: string | null
          date: string
          expected_effect: string | null
          id: string
          intervention_method_id: string | null
          method_notes: string | null
          organization_id: string
          priority_score_before: number | null
          rationale: string | null
          recommendation_id: string | null
          specialist_notes: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          client_visible_summary?: string | null
          contraindications_acknowledged?: boolean
          created_at?: string
          created_by?: string | null
          date?: string
          expected_effect?: string | null
          id?: string
          intervention_method_id?: string | null
          method_notes?: string | null
          organization_id: string
          priority_score_before?: number | null
          rationale?: string | null
          recommendation_id?: string | null
          specialist_notes?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          client_visible_summary?: string | null
          contraindications_acknowledged?: boolean
          created_at?: string
          created_by?: string | null
          date?: string
          expected_effect?: string | null
          id?: string
          intervention_method_id?: string | null
          method_notes?: string | null
          organization_id?: string
          priority_score_before?: number | null
          rationale?: string | null
          recommendation_id?: string | null
          specialist_notes?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corrections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrections_intervention_method_id_fkey"
            columns: ["intervention_method_id"]
            isOneToOne: false
            referencedRelation: "intervention_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrections_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      development_targets: {
        Row: {
          client_id: string
          created_at: string
          current_level: number | null
          description: string | null
          domain: string | null
          id: string
          importance: string
          linked_core_nodes: string[]
          linked_resources: string[]
          name: string
          organization_id: string
          status: string
          success_markers: string[]
          target_level: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          current_level?: number | null
          description?: string | null
          domain?: string | null
          id?: string
          importance?: string
          linked_core_nodes?: string[]
          linked_resources?: string[]
          name: string
          organization_id: string
          status?: string
          success_markers?: string[]
          target_level?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          current_level?: number | null
          description?: string | null
          domain?: string | null
          id?: string
          importance?: string
          linked_core_nodes?: string[]
          linked_resources?: string[]
          name?: string
          organization_id?: string
          status?: string
          success_markers?: string[]
          target_level?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "development_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "development_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_domains: {
        Row: {
          applicable_contexts: string[]
          archived_at: string | null
          contraindicated_contexts: string[]
          created_at: string
          created_by: string | null
          default_priority: number | null
          description: string | null
          domain_group: string | null
          id: string
          is_system: boolean
          language: string
          life_areas: string[]
          name: string
          ontology_version_id: string
          organization_id: string | null
          slug: string
          updated_at: string
          version: number
        }
        Insert: {
          applicable_contexts?: string[]
          archived_at?: string | null
          contraindicated_contexts?: string[]
          created_at?: string
          created_by?: string | null
          default_priority?: number | null
          description?: string | null
          domain_group?: string | null
          id?: string
          is_system?: boolean
          language?: string
          life_areas?: string[]
          name: string
          ontology_version_id: string
          organization_id?: string | null
          slug: string
          updated_at?: string
          version?: number
        }
        Update: {
          applicable_contexts?: string[]
          archived_at?: string | null
          contraindicated_contexts?: string[]
          created_at?: string
          created_by?: string | null
          default_priority?: number | null
          description?: string | null
          domain_group?: string | null
          id?: string
          is_system?: boolean
          language?: string
          life_areas?: string[]
          name?: string
          ontology_version_id?: string
          organization_id?: string | null
          slug?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_domains_ontology_version_id_fkey"
            columns: ["ontology_version_id"]
            isOneToOne: false
            referencedRelation: "ontology_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_session_summaries: {
        Row: {
          client_id: string
          confirmed_hypotheses: string[]
          contradicted_hypotheses: string[]
          created_at: string
          diagnostic_session_id: string
          id: string
          new_hypotheses: string[]
          organization_id: string
          priority_changes: string[]
          strongest_findings: string[]
          summary: string | null
        }
        Insert: {
          client_id: string
          confirmed_hypotheses?: string[]
          contradicted_hypotheses?: string[]
          created_at?: string
          diagnostic_session_id: string
          id?: string
          new_hypotheses?: string[]
          organization_id: string
          priority_changes?: string[]
          strongest_findings?: string[]
          summary?: string | null
        }
        Update: {
          client_id?: string
          confirmed_hypotheses?: string[]
          contradicted_hypotheses?: string[]
          created_at?: string
          diagnostic_session_id?: string
          id?: string
          new_hypotheses?: string[]
          organization_id?: string
          priority_changes?: string[]
          strongest_findings?: string[]
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_session_summaries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_session_summaries_diagnostic_session_id_fkey"
            columns: ["diagnostic_session_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_session_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_sessions: {
        Row: {
          ai_processing_status: string
          client_id: string
          created_at: string
          human_review_status: string
          id: string
          input_format: string | null
          notes: string | null
          organization_id: string
          performed_at: string | null
          performed_by_user_id: string | null
          raw_input: string | null
          session_type: string
          source_type: string | null
          title: string
          updated_at: string
        }
        Insert: {
          ai_processing_status?: string
          client_id: string
          created_at?: string
          human_review_status?: string
          id?: string
          input_format?: string | null
          notes?: string | null
          organization_id: string
          performed_at?: string | null
          performed_by_user_id?: string | null
          raw_input?: string | null
          session_type: string
          source_type?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          ai_processing_status?: string
          client_id?: string
          created_at?: string
          human_review_status?: string
          id?: string
          input_format?: string | null
          notes?: string | null
          organization_id?: string
          performed_at?: string | null
          performed_by_user_id?: string | null
          raw_input?: string | null
          session_type?: string
          source_type?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      differential_hypotheses: {
        Row: {
          client_id: string
          confidence_score: number | null
          created_at: string
          created_by: string | null
          description: string | null
          evidence_against: string[]
          evidence_for: string[]
          id: string
          organization_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          evidence_against?: string[]
          evidence_for?: string[]
          id?: string
          organization_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          evidence_against?: string[]
          evidence_for?: string[]
          id?: string
          organization_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "differential_hypotheses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "differential_hypotheses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_clusters: {
        Row: {
          client_id: string
          context_key: string
          created_at: string
          diagnostic_session_id: string | null
          id: string
          independent_weight: number
          organization_id: string
          semantic_topic: string
          signals_count: number
          updated_at: string
        }
        Insert: {
          client_id: string
          context_key: string
          created_at?: string
          diagnostic_session_id?: string | null
          id?: string
          independent_weight?: number
          organization_id: string
          semantic_topic: string
          signals_count?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          context_key?: string
          created_at?: string
          diagnostic_session_id?: string | null
          id?: string
          independent_weight?: number
          organization_id?: string
          semantic_topic?: string
          signals_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_clusters_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_clusters_diagnostic_session_id_fkey"
            columns: ["diagnostic_session_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_clusters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          client_id: string
          content_sha256: string
          contract_version: string
          counts: Json
          created_at: string
          diagnostic_session_id: string | null
          fatal_errors: Json
          id: string
          idempotency_key: string
          input_format: string
          organization_id: string
          report: Json
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          content_sha256: string
          contract_version: string
          counts?: Json
          created_at?: string
          diagnostic_session_id?: string | null
          fatal_errors?: Json
          id?: string
          idempotency_key: string
          input_format: string
          organization_id: string
          report?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          content_sha256?: string
          contract_version?: string
          counts?: Json
          created_at?: string
          diagnostic_session_id?: string | null
          fatal_errors?: Json
          id?: string
          idempotency_key?: string
          input_format?: string
          organization_id?: string
          report?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imports_diagnostic_session_id_fkey"
            columns: ["diagnostic_session_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_methods: {
        Row: {
          archived_at: string | null
          category: string | null
          contraindications: string[]
          created_at: string
          created_by: string | null
          default_follow_up_days: number | null
          description: string | null
          id: string
          is_system: boolean
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category?: string | null
          contraindications?: string[]
          created_at?: string
          created_by?: string | null
          default_follow_up_days?: number | null
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category?: string | null
          contraindications?: string[]
          created_at?: string
          created_by?: string | null
          default_follow_up_days?: number | null
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      life_events: {
        Row: {
          client_id: string
          created_at: string
          date: string | null
          description: string | null
          event_type: string | null
          id: string
          organization_id: string
          significance: string | null
          source_type: string | null
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          client_id: string
          created_at?: string
          date?: string | null
          description?: string | null
          event_type?: string | null
          id?: string
          organization_id: string
          significance?: string | null
          source_type?: string | null
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          date?: string | null
          description?: string | null
          event_type?: string | null
          id?: string
          organization_id?: string
          significance?: string | null
          source_type?: string | null
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "life_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "life_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ontology_versions: {
        Row: {
          archived_at: string | null
          created_at: string
          domain_types: string[]
          id: string
          life_areas: string[]
          relation_types: string[]
          status: string
          version: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          domain_types?: string[]
          id?: string
          life_areas?: string[]
          relation_types?: string[]
          status?: string
          version: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          domain_types?: string[]
          id?: string
          life_areas?: string[]
          relation_types?: string[]
          status?: string
          version?: string
        }
        Relationships: []
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          organization_id: string
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          organization_id: string
          role: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          invited_at: string | null
          invited_by: string | null
          joined_at: string
          organization_id: string
          role: string
          status: string
          suspended_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string
          organization_id: string
          role?: string
          status?: string
          suspended_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string
          organization_id?: string
          role?: string
          status?: string
          suspended_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          plan: string
          settings: Json
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          plan?: string
          settings?: Json
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          plan?: string
          settings?: Json
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      purpose_profiles: {
        Row: {
          client_id: string
          confidence: number | null
          created_at: string
          development_directions: string[]
          id: string
          interpretation: string | null
          organization_id: string
          potential_roles: string[]
          raw_data: Json
          source_system: string
          strengths: string[]
          updated_at: string
          visibility: string
        }
        Insert: {
          client_id: string
          confidence?: number | null
          created_at?: string
          development_directions?: string[]
          id?: string
          interpretation?: string | null
          organization_id: string
          potential_roles?: string[]
          raw_data?: Json
          source_system: string
          strengths?: string[]
          updated_at?: string
          visibility?: string
        }
        Update: {
          client_id?: string
          confidence?: number | null
          created_at?: string
          development_directions?: string[]
          id?: string
          interpretation?: string | null
          organization_id?: string
          potential_roles?: string[]
          raw_data?: Json
          source_system?: string
          strengths?: string[]
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "purpose_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purpose_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purpose_syntheses: {
        Row: {
          client_id: string
          created_at: string
          cross_system_matches: string[]
          id: string
          organization_id: string
          potential_conflicts: string[]
          recommended_development_vectors: string[]
          summary: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          cross_system_matches?: string[]
          id?: string
          organization_id: string
          potential_conflicts?: string[]
          recommended_development_vectors?: string[]
          summary?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          cross_system_matches?: string[]
          id?: string
          organization_id?: string
          potential_conflicts?: string[]
          recommended_development_vectors?: string[]
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purpose_syntheses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purpose_syntheses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_targets: {
        Row: {
          created_at: string
          expected_effect: string | null
          id: string
          recommendation_id: string
          role: string
          target_id: string
          target_type: string | null
        }
        Insert: {
          created_at?: string
          expected_effect?: string | null
          id?: string
          recommendation_id: string
          role: string
          target_id: string
          target_type?: string | null
        }
        Update: {
          created_at?: string
          expected_effect?: string | null
          id?: string
          recommendation_id?: string
          role?: string
          target_id?: string
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_targets_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          activation_score: number | null
          client_id: string
          client_relevance_score: number | null
          client_request_id: string | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          final_priority_score: number | null
          human_review_required: boolean
          id: string
          impact_score: number | null
          missing_evidence: string[]
          organization_id: string
          proposed_correction: string
          rank_rationale: string | null
          rationale: string | null
          readiness_score: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_notes: string | null
          risk_score: number | null
          rootness_score: number | null
          scoring_model_version: string | null
          status: string
          systemic_leverage_score: number | null
          unlock_score: number | null
          updated_at: string
          visibility: string
        }
        Insert: {
          activation_score?: number | null
          client_id: string
          client_relevance_score?: number | null
          client_request_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          final_priority_score?: number | null
          human_review_required?: boolean
          id?: string
          impact_score?: number | null
          missing_evidence?: string[]
          organization_id: string
          proposed_correction: string
          rank_rationale?: string | null
          rationale?: string | null
          readiness_score?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_notes?: string | null
          risk_score?: number | null
          rootness_score?: number | null
          scoring_model_version?: string | null
          status?: string
          systemic_leverage_score?: number | null
          unlock_score?: number | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          activation_score?: number | null
          client_id?: string
          client_relevance_score?: number | null
          client_request_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          final_priority_score?: number | null
          human_review_required?: boolean
          id?: string
          impact_score?: number | null
          missing_evidence?: string[]
          organization_id?: string
          proposed_correction?: string
          rank_rationale?: string | null
          rationale?: string | null
          readiness_score?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_notes?: string | null
          risk_score?: number | null
          rootness_score?: number | null
          scoring_model_version?: string | null
          status?: string
          systemic_leverage_score?: number | null
          unlock_score?: number | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_client_request_id_fkey"
            columns: ["client_request_id"]
            isOneToOne: false
            referencedRelation: "client_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      relationship_dynamics: {
        Row: {
          confidence_score: number | null
          created_at: string
          description: string | null
          evidence_refs: string[]
          id: string
          relationship_id: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          evidence_refs?: string[]
          id?: string
          relationship_id: string
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          evidence_refs?: string[]
          id?: string
          relationship_id?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_dynamics_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      relationships: {
        Row: {
          client_a_id: string
          client_b_id: string
          created_at: string
          id: string
          organization_id: string
          relationship_type: string
          updated_at: string
        }
        Insert: {
          client_a_id: string
          client_b_id: string
          created_at?: string
          id?: string
          organization_id: string
          relationship_type: string
          updated_at?: string
        }
        Update: {
          client_a_id?: string
          client_b_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          relationship_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationships_client_a_id_fkey"
            columns: ["client_a_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_client_b_id_fkey"
            columns: ["client_b_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          client_id: string
          confidence_score: number | null
          created_at: string
          description: string | null
          domain: string | null
          evidence_refs: string[]
          evidence_summary: string | null
          id: string
          name: string
          organization_id: string
          review_status: string
          status: string
          strength_score: number | null
          trend: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          client_id: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          domain?: string | null
          evidence_refs?: string[]
          evidence_summary?: string | null
          id?: string
          name: string
          organization_id: string
          review_status?: string
          status?: string
          strength_score?: number | null
          trend?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          client_id?: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          domain?: string | null
          evidence_refs?: string[]
          evidence_summary?: string | null
          id?: string
          name?: string
          organization_id?: string
          review_status?: string
          status?: string
          strength_score?: number | null
          trend?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_theme_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          link_rationale: string | null
          relevance_score: number | null
          signal_id: string
          theme_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_rationale?: string | null
          relevance_score?: number | null
          signal_id: string
          theme_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_rationale?: string | null
          relevance_score?: number | null
          signal_id?: string
          theme_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_theme_links_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_theme_links_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          archived_at: string | null
          client_id: string
          confidence: number | null
          context: Json
          created_at: string
          created_by: string | null
          diagnostic_session_id: string | null
          epistemic_type: string
          evidence_level: string
          id: string
          inferred_opposite: string | null
          intensity: number | null
          life_areas: string[]
          normalized_meaning: string | null
          organization_id: string
          raw_statement: string
          review_status: string
          source_ref_id: string | null
          source_type: string
          statement_polarity: string | null
          tags: string[]
          test_result: string | null
          time_scope: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          confidence?: number | null
          context?: Json
          created_at?: string
          created_by?: string | null
          diagnostic_session_id?: string | null
          epistemic_type: string
          evidence_level?: string
          id?: string
          inferred_opposite?: string | null
          intensity?: number | null
          life_areas?: string[]
          normalized_meaning?: string | null
          organization_id: string
          raw_statement: string
          review_status?: string
          source_ref_id?: string | null
          source_type: string
          statement_polarity?: string | null
          tags?: string[]
          test_result?: string | null
          time_scope?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          confidence?: number | null
          context?: Json
          created_at?: string
          created_by?: string | null
          diagnostic_session_id?: string | null
          epistemic_type?: string
          evidence_level?: string
          id?: string
          inferred_opposite?: string | null
          intensity?: number | null
          life_areas?: string[]
          normalized_meaning?: string | null
          organization_id?: string
          raw_statement?: string
          review_status?: string
          source_ref_id?: string | null
          source_type?: string
          statement_polarity?: string | null
          tags?: string[]
          test_result?: string | null
          time_scope?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_diagnostic_session_id_fkey"
            columns: ["diagnostic_session_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_core_node_links: {
        Row: {
          confidence: number | null
          core_node_id: string
          created_at: string
          created_by: string | null
          id: string
          link_rationale: string | null
          relationship_type: string
          theme_id: string
        }
        Insert: {
          confidence?: number | null
          core_node_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          link_rationale?: string | null
          relationship_type: string
          theme_id: string
        }
        Update: {
          confidence?: number | null
          core_node_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          link_rationale?: string | null
          relationship_type?: string
          theme_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_core_node_links_core_node_id_fkey"
            columns: ["core_node_id"]
            isOneToOne: false
            referencedRelation: "core_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_core_node_links_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      themes: {
        Row: {
          activity_score: number | null
          archived_at: string | null
          client_id: string
          confidence_score: number | null
          contexts_count: number
          created_at: string
          description: string | null
          domain: string | null
          evidence_count: number
          first_seen_at: string | null
          id: string
          independent_evidence_count: number
          last_seen_at: string | null
          name: string
          organization_id: string
          review_status: string
          status: string
          trend: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          activity_score?: number | null
          archived_at?: string | null
          client_id: string
          confidence_score?: number | null
          contexts_count?: number
          created_at?: string
          description?: string | null
          domain?: string | null
          evidence_count?: number
          first_seen_at?: string | null
          id?: string
          independent_evidence_count?: number
          last_seen_at?: string | null
          name: string
          organization_id: string
          review_status?: string
          status?: string
          trend?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          activity_score?: number | null
          archived_at?: string | null
          client_id?: string
          confidence_score?: number | null
          contexts_count?: number
          created_at?: string
          description?: string | null
          domain?: string | null
          evidence_count?: number
          first_seen_at?: string | null
          id?: string
          independent_evidence_count?: number
          last_seen_at?: string | null
          name?: string
          organization_id?: string
          review_status?: string
          status?: string
          trend?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "themes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "themes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_activations: {
        Row: {
          activation_delta: number | null
          confidence: number | null
          core_node_id: string | null
          created_at: string
          created_by: string | null
          id: string
          rationale: string | null
          theme_id: string | null
          trigger_id: string
        }
        Insert: {
          activation_delta?: number | null
          confidence?: number | null
          core_node_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          rationale?: string | null
          theme_id?: string | null
          trigger_id: string
        }
        Update: {
          activation_delta?: number | null
          confidence?: number | null
          core_node_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          rationale?: string | null
          theme_id?: string | null
          trigger_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trigger_activations_core_node_id_fkey"
            columns: ["core_node_id"]
            isOneToOne: false
            referencedRelation: "core_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trigger_activations_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trigger_activations_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "triggers"
            referencedColumns: ["id"]
          },
        ]
      }
      triggers: {
        Row: {
          client_id: string
          created_at: string
          description: string | null
          id: string
          intensity: number | null
          life_areas: string[]
          life_event_id: string | null
          occurred_at: string | null
          organization_id: string
          source_type: string | null
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          client_id: string
          created_at?: string
          description?: string | null
          id?: string
          intensity?: number | null
          life_areas?: string[]
          life_event_id?: string | null
          occurred_at?: string | null
          organization_id: string
          source_type?: string | null
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          description?: string | null
          id?: string
          intensity?: number | null
          life_areas?: string[]
          life_event_id?: string | null
          occurred_at?: string | null
          organization_id?: string
          source_type?: string | null
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "triggers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triggers_life_event_id_fkey"
            columns: ["life_event_id"]
            isOneToOne: false
            referencedRelation: "life_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triggers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      append_audit: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id: string
          p_entity_type: string
          p_ip_address?: string
          p_organization_id: string
          p_reason?: string
          p_user_agent?: string
        }
        Returns: string
      }
      create_client: {
        Args: {
          p_display_name: string
          p_first_name?: string
          p_last_name?: string
          p_organization_id: string
        }
        Returns: string
      }
      create_organization: { Args: { org_name: string }; Returns: string }
      grant_client_assignment: {
        Args: {
          p_access_role: string
          p_client_id: string
          p_org_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      grant_consent: {
        Args: {
          p_client_id: string
          p_consent_type: string
          p_document_version: string
          p_org_id: string
          p_scope: string
        }
        Returns: string
      }
      has_consent: {
        Args: { p_client_id: string; p_consent_type: string }
        Returns: boolean
      }
      health_check: { Args: never; Returns: boolean }
      invite_member: {
        Args: { p_email: string; p_org_id: string; p_role: string }
        Returns: string
      }
      is_client_accessible: {
        Args: {
          p_client_id: string
          p_org_id: string
          p_require_write?: boolean
        }
        Returns: boolean
      }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      is_org_owner: { Args: { org_id: string }; Returns: boolean }
      revoke_client_assignment: {
        Args: { p_client_id: string; p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      revoke_consent: {
        Args: { p_client_id: string; p_consent_type: string; p_org_id: string }
        Returns: undefined
      }
      set_member_status: {
        Args: { p_org_id: string; p_status: string; p_user_id: string }
        Returns: undefined
      }
      transfer_ownership: {
        Args: { p_new_owner_id: string; p_org_id: string }
        Returns: undefined
      }
      update_member_role: {
        Args: { p_org_id: string; p_role: string; p_user_id: string }
        Returns: undefined
      }
      validate_correction_target: {
        Args: {
          p_client_id: string
          p_organization_id: string
          p_target_id: string
          p_target_type: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const


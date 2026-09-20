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
      behavioral_marker_entries: {
        Row: {
          id: string
          marker_id: string
          note: string | null
          recorded_at: string
          recorded_by: string | null
          value: number
        }
        Insert: {
          id?: string
          marker_id: string
          note?: string | null
          recorded_at?: string
          recorded_by?: string | null
          value: number
        }
        Update: {
          id?: string
          marker_id?: string
          note?: string | null
          recorded_at?: string
          recorded_by?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "behavioral_marker_entries_marker_id_fkey"
            columns: ["marker_id"]
            isOneToOne: false
            referencedRelation: "behavioral_markers"
            referencedColumns: ["id"]
          },
        ]
      }
      behavioral_markers: {
        Row: {
          baseline_value: number | null
          client_id: string
          created_at: string
          current_value: number | null
          description: string | null
          id: string
          life_area: string | null
          linked_core_node_id: string | null
          linked_resource_id: string | null
          linked_theme_id: string | null
          marker_type: string
          name: string
          organization_id: string
          scale_max: number
          scale_min: number
          trend: string
          updated_at: string
        }
        Insert: {
          baseline_value?: number | null
          client_id: string
          created_at?: string
          current_value?: number | null
          description?: string | null
          id?: string
          life_area?: string | null
          linked_core_node_id?: string | null
          linked_resource_id?: string | null
          linked_theme_id?: string | null
          marker_type: string
          name: string
          organization_id: string
          scale_max?: number
          scale_min?: number
          trend?: string
          updated_at?: string
        }
        Update: {
          baseline_value?: number | null
          client_id?: string
          created_at?: string
          current_value?: number | null
          description?: string | null
          id?: string
          life_area?: string | null
          linked_core_node_id?: string | null
          linked_resource_id?: string | null
          linked_theme_id?: string | null
          marker_type?: string
          name?: string
          organization_id?: string
          scale_max?: number
          scale_min?: number
          trend?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "behavioral_markers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavioral_markers_linked_core_node_id_fkey"
            columns: ["linked_core_node_id"]
            isOneToOne: false
            referencedRelation: "core_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavioral_markers_linked_resource_id_fkey"
            columns: ["linked_resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavioral_markers_linked_theme_id_fkey"
            columns: ["linked_theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavioral_markers_organization_id_fkey"
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
      client_feedback_forms: {
        Row: {
          answers: Json | null
          client_id: string
          completed_at: string | null
          correction_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          follow_up_id: string | null
          id: string
          organization_id: string
          questions: Json
          sent_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          answers?: Json | null
          client_id: string
          completed_at?: string | null
          correction_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          follow_up_id?: string | null
          id?: string
          organization_id: string
          questions?: Json
          sent_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          answers?: Json | null
          client_id?: string
          completed_at?: string | null
          correction_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          follow_up_id?: string | null
          id?: string
          organization_id?: string
          questions?: Json
          sent_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_feedback_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_feedback_forms_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "corrections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_feedback_forms_follow_up_id_fkey"
            columns: ["follow_up_id"]
            isOneToOne: false
            referencedRelation: "follow_ups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_feedback_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      client_portal_users: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          email: string
          id: string
          invited_at: string
          last_login_at: string | null
          revoked_at: string | null
          status: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          invited_at?: string
          last_login_at?: string | null
          revoked_at?: string | null
          status?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          invited_at?: string
          last_login_at?: string | null
          revoked_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
          legal_hold: boolean
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
          legal_hold?: boolean
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
          legal_hold?: boolean
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
      core_node_reactivations: {
        Row: {
          calculation: Json
          client_id: string
          core_node_id: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          id: string
          organization_id: string
          previous_activation_score: number | null
          proposed_activation_score: number
          reason: string
          scoring_model_version: string
          status: string
          updated_at: string
        }
        Insert: {
          calculation: Json
          client_id: string
          core_node_id: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          organization_id: string
          previous_activation_score?: number | null
          proposed_activation_score: number
          reason: string
          scoring_model_version: string
          status?: string
          updated_at?: string
        }
        Update: {
          calculation?: Json
          client_id?: string
          core_node_id?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          organization_id?: string
          previous_activation_score?: number | null
          proposed_activation_score?: number
          reason?: string
          scoring_model_version?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "core_node_reactivations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_node_reactivations_core_node_id_fkey"
            columns: ["core_node_id"]
            isOneToOne: false
            referencedRelation: "core_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_node_reactivations_organization_id_fkey"
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
      erasure_requests: {
        Row: {
          backup_marker: Json | null
          blocked_reason: string | null
          client_id: string | null
          client_ref: string
          completed_at: string | null
          created_at: string
          failed_at: string | null
          id: string
          impacted_counts: Json
          organization_id: string
          requested_at: string
          requested_by: string
          started_at: string | null
          status: string
        }
        Insert: {
          backup_marker?: Json | null
          blocked_reason?: string | null
          client_id?: string | null
          client_ref: string
          completed_at?: string | null
          created_at?: string
          failed_at?: string | null
          id?: string
          impacted_counts?: Json
          organization_id: string
          requested_at?: string
          requested_by: string
          started_at?: string | null
          status?: string
        }
        Update: {
          backup_marker?: Json | null
          blocked_reason?: string | null
          client_id?: string | null
          client_ref?: string
          completed_at?: string | null
          created_at?: string
          failed_at?: string | null
          id?: string
          impacted_counts?: Json
          organization_id?: string
          requested_at?: string
          requested_by?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "erasure_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erasure_requests_organization_id_fkey"
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
      export_requests: {
        Row: {
          actor_user_id: string
          artifact_bytes: number | null
          artifact_filename: string | null
          artifact_path: string | null
          artifact_sha256: string | null
          audience: Database["public"]["Enums"]["export_audience"]
          client_id: string
          completed_at: string | null
          contract_version: string
          denied_at: string | null
          download_count: number
          download_denied_count: number
          expired_at: string | null
          expires_at: string
          failed_at: string | null
          failure_code: string | null
          format: Database["public"]["Enums"]["export_format"]
          generated_at: string | null
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["export_kind"]
          last_downloaded_at: string | null
          organization_id: string
          requested_at: string
          snapshot_version: number | null
          status: Database["public"]["Enums"]["export_request_status"]
        }
        Insert: {
          actor_user_id: string
          artifact_bytes?: number | null
          artifact_filename?: string | null
          artifact_path?: string | null
          artifact_sha256?: string | null
          audience: Database["public"]["Enums"]["export_audience"]
          client_id: string
          completed_at?: string | null
          contract_version: string
          denied_at?: string | null
          download_count?: number
          download_denied_count?: number
          expired_at?: string | null
          expires_at?: string
          failed_at?: string | null
          failure_code?: string | null
          format: Database["public"]["Enums"]["export_format"]
          generated_at?: string | null
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["export_kind"]
          last_downloaded_at?: string | null
          organization_id: string
          requested_at?: string
          snapshot_version?: number | null
          status?: Database["public"]["Enums"]["export_request_status"]
        }
        Update: {
          actor_user_id?: string
          artifact_bytes?: number | null
          artifact_filename?: string | null
          artifact_path?: string | null
          artifact_sha256?: string | null
          audience?: Database["public"]["Enums"]["export_audience"]
          client_id?: string
          completed_at?: string | null
          contract_version?: string
          denied_at?: string | null
          download_count?: number
          download_denied_count?: number
          expired_at?: string | null
          expires_at?: string
          failed_at?: string | null
          failure_code?: string | null
          format?: Database["public"]["Enums"]["export_format"]
          generated_at?: string | null
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["export_kind"]
          last_downloaded_at?: string | null
          organization_id?: string
          requested_at?: string
          snapshot_version?: number | null
          status?: Database["public"]["Enums"]["export_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "export_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          ai_assessment: Json | null
          behavioral_result: Json | null
          client_feedback: Json | null
          client_id: string
          completed_at: string | null
          correction_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          result_status: string
          retest_result: Json | null
          scheduled_at: string
          specialist_assessment: Json | null
          updated_at: string
        }
        Insert: {
          ai_assessment?: Json | null
          behavioral_result?: Json | null
          client_feedback?: Json | null
          client_id: string
          completed_at?: string | null
          correction_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          result_status?: string
          retest_result?: Json | null
          scheduled_at: string
          specialist_assessment?: Json | null
          updated_at?: string
        }
        Update: {
          ai_assessment?: Json | null
          behavioral_result?: Json | null
          client_feedback?: Json | null
          client_id?: string
          completed_at?: string | null
          correction_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          result_status?: string
          retest_result?: Json | null
          scheduled_at?: string
          specialist_assessment?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "corrections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_organization_id_fkey"
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
      model_changes: {
        Row: {
          change_reason: string
          client_id: string
          created_at: string
          entity_id: string
          entity_type: string
          evidence_refs: string[]
          id: string
          new_state: Json | null
          occurred_at: string
          organization_id: string
          previous_state: Json | null
        }
        Insert: {
          change_reason: string
          client_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          evidence_refs?: string[]
          id?: string
          new_state?: Json | null
          occurred_at?: string
          organization_id: string
          previous_state?: Json | null
        }
        Update: {
          change_reason?: string
          client_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          evidence_refs?: string[]
          id?: string
          new_state?: Json | null
          occurred_at?: string
          organization_id?: string
          previous_state?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "model_changes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_changes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      model_explanations: {
        Row: {
          after_snapshot_id: string | null
          before_snapshot_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          explanations: Json
          grounding: Json
          grounding_errors: Json
          id: string
          missing_evidence: string[]
          organization_id: string
          run_id: string | null
          source: string
          status: string
          versions: Json
        }
        Insert: {
          after_snapshot_id?: string | null
          before_snapshot_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          explanations?: Json
          grounding?: Json
          grounding_errors?: Json
          id?: string
          missing_evidence?: string[]
          organization_id: string
          run_id?: string | null
          source: string
          status?: string
          versions?: Json
        }
        Update: {
          after_snapshot_id?: string | null
          before_snapshot_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          explanations?: Json
          grounding?: Json
          grounding_errors?: Json
          id?: string
          missing_evidence?: string[]
          organization_id?: string
          run_id?: string | null
          source?: string
          status?: string
          versions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "model_explanations_after_snapshot_id_fkey"
            columns: ["after_snapshot_id"]
            isOneToOne: false
            referencedRelation: "psychological_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_explanations_before_snapshot_id_fkey"
            columns: ["before_snapshot_id"]
            isOneToOne: false
            referencedRelation: "psychological_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_explanations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_explanations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_explanations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      observations: {
        Row: {
          client_id: string
          confidence: number
          correction_id: string | null
          created_at: string
          created_by: string | null
          date: string
          description: string
          id: string
          intensity: number
          life_areas: string[]
          organization_id: string
          source_type: string
          supports_improvement: boolean
          updated_at: string
          valence: string
          visibility: string
        }
        Insert: {
          client_id: string
          confidence: number
          correction_id?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description: string
          id?: string
          intensity: number
          life_areas?: string[]
          organization_id: string
          source_type: string
          supports_improvement?: boolean
          updated_at?: string
          valence: string
          visibility?: string
        }
        Update: {
          client_id?: string
          confidence?: number
          correction_id?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string
          id?: string
          intensity?: number
          life_areas?: string[]
          organization_id?: string
          source_type?: string
          supports_improvement?: boolean
          updated_at?: string
          valence?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "observations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "corrections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_organization_id_fkey"
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
      psychological_snapshots: {
        Row: {
          active_core_nodes: Json
          active_themes: Json
          ai_model: string
          changes_since_previous: Json | null
          client_id: string
          created_at: string
          current_requests: Json
          development_targets: Json
          evidence_digest: string
          generated_at: string
          generated_by: string | null
          id: string
          model_hash: string
          ontology_version: string
          organization_id: string
          prompt_version: string
          reactivated_nodes: Json
          reason: string
          recent_corrections: Json
          recent_triggers: Json
          recommendations: Json
          resource_state: Json
          risk_notes: string
          scoring_model_version: string
          summary: string
          trend_summary: string
          version: number
          weakened_nodes: Json
        }
        Insert: {
          active_core_nodes?: Json
          active_themes?: Json
          ai_model: string
          changes_since_previous?: Json | null
          client_id: string
          created_at?: string
          current_requests?: Json
          development_targets?: Json
          evidence_digest?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          model_hash: string
          ontology_version: string
          organization_id: string
          prompt_version: string
          reactivated_nodes?: Json
          reason: string
          recent_corrections?: Json
          recent_triggers?: Json
          recommendations?: Json
          resource_state?: Json
          risk_notes?: string
          scoring_model_version: string
          summary?: string
          trend_summary?: string
          version: number
          weakened_nodes?: Json
        }
        Update: {
          active_core_nodes?: Json
          active_themes?: Json
          ai_model?: string
          changes_since_previous?: Json | null
          client_id?: string
          created_at?: string
          current_requests?: Json
          development_targets?: Json
          evidence_digest?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          model_hash?: string
          ontology_version?: string
          organization_id?: string
          prompt_version?: string
          reactivated_nodes?: Json
          reason?: string
          recent_corrections?: Json
          recent_triggers?: Json
          recommendations?: Json
          resource_state?: Json
          risk_notes?: string
          scoring_model_version?: string
          summary?: string
          trend_summary?: string
          version?: number
          weakened_nodes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "psychological_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "psychological_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      safety_reviews: {
        Row: {
          category: string
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          review_status: string
          severity: string
          source: string | null
          updated_at: string
        }
        Insert: {
          category: string
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          review_status?: string
          severity?: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          review_status?: string
          severity?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_reviews_organization_id_fkey"
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
      add_hypothesis_contradiction: {
        Args: {
          p_evidence_ref: string
          p_hypothesis_id: string
          p_org_id: string
        }
        Returns: Json
      }
      anonymize_client_audit: {
        Args: { p_client_id: string; p_entity_ids?: string[] }
        Returns: number
      }
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
      append_export_audit: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_after: Json
          p_before: Json
          p_client_id: string
          p_org_id: string
          p_reason: string
        }
        Returns: string
      }
      append_feedback_audit: {
        Args: {
          p_action: string
          p_after: Json
          p_before: Json
          p_entity_id: string
          p_entity_type: string
          p_organization_id: string
          p_reason: string
        }
        Returns: string
      }
      apply_ai_core_node_proposals: {
        Args: { p_client_id: string; p_org_id: string; p_proposals: Json }
        Returns: Json
      }
      apply_ai_resource_proposals: {
        Args: { p_client_id: string; p_org_id: string; p_proposals: Json }
        Returns: Json
      }
      apply_ai_theme_proposals: {
        Args: { p_client_id: string; p_org_id: string; p_proposals: Json }
        Returns: Json
      }
      archive_client: {
        Args: { p_client_id: string; p_org_id: string }
        Returns: undefined
      }
      archive_correction: {
        Args: { p_correction_id: string }
        Returns: undefined
      }
      archive_org_belief_template: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      archive_org_domain: { Args: { p_domain_id: string }; Returns: undefined }
      archive_org_method: { Args: { p_method_id: string }; Returns: undefined }
      assert_client_consent: {
        Args: { p_client_id: string; p_org_id: string; p_types: string[] }
        Returns: string
      }
      assert_client_write: {
        Args: { p_client_id: string; p_org_id: string }
        Returns: string
      }
      assert_org_author_actor: {
        Args: { p_organization_id: string }
        Returns: string
      }
      begin_import: {
        Args: {
          p_client_id: string
          p_content_sha256: string
          p_contract_version: string
          p_idempotency_key: string
          p_input_format: string
          p_org_id: string
          p_raw_content: string
          p_session_id: string
          p_title: string
        }
        Returns: Json
      }
      cancel_follow_up: { Args: { p_follow_up_id: string }; Returns: Json }
      change_goal_status: {
        Args: { p_goal_id: string; p_org_id: string; p_to_status: string }
        Returns: undefined
      }
      change_request_status: {
        Args: { p_org_id: string; p_request_id: string; p_to_status: string }
        Returns: undefined
      }
      claim_export_download: {
        Args: { p_export_id: string }
        Returns: {
          claim_artifact_bytes: number
          claim_artifact_filename: string
          claim_artifact_path: string
          claim_artifact_sha256: string
          claim_audience: Database["public"]["Enums"]["export_audience"]
          claim_client_id: string
          claim_contract_version: string
          claim_download_count: number
          claim_expires_at: string
          claim_export_id: string
          claim_format: Database["public"]["Enums"]["export_format"]
          claim_kind: Database["public"]["Enums"]["export_kind"]
          claim_organization_id: string
          outcome: string
        }[]
      }
      commit_import: {
        Args: {
          p_client_id: string
          p_content_sha256: string
          p_contract_version: string
          p_counts: Json
          p_fatal_errors: Json
          p_idempotency_key: string
          p_input_format: string
          p_org_id: string
          p_raw_content: string
          p_report: Json
          p_session_id: string
          p_signals: Json
          p_title: string
        }
        Returns: Json
      }
      commit_import_selection: {
        Args: {
          p_client_id: string
          p_import_id: string
          p_org_id: string
          p_selected: Json
        }
        Returns: Json
      }
      complete_export_request: {
        Args: {
          p_artifact_bytes: number
          p_artifact_filename: string
          p_artifact_path: string
          p_artifact_sha256: string
          p_export_id: string
        }
        Returns: undefined
      }
      complete_follow_up: {
        Args: { p_follow_up_id: string; p_payload: Json }
        Returns: Json
      }
      confirm_causal_relation: {
        Args: { p_org_id: string; p_reason: string; p_relation_id: string }
        Returns: undefined
      }
      create_ai_contradiction_relations: {
        Args: { p_client_id: string; p_items: Json; p_org_id: string }
        Returns: Json
      }
      create_ai_hypotheses: {
        Args: { p_client_id: string; p_hypotheses: Json; p_org_id: string }
        Returns: Json
      }
      create_behavioral_marker: {
        Args: { p_client_id: string; p_org_id: string; p_payload: Json }
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
      create_client_goal: {
        Args: {
          p_client_id: string
          p_description: string
          p_importance: string
          p_org_id: string
          p_target_state: string
          p_title: string
        }
        Returns: string
      }
      create_client_request: {
        Args: {
          p_client_id: string
          p_description: string
          p_org_id: string
          p_priority: string
          p_success_criteria: string
          p_title: string
        }
        Returns: string
      }
      create_core_node: {
        Args: {
          p_client_id: string
          p_confidence_score: number
          p_hypothesis: string
          p_org_id: string
          p_root_domain: string
          p_title: string
        }
        Returns: string
      }
      create_core_node_reactivation: {
        Args: {
          p_client_id: string
          p_core_node_id: string
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      create_correction_from_recommendation: {
        Args: { p_client_id: string; p_org_id: string; p_payload: Json }
        Returns: string
      }
      create_development_target: {
        Args: { p_client_id: string; p_org_id: string; p_payload: Json }
        Returns: string
      }
      create_diagnostic_session: {
        Args: {
          p_client_id: string
          p_input_format: string
          p_notes: string
          p_org_id: string
          p_raw_input: string
          p_session_type: string
          p_signals: Json
          p_source_type: string
          p_title: string
        }
        Returns: Json
      }
      create_evidence_clusters: {
        Args: {
          p_client_id: string
          p_clusters: Json
          p_org_id: string
          p_session_id: string
        }
        Returns: Json
      }
      create_feedback_form: {
        Args: {
          p_client_id: string
          p_correction_id: string
          p_follow_up_id: string
          p_org_id: string
          p_questions: Json
          p_title: string
        }
        Returns: string
      }
      create_hypothesis: {
        Args: {
          p_client_id: string
          p_confidence_score: number
          p_description: string
          p_org_id: string
          p_title: string
        }
        Returns: string
      }
      create_life_event: {
        Args: {
          p_client_id: string
          p_date: string
          p_description: string
          p_event_type: string
          p_org_id: string
          p_significance: string
          p_source_type: string
          p_title: string
          p_visibility: string
        }
        Returns: string
      }
      create_observation: {
        Args: { p_client_id: string; p_org_id: string; p_payload: Json }
        Returns: Json
      }
      create_org_belief_template: {
        Args: { p_org_id: string; p_payload: Json }
        Returns: Json
      }
      create_org_domain: {
        Args: { p_org_id: string; p_payload: Json }
        Returns: Json
      }
      create_org_method: {
        Args: { p_org_id: string; p_payload: Json }
        Returns: Json
      }
      create_organization: { Args: { org_name: string }; Returns: string }
      create_portal_user: {
        Args: { p_client_id: string; p_email: string }
        Returns: string
      }
      create_purpose_profile: {
        Args: { p_client_id: string; p_org_id: string; p_payload: Json }
        Returns: string
      }
      create_purpose_synthesis: {
        Args: { p_client_id: string; p_org_id: string; p_payload: Json }
        Returns: string
      }
      create_recommendations: {
        Args: { p_client_id: string; p_org_id: string; p_payload: Json }
        Returns: Json
      }
      create_relation: {
        Args: {
          p_client_id: string
          p_confidence: number
          p_evidence_summary: string
          p_from_core_node_id: string
          p_org_id: string
          p_relation_type: string
          p_strength: number
          p_to_core_node_id: string
        }
        Returns: string
      }
      create_relationship: {
        Args: {
          p_client_a_id: string
          p_client_b_id: string
          p_org_id: string
          p_relationship_type: string
        }
        Returns: string
      }
      create_relationship_dynamic: {
        Args: {
          p_confidence_score: number
          p_description: string
          p_evidence_refs: string[]
          p_org_id: string
          p_relationship_id: string
          p_title: string
          p_visibility: string
        }
        Returns: string
      }
      create_resource: {
        Args: {
          p_client_id: string
          p_confidence_score: number
          p_description: string
          p_domain: string
          p_evidence_summary: string
          p_name: string
          p_org_id: string
          p_strength_score: number
        }
        Returns: string
      }
      create_safety_review: {
        Args: {
          p_category: string
          p_client_id: string
          p_org_id: string
          p_severity: string
          p_source: string
        }
        Returns: string
      }
      create_signal: {
        Args: { p_client_id: string; p_org_id: string; p_signal: Json }
        Returns: string
      }
      create_snapshot: {
        Args: {
          p_client_id: string
          p_org_id: string
          p_payload: Json
          p_reason: string
        }
        Returns: Json
      }
      create_theme: {
        Args: {
          p_client_id: string
          p_description: string
          p_domain: string
          p_name: string
          p_org_id: string
        }
        Returns: string
      }
      create_trigger: {
        Args: {
          p_client_id: string
          p_description: string
          p_intensity: number
          p_life_event_id: string
          p_occurred_at: string
          p_org_id: string
          p_source_type: string
          p_title: string
          p_visibility: string
        }
        Returns: string
      }
      erasure_impact_tables: { Args: never; Returns: string[] }
      execute_client_erasure: { Args: { p_client_id: string }; Returns: Json }
      expire_export_requests: {
        Args: { p_limit?: number }
        Returns: {
          export_id: string
          outcome: string
        }[]
      }
      export_audience_allowed: {
        Args: {
          p_audience: Database["public"]["Enums"]["export_audience"]
          p_client_id: string
          p_org_id: string
        }
        Returns: boolean
      }
      export_contract_version: {
        Args: {
          p_format: Database["public"]["Enums"]["export_format"]
          p_kind: Database["public"]["Enums"]["export_kind"]
        }
        Returns: string
      }
      export_format_for_kind: {
        Args: { p_kind: Database["public"]["Enums"]["export_kind"] }
        Returns: Database["public"]["Enums"]["export_format"]
      }
      export_relationship_consent_withdrawn: {
        Args: { p_client_id: string }
        Returns: boolean
      }
      fail_export_request: {
        Args: { p_export_id: string; p_failure_code: string }
        Returns: undefined
      }
      finalize_import: {
        Args: {
          p_counts: Json
          p_fatal_errors: Json
          p_import_id: string
          p_org_id: string
          p_report: Json
        }
        Returns: Json
      }
      get_client_portal_overview: { Args: never; Returns: Json }
      goal_status_transition_allowed: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
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
      ingest_signals: {
        Args: {
          p_client_id: string
          p_org_id: string
          p_session_id: string
          p_signals: Json
        }
        Returns: Json
      }
      insert_model_change_internal: {
        Args: {
          p_change_reason: string
          p_client_id: string
          p_entity_id: string
          p_entity_type: string
          p_evidence_refs: string[]
          p_new_state: Json
          p_org_id: string
          p_previous_state: Json
        }
        Returns: string
      }
      insert_signal_row: {
        Args: { p_client_id: string; p_org_id: string; p_signal: Json }
        Returns: string
      }
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
      jsonb_object_ids: { Args: { p_value: Json }; Returns: string[] }
      jsonb_text_array: { Args: { p_value: Json }; Returns: string[] }
      link_theme_core_node: {
        Args: {
          p_confidence: number
          p_core_node_id: string
          p_link_rationale: string
          p_org_id: string
          p_relationship_type: string
          p_theme_id: string
        }
        Returns: undefined
      }
      link_theme_signal: {
        Args: {
          p_link_rationale: string
          p_org_id: string
          p_relevance_score: number
          p_signal_id: string
          p_theme_id: string
        }
        Returns: undefined
      }
      list_client_assignments: {
        Args: { p_client_id: string; p_org_id: string }
        Returns: {
          access_role: string
          email: string
          granted_at: string
          user_id: string
        }[]
      }
      list_client_portal_feedback_forms: { Args: never; Returns: Json }
      opaque_client_ref: { Args: { p_client_id: string }; Returns: string }
      opaque_export_ref: { Args: { p_export_id: string }; Returns: string }
      p_payload_missing_required: {
        Args: { p_assessment: Json }
        Returns: boolean
      }
      portal_client_id: { Args: never; Returns: string }
      purge_client_ai_runs: { Args: { p_client_id: string }; Returns: number }
      recompute_theme_aggregates: {
        Args: { p_theme_id: string }
        Returns: undefined
      }
      recompute_theme_aggregates_internal: {
        Args: { p_theme_id: string }
        Returns: undefined
      }
      record_behavioral_marker_value: {
        Args: { p_marker_id: string; p_note: string; p_value: number }
        Returns: Json
      }
      record_export_download: {
        Args: { p_bytes: number; p_export_id: string; p_sha256: string }
        Returns: number
      }
      record_model_change: {
        Args: {
          p_change_reason: string
          p_client_id: string
          p_entity_id: string
          p_entity_type: string
          p_evidence_refs: Json
          p_new_state: Json
          p_org_id: string
          p_previous_state: Json
        }
        Returns: Json
      }
      relationship_visible_evidence_refs: {
        Args: {
          p_client_a_id: string
          p_client_b_id: string
          p_org_id: string
          p_refs: string[]
        }
        Returns: string[]
      }
      request_client_erasure: { Args: { p_client_id: string }; Returns: Json }
      request_export: {
        Args: {
          p_audience: Database["public"]["Enums"]["export_audience"]
          p_client_id: string
          p_contract_version: string
          p_format: Database["public"]["Enums"]["export_format"]
          p_idempotency_key: string
          p_kind: Database["public"]["Enums"]["export_kind"]
          p_snapshot_version?: number
        }
        Returns: {
          export_id: string
          organization_id: string
          state: Database["public"]["Enums"]["export_request_status"]
        }[]
      }
      request_status_transition_allowed: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
      require_org_member_actor: {
        Args: { p_organization_id: string }
        Returns: string
      }
      require_org_owner_actor: {
        Args: { p_organization_id: string }
        Returns: string
      }
      review_core_node_reactivation: {
        Args: {
          p_decision: string
          p_org_id: string
          p_reactivation_id: string
        }
        Returns: Json
      }
      review_follow_up_assessment: {
        Args: {
          p_assessment: Json
          p_decision: string
          p_final_status: string
          p_follow_up_id: string
          p_model_change_reason: string
        }
        Returns: Json
      }
      review_hypothesis: {
        Args: {
          p_decision: string
          p_hypothesis_id: string
          p_org_id: string
          p_reason: string
        }
        Returns: undefined
      }
      review_model_explanation: {
        Args: { p_decision: string; p_explanation_id: string; p_org_id: string }
        Returns: Json
      }
      review_recommendation: {
        Args: {
          p_decision: string
          p_org_id: string
          p_reason: string
          p_recommendation_id: string
        }
        Returns: undefined
      }
      review_signal: {
        Args: {
          p_action: string
          p_org_id: string
          p_reason: string
          p_signal_id: string
        }
        Returns: undefined
      }
      review_theme: {
        Args: {
          p_decision: string
          p_org_id: string
          p_reason: string
          p_theme_id: string
        }
        Returns: undefined
      }
      revoke_client_assignment: {
        Args: { p_client_id: string; p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      revoke_consent: {
        Args: { p_client_id: string; p_consent_type: string; p_org_id: string }
        Returns: undefined
      }
      revoke_portal_user: {
        Args: { p_portal_user_id: string }
        Returns: boolean
      }
      save_model_explanation: {
        Args: {
          p_action: string
          p_client_id: string
          p_org_id: string
          p_payload: Json
        }
        Returns: Json
      }
      schedule_follow_up: {
        Args: {
          p_client_id: string
          p_correction_id: string
          p_org_id: string
          p_scheduled_at: string
        }
        Returns: Json
      }
      set_client_legal_hold: {
        Args: { p_client_id: string; p_hold: boolean }
        Returns: Json
      }
      set_core_node_status: {
        Args: {
          p_mark_archived: boolean
          p_mark_confirmed: boolean
          p_node_id: string
          p_org_id: string
          p_status: string
        }
        Returns: undefined
      }
      set_follow_up_ai_assessment: {
        Args: { p_action: string; p_assessment: Json; p_follow_up_id: string }
        Returns: Json
      }
      set_member_status: {
        Args: { p_org_id: string; p_status: string; p_user_id: string }
        Returns: undefined
      }
      set_recommendation_visibility: {
        Args: {
          p_org_id: string
          p_reason: string
          p_recommendation_id: string
          p_visibility: string
        }
        Returns: undefined
      }
      submit_feedback_form: {
        Args: { p_answers: Json; p_form_id: string }
        Returns: string
      }
      transfer_ownership: {
        Args: { p_new_owner_id: string; p_org_id: string }
        Returns: undefined
      }
      unlink_theme_signal: {
        Args: { p_org_id: string; p_signal_id: string; p_theme_id: string }
        Returns: undefined
      }
      update_behavioral_marker: {
        Args: { p_marker_id: string; p_patch: Json }
        Returns: Json
      }
      update_client: {
        Args: { p_client_id: string; p_org_id: string; p_patch: Json }
        Returns: undefined
      }
      update_correction: {
        Args: { p_correction_id: string; p_patch: Json }
        Returns: Json
      }
      update_development_target: {
        Args: {
          p_org_id: string
          p_patch: Json
          p_reason: string
          p_target_id: string
        }
        Returns: undefined
      }
      update_member_role: {
        Args: { p_org_id: string; p_role: string; p_user_id: string }
        Returns: undefined
      }
      update_observation: {
        Args: { p_observation_id: string; p_patch: Json }
        Returns: Json
      }
      update_org_method: {
        Args: { p_method_id: string; p_patch: Json }
        Returns: Json
      }
      update_organization_settings: {
        Args: { p_name: string; p_org_id: string; p_retention: Json }
        Returns: undefined
      }
      update_resource: {
        Args: { p_patch: Json; p_reason: string; p_resource_id: string }
        Returns: undefined
      }
      validate_behavioral_marker_link: {
        Args: {
          p_client_id: string
          p_link_id: string
          p_link_type: string
          p_organization_id: string
        }
        Returns: boolean
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
      validate_explanation_grounding: {
        Args: { p_explanations: Json; p_grounding: Json }
        Returns: string[]
      }
    }
    Enums: {
      export_audience: "owner" | "specialist" | "supervisor" | "client"
      export_format: "json" | "csv" | "markdown" | "pdf"
      export_kind: "client_archive" | "signals_csv" | "supervision_export"
      export_request_status:
        | "requested"
        | "generating"
        | "available"
        | "failed"
        | "denied"
        | "expired"
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
    Enums: {
      export_audience: ["owner", "specialist", "supervisor", "client"],
      export_format: ["json", "csv", "markdown", "pdf"],
      export_kind: ["client_archive", "signals_csv", "supervision_export"],
      export_request_status: [
        "requested",
        "generating",
        "available",
        "failed",
        "denied",
        "expired",
      ],
    },
  },
} as const


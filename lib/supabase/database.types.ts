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


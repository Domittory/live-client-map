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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization: { Args: { org_name: string }; Returns: string }
      health_check: { Args: never; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
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


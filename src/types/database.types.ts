export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_usage_logs: {
        Row: {
          bank_id: string
          cost_tokens: number
          created_at: string
          id: string
          model: string
          org_id: string
          user_id: string
        }
        Insert: {
          bank_id: string
          cost_tokens?: number
          created_at?: string
          id?: string
          model: string
          org_id: string
          user_id: string
        }
        Update: {
          bank_id?: string
          cost_tokens?: number
          created_at?: string
          id?: string
          model?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          alert_key: string
          body: string
          created_at: string
          email_sent_at: string | null
          href: string | null
          id: string
          is_dismissed: boolean
          is_read: boolean
          metadata: Json
          org_id: string
          resolved_at: string | null
          severity: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          alert_key: string
          body: string
          created_at?: string
          email_sent_at?: string | null
          href?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          metadata?: Json
          org_id: string
          resolved_at?: string | null
          severity?: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          alert_key?: string
          body?: string
          created_at?: string
          email_sent_at?: string | null
          href?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          metadata?: Json
          org_id?: string
          resolved_at?: string | null
          severity?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          bank_id: string
          created_at: string
          id: string
          metadata: Json | null
          org_id: string | null
          resource: string
          resource_id: string | null
          summary: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          bank_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          org_id?: string | null
          resource: string
          resource_id?: string | null
          summary?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          bank_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          org_id?: string | null
          resource?: string
          resource_id?: string | null
          summary?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_name: string
          account_number_masked: string
          account_type: string
          balance: number
          bank_name: string
          created_at: string
          currency: string
          entity_id: string | null
          iban: string | null
          id: string
          last_synced_at: string | null
          notes: string | null
          org_id: string
          status: string
          swift_bic: string | null
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number_masked?: string
          account_type?: string
          balance?: number
          bank_name: string
          created_at?: string
          currency?: string
          entity_id?: string | null
          iban?: string | null
          id?: string
          last_synced_at?: string | null
          notes?: string | null
          org_id: string
          status?: string
          swift_bic?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number_masked?: string
          account_type?: string
          balance?: number
          bank_name?: string
          created_at?: string
          currency?: string
          entity_id?: string | null
          iban?: string | null
          id?: string
          last_synced_at?: string | null
          notes?: string | null
          org_id?: string
          status?: string
          swift_bic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_brand: {
        Row: {
          accent_color: string | null
          bank_id: string
          email_from_addr: string | null
          email_from_name: string | null
          favicon_url: string | null
          logo_url: string | null
          page_title: string | null
          primary_color: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accent_color?: string | null
          bank_id: string
          email_from_addr?: string | null
          email_from_name?: string | null
          favicon_url?: string | null
          logo_url?: string | null
          page_title?: string | null
          primary_color?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accent_color?: string | null
          bank_id?: string
          email_from_addr?: string | null
          email_from_name?: string | null
          favicon_url?: string | null
          logo_url?: string | null
          page_title?: string | null
          primary_color?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_brand_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: true
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_commercial: {
        Row: {
          allowed_modules: string[]
          allowed_tiers: string[]
          bank_id: string
          contract_ends: string | null
          contract_starts: string | null
          created_at: string
          tier_display: Json
          updated_at: string
        }
        Insert: {
          allowed_modules?: string[]
          allowed_tiers?: string[]
          bank_id: string
          contract_ends?: string | null
          contract_starts?: string | null
          created_at?: string
          tier_display?: Json
          updated_at?: string
        }
        Update: {
          allowed_modules?: string[]
          allowed_tiers?: string[]
          bank_id?: string
          contract_ends?: string | null
          contract_starts?: string | null
          created_at?: string
          tier_display?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_commercial_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: true
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_features: {
        Row: {
          bank_id: string
          features: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bank_id: string
          features?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bank_id?: string
          features?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_features_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: true
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_identity: {
        Row: {
          bank_id: string
          cidr_allowlist: unknown[]
          group_role_mapping: Json
          idle_timeout_minutes: number
          idp_acs_url: string | null
          idp_entity_id: string | null
          idp_metadata_url: string | null
          idp_protocol: string | null
          required_aal: string
          updated_at: string
        }
        Insert: {
          bank_id: string
          cidr_allowlist?: unknown[]
          group_role_mapping?: Json
          idle_timeout_minutes?: number
          idp_acs_url?: string | null
          idp_entity_id?: string | null
          idp_metadata_url?: string | null
          idp_protocol?: string | null
          required_aal?: string
          updated_at?: string
        }
        Update: {
          bank_id?: string
          cidr_allowlist?: unknown[]
          group_role_mapping?: Json
          idle_timeout_minutes?: number
          idp_acs_url?: string | null
          idp_entity_id?: string | null
          idp_metadata_url?: string | null
          idp_protocol?: string | null
          required_aal?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_identity_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: true
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_integrations: {
        Row: {
          bank_id: string
          config: Json
          created_at: string
          credentials_ref: string | null
          enabled: boolean
          id: string
          integration_type: string
          updated_at: string
          vendor: string
        }
        Insert: {
          bank_id: string
          config?: Json
          created_at?: string
          credentials_ref?: string | null
          enabled?: boolean
          id?: string
          integration_type: string
          updated_at?: string
          vendor: string
        }
        Update: {
          bank_id?: string
          config?: Json
          created_at?: string
          credentials_ref?: string | null
          enabled?: boolean
          id?: string
          integration_type?: string
          updated_at?: string
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_integrations_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_policy_versions: {
        Row: {
          approval_reason: string
          approved_by: string | null
          bank_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          policy_data: Json
          version_number: number
        }
        Insert: {
          approval_reason: string
          approved_by?: string | null
          bank_id: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          policy_data: Json
          version_number: number
        }
        Update: {
          approval_reason?: string
          approved_by?: string | null
          bank_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          policy_data?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_policy_versions_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      banks: {
        Row: {
          created_at: string
          display_name: string
          id: string
          legal_name: string
          region: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          legal_name: string
          region: string
          slug: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          legal_name?: string
          region?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      budget_rates: {
        Row: {
          budget_rate: number
          created_at: string
          currency_pair: string
          description: string | null
          entity_id: string | null
          fiscal_year: number
          id: string
          notional_budget: number
          org_id: string
          period: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          budget_rate: number
          created_at?: string
          currency_pair: string
          description?: string | null
          entity_id?: string | null
          fiscal_year: number
          id?: string
          notional_budget?: number
          org_id: string
          period: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          budget_rate?: number
          created_at?: string
          currency_pair?: string
          description?: string | null
          entity_id?: string | null
          fiscal_year?: number
          id?: string
          notional_budget?: number
          org_id?: string
          period?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_rates_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_rates_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      capex: {
        Row: {
          budget_amount: number
          category: string | null
          committed_amount: number
          created_at: string
          currency: string
          description: string | null
          entity: string | null
          entity_id: string | null
          id: string
          org_id: string
          payment_date: string | null
          project_name: string
          status: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          budget_amount: number
          category?: string | null
          committed_amount?: number
          created_at?: string
          currency: string
          description?: string | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          org_id: string
          payment_date?: string | null
          project_name: string
          status?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          budget_amount?: number
          category?: string | null
          committed_amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          org_id?: string
          payment_date?: string | null
          project_name?: string
          status?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capex_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capex_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capex_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_flows: {
        Row: {
          account: string | null
          amount: number
          category: string | null
          confidence: string
          counterparty: string | null
          created_at: string
          currency: string
          description: string | null
          entity: string | null
          entity_id: string | null
          flow_date: string
          flow_type: string
          id: string
          org_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          account?: string | null
          amount: number
          category?: string | null
          confidence?: string
          counterparty?: string | null
          created_at?: string
          currency: string
          description?: string | null
          entity?: string | null
          entity_id?: string | null
          flow_date: string
          flow_type?: string
          id?: string
          org_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          account?: string | null
          amount?: number
          category?: string | null
          confidence?: string
          counterparty?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          entity?: string | null
          entity_id?: string | null
          flow_date?: string
          flow_type?: string
          id?: string
          org_id?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_flows_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flows_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commodity_exposures: {
        Row: {
          commodity_type: string
          created_at: string
          delivery_end_date: string
          delivery_start_date: string
          description: string | null
          direction: string
          entity_id: string | null
          id: string
          org_id: string
          price_index_reference: string
          status: string
          unit_of_measure: string
          updated_at: string
          volume: number
        }
        Insert: {
          commodity_type: string
          created_at?: string
          delivery_end_date: string
          delivery_start_date: string
          description?: string | null
          direction: string
          entity_id?: string | null
          id?: string
          org_id: string
          price_index_reference: string
          status?: string
          unit_of_measure: string
          updated_at?: string
          volume: number
        }
        Update: {
          commodity_type?: string
          created_at?: string
          delivery_end_date?: string
          delivery_start_date?: string
          description?: string | null
          direction?: string
          entity_id?: string | null
          id?: string
          org_id?: string
          price_index_reference?: string
          status?: string
          unit_of_measure?: string
          updated_at?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "commodity_exposures_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commodity_exposures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      commodity_hedges: {
        Row: {
          commodity_type: string
          contracted_price: number
          counterparty_bank: string | null
          created_at: string
          created_by: string | null
          direction: string
          entity_id: string | null
          id: string
          instrument_type: string
          notes: string | null
          org_id: string
          price_index_reference: string
          reference_number: string | null
          settlement_date: string
          status: string
          trade_date: string
          unit_of_measure: string
          updated_at: string
          volume: number
        }
        Insert: {
          commodity_type: string
          contracted_price: number
          counterparty_bank?: string | null
          created_at?: string
          created_by?: string | null
          direction: string
          entity_id?: string | null
          id?: string
          instrument_type: string
          notes?: string | null
          org_id: string
          price_index_reference: string
          reference_number?: string | null
          settlement_date: string
          status?: string
          trade_date: string
          unit_of_measure: string
          updated_at?: string
          volume: number
        }
        Update: {
          commodity_type?: string
          contracted_price?: number
          counterparty_bank?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          entity_id?: string | null
          id?: string
          instrument_type?: string
          notes?: string | null
          org_id?: string
          price_index_reference?: string
          reference_number?: string | null
          settlement_date?: string
          status?: string
          trade_date?: string
          unit_of_measure?: string
          updated_at?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "commodity_hedges_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commodity_hedges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contracts: {
        Row: {
          contract_value: number
          created_at: string
          currency: string
          customer_name: string
          description: string | null
          end_date: string | null
          entity_id: string | null
          id: string
          next_payment_date: string | null
          org_id: string
          payment_amount: number | null
          payment_frequency: string | null
          region: string | null
          segment: string | null
          start_date: string | null
          status: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          contract_value: number
          created_at?: string
          currency: string
          customer_name: string
          description?: string | null
          end_date?: string | null
          entity_id?: string | null
          id?: string
          next_payment_date?: string | null
          org_id: string
          payment_amount?: number | null
          payment_frequency?: string | null
          region?: string | null
          segment?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          contract_value?: number
          created_at?: string
          currency?: string
          customer_name?: string
          description?: string | null
          end_date?: string | null
          entity_id?: string | null
          id?: string
          next_payment_date?: string | null
          org_id?: string
          payment_amount?: number | null
          payment_frequency?: string | null
          region?: string | null
          segment?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_contracts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contracts_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_health_scores: {
        Row: {
          computed_at: string
          dimensions: Json
          gaps: Json
          id: string
          org_id: string
          overall_score: number
          status: string
        }
        Insert: {
          computed_at?: string
          dimensions?: Json
          gaps?: Json
          id?: string
          org_id: string
          overall_score: number
          status: string
        }
        Update: {
          computed_at?: string
          dimensions?: Json
          gaps?: Json
          id?: string
          org_id?: string
          overall_score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_health_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notifications: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          cta_url: string | null
          gap_type: string
          id: string
          message: string
          org_id: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          cta_url?: string | null
          gap_type: string
          id?: string
          message: string
          org_id: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          cta_url?: string | null
          gap_type?: string
          id?: string
          message?: string
          org_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          alert_id: string | null
          bank_id: string
          email_type: string
          error: string | null
          id: string
          org_id: string
          recipient: string
          sent_at: string
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          alert_id?: string | null
          bank_id: string
          email_type: string
          error?: string | null
          id?: string
          org_id: string
          recipient: string
          sent_at?: string
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          alert_id?: string | null
          bank_id?: string
          email_type?: string
          error?: string | null
          id?: string
          org_id?: string
          recipient?: string
          sent_at?: string
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string | null
          functional_currency: string
          id: string
          is_active: boolean
          jurisdiction: string | null
          name: string
          org_id: string
          parent_entity_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          functional_currency?: string
          id?: string
          is_active?: boolean
          jurisdiction?: string | null
          name: string
          org_id: string
          parent_entity_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          functional_currency?: string
          id?: string
          is_active?: boolean
          jurisdiction?: string | null
          name?: string
          org_id?: string
          parent_entity_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entities_parent_entity_id_fkey"
            columns: ["parent_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_connections: {
        Row: {
          config: Json
          connector_type: string
          created_at: string
          credentials_set: boolean
          display_name: string
          id: string
          last_error: string | null
          last_sync_count: number | null
          last_sync_status: string | null
          last_synced_at: string | null
          org_id: string
          status: string
          sync_frequency: string
          sync_modules: string[]
          updated_at: string
        }
        Insert: {
          config?: Json
          connector_type: string
          created_at?: string
          credentials_set?: boolean
          display_name: string
          id?: string
          last_error?: string | null
          last_sync_count?: number | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          org_id: string
          status?: string
          sync_frequency?: string
          sync_modules?: string[]
          updated_at?: string
        }
        Update: {
          config?: Json
          connector_type?: string
          created_at?: string
          credentials_set?: boolean
          display_name?: string
          id?: string
          last_error?: string | null
          last_sync_count?: number | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          org_id?: string
          status?: string
          sync_frequency?: string
          sync_modules?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      field_mappings: {
        Row: {
          ai_reasoning: string | null
          confidence: number
          created_at: string
          discovery_id: string
          human_notes: string | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          sample_values: Json
          source_data_type: string | null
          source_field: string
          source_table: string
          status: string
          target_entity: string
          target_field: string
        }
        Insert: {
          ai_reasoning?: string | null
          confidence?: number
          created_at?: string
          discovery_id: string
          human_notes?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sample_values?: Json
          source_data_type?: string | null
          source_field: string
          source_table: string
          status?: string
          target_entity: string
          target_field: string
        }
        Update: {
          ai_reasoning?: string | null
          confidence?: number
          created_at?: string
          discovery_id?: string
          human_notes?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sample_values?: Json
          source_data_type?: string | null
          source_field?: string
          source_table?: string
          status?: string
          target_entity?: string
          target_field?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_mappings_discovery_id_fkey"
            columns: ["discovery_id"]
            isOneToOne: false
            referencedRelation: "schema_discoveries"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_exposures: {
        Row: {
          base_currency: string
          created_at: string
          currency_pair: string
          description: string | null
          direction: string
          entity: string
          entity_id: string | null
          id: string
          notional_base: number
          notional_usd: number | null
          org_id: string
          quote_currency: string
          settlement_date: string
          source_system: string | null
          status: string
          updated_at: string
          upload_batch_id: string | null
        }
        Insert: {
          base_currency: string
          created_at?: string
          currency_pair: string
          description?: string | null
          direction: string
          entity: string
          entity_id?: string | null
          id?: string
          notional_base: number
          notional_usd?: number | null
          org_id: string
          quote_currency: string
          settlement_date: string
          source_system?: string | null
          status?: string
          updated_at?: string
          upload_batch_id?: string | null
        }
        Update: {
          base_currency?: string
          created_at?: string
          currency_pair?: string
          description?: string | null
          direction?: string
          entity?: string
          entity_id?: string | null
          id?: string
          notional_base?: number
          notional_usd?: number | null
          org_id?: string
          quote_currency?: string
          settlement_date?: string
          source_system?: string | null
          status?: string
          updated_at?: string
          upload_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fx_exposures_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_exposures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          created_at: string
          currency_pair: string
          id: string
          rate: number
          rate_date: string
          source: string | null
        }
        Insert: {
          created_at?: string
          currency_pair: string
          id?: string
          rate: number
          rate_date: string
          source?: string | null
        }
        Update: {
          created_at?: string
          currency_pair?: string
          id?: string
          rate?: number
          rate_date?: string
          source?: string | null
        }
        Relationships: []
      }
      hedge_policies: {
        Row: {
          active: boolean
          allowed_instruments: string[] | null
          base_currency: string
          coverage_horizon_months: number
          created_at: string
          entity_id: string | null
          id: string
          max_coverage_pct: number
          max_tenor_months: number | null
          min_coverage_pct: number
          min_notional_threshold: number
          min_tenor_days: number
          name: string
          org_id: string
          rebalance_frequency: string
          target_hedge_ratio_pct: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowed_instruments?: string[] | null
          base_currency?: string
          coverage_horizon_months?: number
          created_at?: string
          entity_id?: string | null
          id?: string
          max_coverage_pct?: number
          max_tenor_months?: number | null
          min_coverage_pct?: number
          min_notional_threshold?: number
          min_tenor_days?: number
          name?: string
          org_id: string
          rebalance_frequency?: string
          target_hedge_ratio_pct?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowed_instruments?: string[] | null
          base_currency?: string
          coverage_horizon_months?: number
          created_at?: string
          entity_id?: string | null
          id?: string
          max_coverage_pct?: number
          max_tenor_months?: number | null
          min_coverage_pct?: number
          min_notional_threshold?: number
          min_tenor_days?: number
          name?: string
          org_id?: string
          rebalance_frequency?: string
          target_hedge_ratio_pct?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hedge_policies_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hedge_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      hedge_positions: {
        Row: {
          amended_at: string | null
          base_currency: string
          close_date: string | null
          close_rate: number | null
          contracted_rate: number
          counterparty_bank: string | null
          created_at: string
          created_by: string | null
          currency_pair: string
          direction: string
          entity_id: string | null
          hedge_type: string
          id: string
          instrument_type: string
          notes: string | null
          notional_base: number
          notional_usd: number | null
          org_id: string
          quote_currency: string
          reference_number: string | null
          rolled_from_id: string | null
          spot_rate_at_trade: number | null
          status: string
          trade_date: string
          updated_at: string
          value_date: string
        }
        Insert: {
          amended_at?: string | null
          base_currency: string
          close_date?: string | null
          close_rate?: number | null
          contracted_rate: number
          counterparty_bank?: string | null
          created_at?: string
          created_by?: string | null
          currency_pair: string
          direction: string
          entity_id?: string | null
          hedge_type?: string
          id?: string
          instrument_type: string
          notes?: string | null
          notional_base: number
          notional_usd?: number | null
          org_id: string
          quote_currency: string
          reference_number?: string | null
          rolled_from_id?: string | null
          spot_rate_at_trade?: number | null
          status?: string
          trade_date: string
          updated_at?: string
          value_date: string
        }
        Update: {
          amended_at?: string | null
          base_currency?: string
          close_date?: string | null
          close_rate?: number | null
          contracted_rate?: number
          counterparty_bank?: string | null
          created_at?: string
          created_by?: string | null
          currency_pair?: string
          direction?: string
          entity_id?: string | null
          hedge_type?: string
          id?: string
          instrument_type?: string
          notes?: string | null
          notional_base?: number
          notional_usd?: number | null
          org_id?: string
          quote_currency?: string
          reference_number?: string | null
          rolled_from_id?: string | null
          spot_rate_at_trade?: number | null
          status?: string
          trade_date?: string
          updated_at?: string
          value_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "hedge_positions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hedge_positions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hedge_positions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hedge_positions_rolled_from_id_fkey"
            columns: ["rolled_from_id"]
            isOneToOne: false
            referencedRelation: "hedge_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      intercompany_transfers: {
        Row: {
          amount: number
          created_at: string
          currency: string
          description: string | null
          entity_id: string | null
          from_entity: string
          id: string
          org_id: string
          reference: string | null
          status: string
          to_entity: string
          transfer_date: string
          transfer_type: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          description?: string | null
          entity_id?: string | null
          from_entity: string
          id?: string
          org_id: string
          reference?: string | null
          status?: string
          to_entity: string
          transfer_date: string
          transfer_type?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          entity_id?: string | null
          from_entity?: string
          id?: string
          org_id?: string
          reference?: string | null
          status?: string
          to_entity?: string
          transfer_date?: string
          transfer_type?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intercompany_transfers_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transfers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transfers_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_schedules: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          entity_id: string | null
          id: string
          interest_rate: number
          lender: string
          loan_id: string
          loan_type: string | null
          maturity_date: string | null
          org_id: string
          outstanding_balance: number
          payment_amount: number | null
          payment_date: string | null
          payment_type: string | null
          principal: number
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          currency: string
          description?: string | null
          entity_id?: string | null
          id?: string
          interest_rate: number
          lender: string
          loan_id: string
          loan_type?: string | null
          maturity_date?: string | null
          org_id: string
          outstanding_balance: number
          payment_amount?: number | null
          payment_date?: string | null
          payment_type?: string | null
          principal: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          entity_id?: string | null
          id?: string
          interest_rate?: number
          lender?: string
          loan_id?: string
          loan_type?: string | null
          maturity_date?: string | null
          org_id?: string
          outstanding_balance?: number
          payment_amount?: number | null
          payment_date?: string | null
          payment_type?: string | null
          principal?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_schedules_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_schedules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_schedules_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mapping_templates: {
        Row: {
          created_at: string
          created_from_org_id: string | null
          erp_type: string
          erp_version: string | null
          id: string
          mappings: Json
          success_rate: number | null
          template_name: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          created_at?: string
          created_from_org_id?: string | null
          erp_type: string
          erp_version?: string | null
          id?: string
          mappings: Json
          success_rate?: number | null
          template_name: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          created_at?: string
          created_from_org_id?: string | null
          erp_type?: string
          erp_version?: string | null
          id?: string
          mappings?: Json
          success_rate?: number | null
          template_name?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          alert_types: string[]
          created_at: string
          digest_frequency: string
          digest_time: number
          email_digest: boolean
          email_urgent: boolean
          id: string
          org_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_types?: string[]
          created_at?: string
          digest_frequency?: string
          digest_time?: number
          email_digest?: boolean
          email_urgent?: boolean
          id?: string
          org_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_types?: string[]
          created_at?: string
          digest_frequency?: string
          digest_time?: number
          email_digest?: boolean
          email_urgent?: boolean
          id?: string
          org_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      nudges: {
        Row: {
          acknowledged_at: string | null
          channel: string
          gap_type: string
          id: string
          message: string | null
          org_id: string
          sent_at: string
          sent_by: string
        }
        Insert: {
          acknowledged_at?: string | null
          channel: string
          gap_type: string
          id?: string
          message?: string | null
          org_id: string
          sent_at?: string
          sent_by: string
        }
        Update: {
          acknowledged_at?: string | null
          channel?: string
          gap_type?: string
          id?: string
          message?: string | null
          org_id?: string
          sent_at?: string
          sent_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "nudges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_events: {
        Row: {
          created_at: string
          event_data: Json
          event_type: string
          from_status: string | null
          id: string
          session_id: string
          to_status: string
        }
        Insert: {
          created_at?: string
          event_data?: Json
          event_type: string
          from_status?: string | null
          id?: string
          session_id: string
          to_status: string
        }
        Update: {
          created_at?: string
          event_data?: Json
          event_type?: string
          from_status?: string | null
          id?: string
          session_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          completed_at: string | null
          created_by: string
          current_step_started_at: string | null
          error_message: string | null
          id: string
          metadata: Json
          org_id: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_by: string
          current_step_started_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          org_id: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_by?: string
          current_step_started_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          org_id?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          bank_id: string
          created_at: string
          domain: string | null
          id: string
          modules: string[]
          monthly_fee: number | null
          name: string
          plan: string
          setup_fee: number | null
          updated_at: string
        }
        Insert: {
          bank_id: string
          created_at?: string
          domain?: string | null
          id?: string
          modules?: string[]
          monthly_fee?: number | null
          name: string
          plan?: string
          setup_fee?: number | null
          updated_at?: string
        }
        Update: {
          bank_id?: string
          created_at?: string
          domain?: string | null
          id?: string
          modules?: string[]
          monthly_fee?: number | null
          name?: string
          plan?: string
          setup_fee?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisations_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_profiles: {
        Row: {
          annual_revenue_band: string | null
          bank_relationships: string[]
          created_at: string
          entities: Json
          fiscal_year_end_month: number | null
          functional_currency: string
          fx_pain_points: string | null
          hedging_policy_url: string | null
          id: string
          industry: string | null
          org_id: string
          reporting_cadence: string | null
          reporting_currencies: string[]
          transaction_currencies: string[]
          updated_at: string
        }
        Insert: {
          annual_revenue_band?: string | null
          bank_relationships?: string[]
          created_at?: string
          entities?: Json
          fiscal_year_end_month?: number | null
          functional_currency: string
          fx_pain_points?: string | null
          hedging_policy_url?: string | null
          id?: string
          industry?: string | null
          org_id: string
          reporting_cadence?: string | null
          reporting_currencies?: string[]
          transaction_currencies?: string[]
          updated_at?: string
        }
        Update: {
          annual_revenue_band?: string | null
          bank_relationships?: string[]
          created_at?: string
          entities?: Json
          fiscal_year_end_month?: number | null
          functional_currency?: string
          fx_pain_points?: string | null
          hedging_policy_url?: string | null
          id?: string
          industry?: string | null
          org_id?: string
          reporting_cadence?: string | null
          reporting_currencies?: string[]
          transaction_currencies?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll: {
        Row: {
          created_at: string
          currency: string
          department: string | null
          description: string | null
          employee_count: number | null
          entity: string | null
          entity_id: string | null
          gross_amount: number
          id: string
          net_amount: number | null
          org_id: string
          pay_date: string
          pay_period: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          currency: string
          department?: string | null
          description?: string | null
          employee_count?: number | null
          entity?: string | null
          entity_id?: string | null
          gross_amount: number
          id?: string
          net_amount?: number | null
          org_id: string
          pay_date: string
          pay_period?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          department?: string | null
          description?: string | null
          employee_count?: number | null
          entity?: string | null
          entity_id?: string | null
          gross_amount?: number
          id?: string
          net_amount?: number | null
          org_id?: string
          pay_date?: string
          pay_period?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_action_events: {
        Row: {
          created_at: string
          event_source: string
          from_status: string | null
          id: string
          payload: Json
          platform_action_id: string
          to_status: string
        }
        Insert: {
          created_at?: string
          event_source: string
          from_status?: string | null
          id?: string
          payload?: Json
          platform_action_id: string
          to_status: string
        }
        Update: {
          created_at?: string
          event_source?: string
          from_status?: string | null
          id?: string
          payload?: Json
          platform_action_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_action_events_platform_action_id_fkey"
            columns: ["platform_action_id"]
            isOneToOne: false
            referencedRelation: "platform_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_actions: {
        Row: {
          action_type: string
          bank_id: string
          bank_quote_id: string | null
          bank_trade_id: string | null
          client_request_id: string
          created_at: string
          id: string
          last_known_result: Json | null
          last_polled_at: string | null
          next_poll_at: string | null
          org_id: string
          spec: Json
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          action_type: string
          bank_id: string
          bank_quote_id?: string | null
          bank_trade_id?: string | null
          client_request_id: string
          created_at?: string
          id?: string
          last_known_result?: Json | null
          last_polled_at?: string | null
          next_poll_at?: string | null
          org_id: string
          spec: Json
          status: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          action_type?: string
          bank_id?: string
          bank_quote_id?: string | null
          bank_trade_id?: string | null
          client_request_id?: string
          created_at?: string
          id?: string
          last_known_result?: Json | null
          last_polled_at?: string | null
          next_poll_at?: string | null
          org_id?: string
          spec?: Json
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_actions_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          org_id: string
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          org_id: string
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          org_id?: string
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          currency: string
          description: string | null
          due_date: string | null
          entity_id: string | null
          id: string
          issue_date: string | null
          org_id: string
          po_number: string
          status: string
          supplier: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          currency: string
          description?: string | null
          due_date?: string | null
          entity_id?: string | null
          id?: string
          issue_date?: string | null
          org_id: string
          po_number: string
          status?: string
          supplier: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          entity_id?: string | null
          id?: string
          issue_date?: string | null
          org_id?: string
          po_number?: string
          status?: string
          supplier?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_forecasts: {
        Row: {
          amount: number
          created_at: string
          currency: string
          description: string | null
          entity_id: string | null
          fiscal_year: number
          id: string
          org_id: string
          period: string
          region: string | null
          segment: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          description?: string | null
          entity_id?: string | null
          fiscal_year: number
          id?: string
          org_id: string
          period: string
          region?: string | null
          segment?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          entity_id?: string | null
          fiscal_year?: number
          id?: string
          org_id?: string
          period?: string
          region?: string | null
          segment?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_forecasts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_forecasts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_forecasts_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_discoveries: {
        Row: {
          ai_analysis: Json | null
          candidate_tables: Json | null
          completed_at: string | null
          confidence_score: number | null
          connection_id: string | null
          created_at: string
          currencies_found: string[]
          error_message: string | null
          estimated_exposure_count: number | null
          id: string
          raw_schema: Json | null
          sample_data: Json | null
          session_id: string
          started_at: string | null
          status: string
          tables_identified: number | null
          tables_scanned: number | null
        }
        Insert: {
          ai_analysis?: Json | null
          candidate_tables?: Json | null
          completed_at?: string | null
          confidence_score?: number | null
          connection_id?: string | null
          created_at?: string
          currencies_found?: string[]
          error_message?: string | null
          estimated_exposure_count?: number | null
          id?: string
          raw_schema?: Json | null
          sample_data?: Json | null
          session_id: string
          started_at?: string | null
          status?: string
          tables_identified?: number | null
          tables_scanned?: number | null
        }
        Update: {
          ai_analysis?: Json | null
          candidate_tables?: Json | null
          completed_at?: string | null
          confidence_score?: number | null
          connection_id?: string | null
          created_at?: string
          currencies_found?: string[]
          error_message?: string | null
          estimated_exposure_count?: number | null
          id?: string
          raw_schema?: Json | null
          sample_data?: Json | null
          session_id?: string
          started_at?: string | null
          status?: string
          tables_identified?: number | null
          tables_scanned?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "schema_discoveries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_contracts: {
        Row: {
          category: string | null
          contract_value: number
          created_at: string
          currency: string
          description: string | null
          end_date: string | null
          entity_id: string | null
          id: string
          next_payment_date: string | null
          org_id: string
          payment_amount: number | null
          payment_frequency: string | null
          start_date: string | null
          status: string
          supplier_name: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          contract_value: number
          created_at?: string
          currency: string
          description?: string | null
          end_date?: string | null
          entity_id?: string | null
          id?: string
          next_payment_date?: string | null
          org_id: string
          payment_amount?: number | null
          payment_frequency?: string | null
          start_date?: string | null
          status?: string
          supplier_name: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          contract_value?: number
          created_at?: string
          currency?: string
          description?: string | null
          end_date?: string | null
          entity_id?: string | null
          id?: string
          next_payment_date?: string | null
          org_id?: string
          payment_amount?: number | null
          payment_frequency?: string | null
          start_date?: string | null
          status?: string
          supplier_name?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_contracts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_contracts_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_access_grants: {
        Row: {
          created_at: string
          expires_at: string
          granted_at: string
          id: string
          org_id: string
          reason: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          granted_at?: string
          id?: string
          org_id: string
          reason: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          granted_at?: string
          id?: string
          org_id?: string
          reason?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_access_grants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_audit_logs: {
        Row: {
          action: string
          actor_email: string
          actor_id: string
          actor_role: string
          created_at: string
          id: string
          metadata: Json | null
          resource: string
          resource_id: string | null
          summary: string | null
          target_org_id: string | null
          target_org_name: string | null
        }
        Insert: {
          action: string
          actor_email: string
          actor_id: string
          actor_role: string
          created_at?: string
          id?: string
          metadata?: Json | null
          resource: string
          resource_id?: string | null
          summary?: string | null
          target_org_id?: string | null
          target_org_name?: string | null
        }
        Update: {
          action?: string
          actor_email?: string
          actor_id?: string
          actor_role?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          resource?: string
          resource_id?: string | null
          summary?: string | null
          target_org_id?: string | null
          target_org_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_audit_logs_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_users: {
        Row: {
          bank_id: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean
          role: string
          updated_at: string
        }
        Insert: {
          bank_id?: string | null
          created_at?: string
          email: string
          id: string
          is_active?: boolean
          role: string
          updated_at?: string
        }
        Update: {
          bank_id?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_users_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_definitions: {
        Row: {
          annual_price_cents: number | null
          created_at: string
          description: string | null
          display_name: string
          feature_ai_recommendations: boolean
          feature_api_access: boolean
          feature_approval_workflows: boolean
          feature_audit_trail: boolean
          feature_board_reporting: boolean
          feature_coverage_analysis: boolean
          feature_custom_integrations: boolean
          feature_exposure_dashboard: boolean
          feature_hedge_tracking: boolean
          feature_multi_bank_rfq: boolean
          feature_policy_compliance: boolean
          feature_sso: boolean
          feature_trade_execution: boolean
          id: string
          max_users: number | null
          monthly_price_cents: number | null
          support_level: string | null
          support_sla_hours: number | null
        }
        Insert: {
          annual_price_cents?: number | null
          created_at?: string
          description?: string | null
          display_name: string
          feature_ai_recommendations?: boolean
          feature_api_access?: boolean
          feature_approval_workflows?: boolean
          feature_audit_trail?: boolean
          feature_board_reporting?: boolean
          feature_coverage_analysis?: boolean
          feature_custom_integrations?: boolean
          feature_exposure_dashboard?: boolean
          feature_hedge_tracking?: boolean
          feature_multi_bank_rfq?: boolean
          feature_policy_compliance?: boolean
          feature_sso?: boolean
          feature_trade_execution?: boolean
          id: string
          max_users?: number | null
          monthly_price_cents?: number | null
          support_level?: string | null
          support_sla_hours?: number | null
        }
        Update: {
          annual_price_cents?: number | null
          created_at?: string
          description?: string | null
          display_name?: string
          feature_ai_recommendations?: boolean
          feature_api_access?: boolean
          feature_approval_workflows?: boolean
          feature_audit_trail?: boolean
          feature_board_reporting?: boolean
          feature_coverage_analysis?: boolean
          feature_custom_integrations?: boolean
          feature_exposure_dashboard?: boolean
          feature_hedge_tracking?: boolean
          feature_multi_bank_rfq?: boolean
          feature_policy_compliance?: boolean
          feature_sso?: boolean
          feature_trade_execution?: boolean
          id?: string
          max_users?: number | null
          monthly_price_cents?: number | null
          support_level?: string | null
          support_sla_hours?: number | null
        }
        Relationships: []
      }
      upload_batches: {
        Row: {
          created_at: string
          entity_id: string | null
          error_message: string | null
          file_hash: string | null
          filename: string
          id: string
          org_id: string
          row_count: number
          status: string
          table_name: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          error_message?: string | null
          file_hash?: string | null
          filename: string
          id?: string
          org_id: string
          row_count?: number
          status?: string
          table_name?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          error_message?: string | null
          file_hash?: string | null
          filename?: string
          id?: string
          org_id?: string
          row_count?: number
          status?: string
          table_name?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_batches_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_exposure_summary: {
        Row: {
          base_currency: string | null
          currency_pair: string | null
          earliest_settlement: string | null
          exposure_count: number | null
          latest_settlement: string | null
          net_exposure: number | null
          org_id: string | null
          quote_currency: string | null
          total_payable: number | null
          total_receivable: number | null
          total_usd_equivalent: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fx_exposures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_hedge_coverage: {
        Row: {
          coverage_pct: number | null
          currency_pair: string | null
          net_exposure: number | null
          org_id: string | null
          total_hedged: number | null
          unhedged_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fx_exposures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invite: { Args: { p_invite_id: string }; Returns: string }
      advance_onboarding_status: {
        Args: { p_new_status: string; p_reason?: string; p_session_id: string }
        Returns: undefined
      }
      assert_support_can_act_on_org: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      check_and_log_ai_usage: { Args: { p_model: string }; Returns: boolean }
      current_support_bank_id: { Args: never; Returns: string }
      current_user_bank_id: { Args: never; Returns: string }
      current_user_org_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      delete_organisation: { Args: never; Returns: undefined }
      dump_schema_introspection: { Args: never; Returns: Json }
      get_support_user_role: { Args: never; Returns: string }
      has_support_access_to: { Args: { p_org_id: string }; Returns: boolean }
      has_support_access_to_bank: {
        Args: { p_bank_id: string }
        Returns: boolean
      }
      is_feature_enabled: {
        Args: { p_feature_key: string; p_org_id: string }
        Returns: boolean
      }
      is_quova_platform_admin: { Args: never; Returns: boolean }
      is_support_user: { Args: never; Returns: boolean }
      onboard_new_user: {
        Args: { p_full_name: string; p_org_name: string }
        Returns: string
      }
      platform_actions_is_terminal: {
        Args: { p_status: string }
        Returns: boolean
      }
      remove_member: { Args: { p_target_user_id: string }; Returns: undefined }
      submit_policy_change: {
        Args: {
          p_approval_reason: string
          p_bank_id: string
          p_effective_from: string
          p_policy_data: Json
        }
        Returns: string
      }
      support_can_see_org: { Args: { p_org_id: string }; Returns: boolean }
      support_change_org_modules: {
        Args: { p_modules: string[]; p_org_id: string; p_reason: string }
        Returns: undefined
      }
      support_change_org_plan: {
        Args: { p_new_plan: string; p_org_id: string; p_reason?: string }
        Returns: undefined
      }
      support_change_user_role: {
        Args: { p_new_role: string; p_profile_id: string; p_reason?: string }
        Returns: undefined
      }
      support_grant_org_access: {
        Args: { p_org_id: string; p_reason: string }
        Returns: string
      }
      support_revoke_org_access: {
        Args: { p_grant_id: string }
        Returns: undefined
      }
      support_set_org_pricing: {
        Args: {
          p_monthly_fee: number
          p_org_id: string
          p_reason?: string
          p_setup_fee: number
        }
        Returns: undefined
      }
      support_set_payment_method:
        | {
            Args: {
              p_ach_account_holder?: string
              p_ach_account_type?: string
              p_ach_bank_name?: string
              p_ach_last_four?: string
              p_cc_brand?: string
              p_cc_cardholder_name?: string
              p_cc_expiry_month?: number
              p_cc_expiry_year?: number
              p_cc_last_four?: string
              p_invoice_contact_name?: string
              p_invoice_email?: string
              p_invoice_terms?: string
              p_org_id: string
              p_payment_type: string
              p_reason?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_ach_account_holder?: string
              p_ach_account_type?: string
              p_ach_bank_name?: string
              p_ach_last_four?: string
              p_cc_brand?: string
              p_cc_cardholder_name?: string
              p_cc_expiry_month?: number
              p_cc_expiry_year?: number
              p_cc_last_four?: string
              p_invoice_contact_name?: string
              p_invoice_email?: string
              p_invoice_terms?: string
              p_org_id: string
              p_payment_type: string
              p_reason?: string
            }
            Returns: undefined
          }
      support_write_audit_log: {
        Args: {
          p_action: string
          p_metadata?: Json
          p_resource: string
          p_resource_id?: string
          p_summary?: string
          p_target_org_id?: string
        }
        Returns: undefined
      }
      update_member_role: {
        Args: { p_new_role: string; p_target_user_id: string }
        Returns: undefined
      }
      write_audit_log: {
        Args: {
          p_action: string
          p_metadata?: Json
          p_resource: string
          p_resource_id?: string
          p_summary?: string
        }
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
  public: {
    Enums: {},
  },
} as const

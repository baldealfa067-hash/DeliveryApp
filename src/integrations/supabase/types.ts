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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          recipients_count: number
          sent_by: string
          target_groups: string[]
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          recipients_count?: number
          sent_by: string
          target_groups: string[]
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          recipients_count?: number
          sent_by?: string
          target_groups?: string[]
          title?: string
        }
        Relationships: []
      }
      appointment_status_history: {
        Row: {
          appointment_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          status: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          status: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_status_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_date: string
          appointment_time: string
          business_id: string
          created_at: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          id: string
          notes: string | null
          service_name: string
          service_price: number | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_date: string
          appointment_time: string
          business_id: string
          created_at?: string
          customer_id?: string | null
          customer_name: string
          customer_phone: string
          id?: string
          notes?: string | null
          service_name: string
          service_price?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_date?: string
          appointment_time?: string
          business_id?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          id?: string
          notes?: string | null
          service_name?: string
          service_price?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bairros: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      beauty_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          name_en: string | null
          name_fr: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          name_en?: string | null
          name_fr?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          name_en?: string | null
          name_fr?: string | null
        }
        Relationships: []
      }
      beauty_items: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
          photo_url: string | null
          price: number | null
          price_type: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
          photo_url?: string | null
          price?: number | null
          price_type?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          photo_url?: string | null
          price?: number | null
          price_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "beauty_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      business_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          name_en: string | null
          name_fr: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          name_en?: string | null
          name_fr?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          name_en?: string | null
          name_fr?: string | null
        }
        Relationships: []
      }
      business_hours: {
        Row: {
          business_id: string
          closes_at: string
          created_at: string
          id: string
          opens_at: string
          weekday: number
        }
        Insert: {
          business_id: string
          closes_at: string
          created_at?: string
          id?: string
          opens_at: string
          weekday: number
        }
        Update: {
          business_id?: string
          closes_at?: string
          created_at?: string
          id?: string
          opens_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      business_order_counters: {
        Row: {
          business_id: string
          last_number: number
        }
        Insert: {
          business_id: string
          last_number?: number
        }
        Update: {
          business_id?: string
          last_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_order_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_settlements: {
        Row: {
          amount: number
          business_id: string
          contest_reason: string | null
          created_at: string
          declared_at: string
          declared_by: string | null
          dia: string
          fleet_id: string
          id: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          amount: number
          business_id: string
          contest_reason?: string | null
          created_at?: string
          declared_at?: string
          declared_by?: string | null
          dia?: string
          fleet_id: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          business_id?: string
          contest_reason?: string | null
          created_at?: string
          declared_at?: string
          declared_by?: string | null
          dia?: string
          fleet_id?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_settlements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_settlements_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          name_en: string | null
          name_fr: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          name_en?: string | null
          name_fr?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          name_en?: string | null
          name_fr?: string | null
        }
        Relationships: []
      }
      commission_payments: {
        Row: {
          amount: number
          business_id: string | null
          created_at: string
          fleet_id: string | null
          id: string
          note: string | null
          proof_url: string
          status: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          amount: number
          business_id?: string | null
          created_at?: string
          fleet_id?: string | null
          id?: string
          note?: string | null
          proof_url: string
          status?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          amount?: number
          business_id?: string | null
          created_at?: string
          fleet_id?: string | null
          id?: string
          note?: string | null
          proof_url?: string
          status?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_payments_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      complaints: {
        Row: {
          client_id: string | null
          contact: string | null
          created_at: string
          description: string | null
          id: string
          provider_id: string
          reason: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          client_id?: string | null
          contact?: string | null
          created_at?: string
          description?: string | null
          id?: string
          provider_id: string
          reason: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          client_id?: string | null
          contact?: string | null
          created_at?: string
          description?: string | null
          id?: string
          provider_id?: string
          reason?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaints_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          accepted_at: string | null
          code_attempts: number
          created_at: string
          customer_address: string | null
          customer_lat: number | null
          customer_lng: number | null
          delivered_at: string | null
          delivery_fee: number | null
          distance_km: number | null
          driver_id: string | null
          fleet_id: string | null
          id: string
          order_id: string
          picked_up_at: string | null
          restaurant_address: string | null
          restaurant_lat: number | null
          restaurant_lng: number | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          code_attempts?: number
          created_at?: string
          customer_address?: string | null
          customer_lat?: number | null
          customer_lng?: number | null
          delivered_at?: string | null
          delivery_fee?: number | null
          distance_km?: number | null
          driver_id?: string | null
          fleet_id?: string | null
          id?: string
          order_id: string
          picked_up_at?: string | null
          restaurant_address?: string | null
          restaurant_lat?: number | null
          restaurant_lng?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          code_attempts?: number
          created_at?: string
          customer_address?: string | null
          customer_lat?: number | null
          customer_lng?: number | null
          delivered_at?: string | null
          delivery_fee?: number | null
          distance_km?: number | null
          driver_id?: string | null
          fleet_id?: string | null
          id?: string
          order_id?: string
          picked_up_at?: string | null
          restaurant_address?: string | null
          restaurant_lat?: number | null
          restaurant_lng?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_proofs: {
        Row: {
          created_at: string
          delivery_id: string
          driver_id: string
          id: string
          order_id: string
          photo_url: string | null
          qr_validated: boolean
          validated_at: string | null
        }
        Insert: {
          created_at?: string
          delivery_id: string
          driver_id: string
          id?: string
          order_id: string
          photo_url?: string | null
          qr_validated?: boolean
          validated_at?: string | null
        }
        Update: {
          created_at?: string
          delivery_id?: string
          driver_id?: string
          id?: string
          order_id?: string
          photo_url?: string | null
          qr_validated?: boolean
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_proofs_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_proofs_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_proofs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_tracking: {
        Row: {
          created_at: string
          delivery_id: string
          id: string
          lat: number
          lng: number
          status: string
        }
        Insert: {
          created_at?: string
          delivery_id: string
          id?: string
          lat: number
          lng: number
          status?: string
        }
        Update: {
          created_at?: string
          delivery_id?: string
          id?: string
          lat?: number
          lng?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_tracking_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          delivery_id: string
          driver_id: string | null
          drivers_notified: number
          expires_at: string
          fleet_id: string | null
          id: string
          note: string | null
          offered_at: string
          order_id: string
          outcome: string
          resolved_at: string | null
        }
        Insert: {
          attempt_number?: number
          created_at?: string
          delivery_id: string
          driver_id?: string | null
          drivers_notified?: number
          expires_at: string
          fleet_id?: string | null
          id?: string
          note?: string | null
          offered_at?: string
          order_id: string
          outcome?: string
          resolved_at?: string | null
        }
        Update: {
          attempt_number?: number
          created_at?: string
          delivery_id?: string
          driver_id?: string | null
          drivers_notified?: number
          expires_at?: string
          fleet_id?: string | null
          id?: string
          note?: string | null
          offered_at?: string
          order_id?: string
          outcome?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_attempts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_attempts_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          bornaal_id: string | null
          created_at: string
          current_lat: number | null
          current_lng: number | null
          fleet_id: string | null
          id: string
          is_available: boolean
          last_location_update: string | null
          name: string
          phone: string
          updated_at: string
          user_id: string
          vehicle_type: string
        }
        Insert: {
          bornaal_id?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          fleet_id?: string | null
          id?: string
          is_available?: boolean
          last_location_update?: string | null
          name: string
          phone: string
          updated_at?: string
          user_id: string
          vehicle_type?: string
        }
        Update: {
          bornaal_id?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          fleet_id?: string | null
          id?: string
          is_available?: boolean
          last_location_update?: string | null
          name?: string
          phone?: string
          updated_at?: string
          user_id?: string
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_zone_prices: {
        Row: {
          bairro: string
          created_at: string
          fleet_id: string
          id: string
          is_active: boolean
          preco: number
          updated_at: string
        }
        Insert: {
          bairro: string
          created_at?: string
          fleet_id: string
          id?: string
          is_active?: boolean
          preco: number
          updated_at?: string
        }
        Update: {
          bairro?: string
          created_at?: string
          fleet_id?: string
          id?: string
          is_active?: boolean
          preco?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_zone_prices_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      fleets: {
        Row: {
          bairro: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          owner_user_id: string
          phone: string
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          owner_user_id: string
          phone: string
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          owner_user_id?: string
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          account_kind: string
          amount: number
          base_amount: number | null
          business_id: string | null
          ciclo: number
          counterparty: string
          created_at: string
          created_by: string | null
          delivery_id: string | null
          driver_id: string | null
          entry_type: string
          fleet_id: string | null
          id: string
          note: string | null
          order_id: string | null
          payment_id: string | null
          rate: number | null
          reverses_id: string | null
          settlement_id: string | null
        }
        Insert: {
          account_kind: string
          amount: number
          base_amount?: number | null
          business_id?: string | null
          ciclo?: number
          counterparty: string
          created_at?: string
          created_by?: string | null
          delivery_id?: string | null
          driver_id?: string | null
          entry_type: string
          fleet_id?: string | null
          id?: string
          note?: string | null
          order_id?: string | null
          payment_id?: string | null
          rate?: number | null
          reverses_id?: string | null
          settlement_id?: string | null
        }
        Update: {
          account_kind?: string
          amount?: number
          base_amount?: number | null
          business_id?: string | null
          ciclo?: number
          counterparty?: string
          created_at?: string
          created_by?: string | null
          delivery_id?: string | null
          driver_id?: string | null
          entry_type?: string
          fleet_id?: string | null
          id?: string
          note?: string | null
          order_id?: string | null
          payment_id?: string | null
          rate?: number | null
          reverses_id?: string | null
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "commission_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "cash_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          business_id: string
          category_id: string | null
          created_at: string
          id: string
          is_available: boolean
          is_orderable: boolean | null
          name: string
          photo_url: string | null
          price: number
          stock_qty: number | null
          track_stock: boolean
        }
        Insert: {
          business_id: string
          category_id?: string | null
          created_at?: string
          id?: string
          is_available?: boolean
          is_orderable?: boolean | null
          name: string
          photo_url?: string | null
          price: number
          stock_qty?: number | null
          track_stock?: boolean
        }
        Update: {
          business_id?: string
          category_id?: string | null
          created_at?: string
          id?: string
          is_available?: boolean
          is_orderable?: boolean | null
          name?: string
          photo_url?: string | null
          price?: number
          stock_qty?: number | null
          track_stock?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          image_url: string | null
          message_type: string
          read: boolean
          receiver_id: string
          sender_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          image_url?: string | null
          message_type?: string
          read?: boolean
          receiver_id: string
          sender_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          message_type?: string
          read?: boolean
          receiver_id?: string
          sender_id?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          is_read: boolean | null
          link: string | null
          message: string | null
          read: boolean
          reference_id: string | null
          reference_type: string | null
          request_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string | null
          read?: boolean
          reference_id?: string | null
          reference_type?: string | null
          request_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string | null
          read?: boolean
          reference_id?: string | null
          reference_type?: string | null
          request_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number | null
          menu_item_id: string | null
          name_snapshot: string
          order_id: string
          qty: number
          stock_returned_at: string | null
          unit_price_snapshot: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total?: number | null
          menu_item_id?: string | null
          name_snapshot: string
          order_id: string
          qty: number
          stock_returned_at?: string | null
          unit_price_snapshot: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number | null
          menu_item_id?: string | null
          name_snapshot?: string
          order_id?: string
          qty?: number
          stock_returned_at?: string | null
          unit_price_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_ratings: {
        Row: {
          business_id: string | null
          comment: string | null
          created_at: string
          customer_id: string
          customer_name: string | null
          driver_id: string | null
          id: string
          order_id: string
          rating: number
          target: string
        }
        Insert: {
          business_id?: string | null
          comment?: string | null
          created_at?: string
          customer_id: string
          customer_name?: string | null
          driver_id?: string | null
          id?: string
          order_id: string
          rating: number
          target: string
        }
        Update: {
          business_id?: string | null
          comment?: string | null
          created_at?: string
          customer_id?: string
          customer_name?: string | null
          driver_id?: string | null
          id?: string
          order_id?: string
          rating?: number
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_ratings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_ratings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          order_id: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id: string
          status: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address: string | null
          bairro: string | null
          business_id: string | null
          consumption_option: string
          created_at: string
          customer_id: string | null
          customer_lat: number | null
          customer_lng: number | null
          customer_name: string | null
          customer_phone: string | null
          delivery_code: string | null
          delivery_fee: number | null
          fleet_id: string | null
          id: string
          items: Json
          kind: string
          notes: string | null
          order_number: number
          payment_method: string | null
          payment_proof_url: string | null
          payment_status: string | null
          pickup_address: string | null
          pickup_bairro: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_voice_note_url: string | null
          preparation_time: number | null
          send_item_type: string | null
          source: string
          status: string
          total: number
          updated_at: string
          voice_note_url: string | null
        }
        Insert: {
          address?: string | null
          bairro?: string | null
          business_id?: string | null
          consumption_option: string
          created_at?: string
          customer_id?: string | null
          customer_lat?: number | null
          customer_lng?: number | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_code?: string | null
          delivery_fee?: number | null
          fleet_id?: string | null
          id?: string
          items?: Json
          kind?: string
          notes?: string | null
          order_number?: number
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string | null
          pickup_address?: string | null
          pickup_bairro?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_voice_note_url?: string | null
          preparation_time?: number | null
          send_item_type?: string | null
          source?: string
          status?: string
          total?: number
          updated_at?: string
          voice_note_url?: string | null
        }
        Update: {
          address?: string | null
          bairro?: string | null
          business_id?: string | null
          consumption_option?: string
          created_at?: string
          customer_id?: string | null
          customer_lat?: number | null
          customer_lng?: number | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_code?: string | null
          delivery_fee?: number | null
          fleet_id?: string | null
          id?: string
          items?: Json
          kind?: string
          notes?: string | null
          order_number?: number
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string | null
          pickup_address?: string | null
          pickup_bairro?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_voice_note_url?: string | null
          preparation_time?: number | null
          send_item_type?: string | null
          source?: string
          status?: string
          total?: number
          updated_at?: string
          voice_note_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      portfolio_images: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          image_url: string
          provider_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          provider_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_images_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accepting_orders: boolean
          bornaal_id: string | null
          category: string
          consumption_options: string[]
          created_at: string
          description: string | null
          id: string
          is_verified: boolean
          lat: number | null
          lng: number | null
          location: string
          merchant_code: string | null
          name: string
          orange_money_method: string | null
          payment_number: string | null
          phone: string
          photo_url: string | null
          prep_time_minutes: number | null
          price_type: string | null
          profile_type: string
          services: string[]
          starting_price: number | null
          updated_at: string
          user_id: string
          verification_doc_url: string | null
          verification_reason: string | null
          verification_selfie_url: string | null
          verification_status: string
          verification_submitted_at: string | null
        }
        Insert: {
          accepting_orders?: boolean
          bornaal_id?: string | null
          category: string
          consumption_options?: string[]
          created_at?: string
          description?: string | null
          id?: string
          is_verified?: boolean
          lat?: number | null
          lng?: number | null
          location: string
          merchant_code?: string | null
          name: string
          orange_money_method?: string | null
          payment_number?: string | null
          phone: string
          photo_url?: string | null
          prep_time_minutes?: number | null
          price_type?: string | null
          profile_type?: string
          services?: string[]
          starting_price?: number | null
          updated_at?: string
          user_id: string
          verification_doc_url?: string | null
          verification_reason?: string | null
          verification_selfie_url?: string | null
          verification_status?: string
          verification_submitted_at?: string | null
        }
        Update: {
          accepting_orders?: boolean
          bornaal_id?: string | null
          category?: string
          consumption_options?: string[]
          created_at?: string
          description?: string | null
          id?: string
          is_verified?: boolean
          lat?: number | null
          lng?: number | null
          location?: string
          merchant_code?: string | null
          name?: string
          orange_money_method?: string | null
          payment_number?: string | null
          phone?: string
          photo_url?: string | null
          prep_time_minutes?: number | null
          price_type?: string | null
          profile_type?: string
          services?: string[]
          starting_price?: number | null
          updated_at?: string
          user_id?: string
          verification_doc_url?: string | null
          verification_reason?: string | null
          verification_selfie_url?: string | null
          verification_status?: string
          verification_submitted_at?: string | null
        }
        Relationships: []
      }
      proposals: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          location: string
          price: number
          price_type: string
          provider_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          id?: string
          location: string
          price: number
          price_type?: string
          provider_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          location?: string
          price?: number
          price_type?: string
          provider_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_activity: {
        Row: {
          activity_type: string
          created_at: string
          id: string
          provider_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string
          id?: string
          provider_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string
          id?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_activity_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_stats: {
        Row: {
          call_clicks: number
          profile_views: number
          provider_id: string
          updated_at: string
          whatsapp_clicks: number
        }
        Insert: {
          call_clicks?: number
          profile_views?: number
          provider_id: string
          updated_at?: string
          whatsapp_clicks?: number
        }
        Update: {
          call_clicks?: number
          profile_views?: number
          provider_id?: string
          updated_at?: string
          whatsapp_clicks?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_stats_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys: Json
          novidades: boolean
          push_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys?: Json
          novidades?: boolean
          push_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys?: Json
          novidades?: boolean
          push_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quality_levels: {
        Row: {
          calculated_at: string
          id: string
          level: string
          provider_id: string
          score: number
        }
        Insert: {
          calculated_at?: string
          id?: string
          level: string
          provider_id: string
          score?: number
        }
        Update: {
          calculated_at?: string
          id?: string
          level?: string
          provider_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "quality_levels_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_bids: {
        Row: {
          created_at: string
          id: string
          message: string | null
          provider_id: string
          request_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          provider_id: string
          request_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          provider_id?: string
          request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_bids_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_bids_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          provider_id: string
          rating: number
          request_id: string | null
          reviewer_name: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          provider_id: string
          rating: number
          request_id?: string | null
          reviewer_name?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          provider_id?: string
          rating?: number
          request_id?: string | null
          reviewer_name?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          budget_amount: number | null
          budget_type: string
          category: string
          created_at: string
          deadline: string | null
          description: string
          id: string
          location: string
          requester_name: string | null
          requester_phone: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          budget_amount?: number | null
          budget_type?: string
          category: string
          created_at?: string
          deadline?: string | null
          description: string
          id?: string
          location: string
          requester_name?: string | null
          requester_phone?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          budget_amount?: number | null
          budget_type?: string
          category?: string
          created_at?: string
          deadline?: string | null
          description?: string
          id?: string
          location?: string
          requester_name?: string | null
          requester_phone?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      stock_adjustments: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          menu_item_id: string
          motivo: string
          order_id: string | null
          qty_antes: number | null
          qty_depois: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          menu_item_id: string
          motivo: string
          order_id?: string | null
          qty_antes?: number | null
          qty_depois?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          menu_item_id?: string
          motivo?: string
          order_id?: string | null
          qty_antes?: number | null
          qty_depois?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          created_at: string
          description: string | null
          id: string
          reason: string
          reported_id: string
          reporter_id: string
          status: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          reason: string
          reported_id: string
          reporter_id: string
          status?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          reason?: string
          reported_id?: string
          reporter_id?: string
          status?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_delivery: { Args: { p_delivery_id: string }; Returns: undefined }
      add_driver_to_fleet: {
        Args: { p_name?: string; p_phone: string; p_vehicle_type?: string }
        Returns: string
      }
      admin_delete_user: { Args: { p_profile_id: string }; Returns: undefined }
      admin_list_verifications: {
        Args: never
        Returns: {
          profile_id: string
          verification_doc_url: string
          verification_reason: string
          verification_selfie_url: string
        }[]
      }
      alert_stuck_orders: { Args: never; Returns: number }
      assert_can_order_for: {
        Args: { p_business_id: string; p_customer_id: string }
        Returns: undefined
      }
      assert_nota_voz_do_proprio: {
        Args: { p_ref: string }
        Returns: undefined
      }
      calculate_quality_score: {
        Args: { p_provider_id: string }
        Returns: number
      }
      cancel_cash_settlement: {
        Args: { p_settlement_id: string }
        Returns: undefined
      }
      claim_anonymous_requests: { Args: never; Returns: number }
      complete_delivery: { Args: { p_delivery_id: string }; Returns: undefined }
      comprovativo_comissao_ligado: {
        Args: { p_name: string }
        Returns: boolean
      }
      comprovativo_ligado_a_pedido: {
        Args: { p_name: string }
        Returns: boolean
      }
      confirm_cash_settlement: {
        Args: { p_settlement_id: string }
        Returns: Json
      }
      contest_cash_settlement: {
        Args: { p_reason: string; p_settlement_id: string }
        Returns: undefined
      }
      create_appointment: {
        Args: {
          p_appointment_date: string
          p_appointment_time: string
          p_business_id: string
          p_customer_id: string
          p_customer_name: string
          p_customer_phone: string
          p_notes?: string
          p_service_name: string
          p_service_price: number
        }
        Returns: string
      }
      create_delivery: {
        Args: {
          p_customer_address: string
          p_customer_lat: number
          p_customer_lng: number
          p_distance_km?: number
          p_order_id: string
          p_restaurant_address: string
          p_restaurant_lat: number
          p_restaurant_lng: number
        }
        Returns: string
      }
      create_delivery_proof: {
        Args: {
          p_delivery_id: string
          p_photo_url: string
          p_qr_validated?: boolean
        }
        Returns: string
      }
      create_fleet: {
        Args: { p_bairro?: string; p_name: string; p_phone: string }
        Returns: string
      }
      create_manual_order: {
        Args: {
          p_address?: string
          p_bairro?: string
          p_business_id: string
          p_concluir?: boolean
          p_consumption_option: string
          p_customer_name?: string
          p_customer_phone?: string
          p_items: Json
          p_notes?: string
          p_payment_method?: string
        }
        Returns: string
      }
      create_notification: {
        Args: {
          p_message: string
          p_reference_id?: string
          p_reference_type?: string
          p_title: string
          p_type?: string
          p_user_id: string
        }
        Returns: string
      }
      create_order: {
        Args: {
          p_address?: string
          p_bairro?: string
          p_business_id: string
          p_consumption_option: string
          p_customer_id: string
          p_customer_lat?: number
          p_customer_lng?: number
          p_customer_name: string
          p_customer_phone: string
          p_items: Json
          p_notes?: string
          p_payment_method?: string
          p_payment_proof_url?: string
          p_total: number
          p_voice_note_url?: string
        }
        Returns: string
      }
      create_send_order: {
        Args: {
          p_address: string
          p_bairro: string
          p_customer_lat?: number
          p_customer_lng?: number
          p_customer_name: string
          p_customer_phone: string
          p_description: string
          p_payment_method?: string
          p_pickup_address: string
          p_pickup_bairro?: string
          p_pickup_lat?: number
          p_pickup_lng?: number
          p_pickup_voice_note_url?: string
          p_send_item_type: string
          p_voice_note_url?: string
        }
        Returns: Json
      }
      declare_cash_settlement: {
        Args: {
          p_amount: number
          p_business_id: string
          p_dia?: string
          p_note?: string
        }
        Returns: string
      }
      divida_comida_em_aberto: {
        Args: { p_business_id: string; p_fleet_id: string }
        Returns: number
      }
      expire_stale_dispatch: { Args: never; Returns: number }
      generate_bornaal_id: { Args: never; Returns: string }
      get_all_commissions: {
        Args: never
        Returns: {
          account_id: string
          account_kind: string
          account_name: string
          commission_balance: number
          commission_due: number
          commission_paid: number
          total_base: number
        }[]
      }
      get_anon_key: { Args: never; Returns: string }
      get_available_deliveries: {
        Args: never
        Returns: {
          created_at: string
          customer_address: string
          delivery_fee: number
          distance_km: number
          id: string
          items: Json
          order_id: string
          order_total: number
          payment_method: string
          payment_status: string
          pickup_voice_note_url: string
          restaurant_address: string
          restaurant_lat: number
          restaurant_lng: number
          restaurant_name: string
          voice_note_url: string
        }[]
      }
      get_business_appointments: {
        Args: { p_business_id: string; p_status?: string }
        Returns: {
          appointment_date: string
          appointment_time: string
          created_at: string
          customer_name: string
          customer_phone: string
          id: string
          notes: string
          service_name: string
          service_price: number
          status: string
          updated_at: string
        }[]
      }
      get_business_cash_settlements: {
        Args: { p_business_id: string }
        Returns: Json
      }
      get_business_commission: {
        Args: { p_business_id: string }
        Returns: {
          commission_balance: number
          commission_due: number
          commission_paid: number
          commission_rate: number
          delivery_payable: number
          food_receivable: number
          total_sales: number
        }[]
      }
      get_business_daily_sales: {
        Args: { p_business_id: string; p_days?: number }
        Returns: {
          day: string
          order_count: number
          total: number
        }[]
      }
      get_business_hours: { Args: { p_business_id: string }; Returns: Json }
      get_business_orders: {
        Args: { p_business_id: string; p_status?: string }
        Returns: {
          address: string
          bairro: string
          business_id: string
          business_name: string
          consumption_option: string
          created_at: string
          customer_id: string
          customer_name: string
          customer_phone: string
          delivery_code: string
          delivery_fee: number
          id: string
          items: Json
          notes: string
          order_number: number
          payment_method: string
          payment_proof_url: string
          payment_status: string
          preparation_time: number
          source: string
          status: string
          total: number
          voice_note_url: string
        }[]
      }
      get_business_payment_info: {
        Args: { p_business_id: string }
        Returns: {
          merchant_code: string
          payment_number: string
        }[]
      }
      get_business_rating: {
        Args: { p_business_id: string }
        Returns: {
          media: number
          total: number
        }[]
      }
      get_business_sales_stats: {
        Args: { p_business_id: string }
        Returns: {
          avg_ticket: number
          month_count: number
          month_total: number
          today_count: number
          today_total: number
          week_count: number
          week_total: number
        }[]
      }
      get_customer_appointments: {
        Args: { p_customer_id: string }
        Returns: {
          appointment_date: string
          appointment_time: string
          business_id: string
          business_name: string
          created_at: string
          id: string
          notes: string
          service_name: string
          service_price: number
          status: string
          updated_at: string
        }[]
      }
      get_customer_orders: {
        Args: { p_customer_id: string }
        Returns: {
          address: string
          bairro: string
          business_id: string
          business_name: string
          business_phone: string
          consumption_option: string
          created_at: string
          customer_id: string
          customer_name: string
          customer_phone: string
          delivery_code: string
          delivery_fee: number
          driver_name: string
          driver_phone: string
          id: string
          items: Json
          notes: string
          order_number: number
          payment_method: string
          payment_proof_url: string
          payment_status: string
          preparation_time: number
          status: string
          total: number
          voice_note_url: string
        }[]
      }
      get_delivery_orders: {
        Args: { p_business_id: string }
        Returns: {
          created_at: string
          customer_address: string
          customer_name: string
          order_id: string
          order_number: number
          status: string
          total: number
        }[]
      }
      get_delivery_price: {
        Args: { p_bairro: string }
        Returns: {
          fleet_id: string
          fleet_name: string
          preco: number
        }[]
      }
      get_delivery_proof: { Args: { p_order_id: string }; Returns: Json }
      get_delivery_tracking: {
        Args: { p_delivery_id: string }
        Returns: {
          created_at: string
          lat: number
          lng: number
          status: string
        }[]
      }
      get_driver_daily_stats: {
        Args: { p_days?: number; p_driver_id: string }
        Returns: {
          day: string
          delivery_count: number
          distance: number
        }[]
      }
      get_driver_delivery_stats: {
        Args: { p_driver_id: string }
        Returns: {
          month_count: number
          month_distance: number
          month_earnings: number
          today_count: number
          today_distance: number
          today_earnings: number
          week_count: number
          week_distance: number
          week_earnings: number
        }[]
      }
      get_driver_rating: {
        Args: { p_driver_id: string }
        Returns: {
          media: number
          total: number
        }[]
      }
      get_fleet_cash_closing: { Args: { p_dia?: string }; Returns: Json }
      get_fleet_driver_detail: { Args: { p_driver_id: string }; Returns: Json }
      get_fleet_drivers: {
        Args: never
        Returns: {
          concluidas: number
          entregas: number
          id: string
          is_available: boolean
          name: string
          phone: string
          valor_entregas: number
          vehicle_type: string
        }[]
      }
      get_fleet_financials: { Args: never; Returns: Json }
      get_fleet_metrics: {
        Args: never
        Returns: {
          concluidas: number
          entregas: number
          fleet_id: string
          fleet_name: string
          motoristas: number
          motoristas_activos: number
          pendentes: number
          valor_entregas: number
        }[]
      }
      get_my_bornaal_id: { Args: never; Returns: string }
      get_my_deliveries: {
        Args: never
        Returns: {
          accepted_at: string
          created_at: string
          customer_address: string
          customer_lat: number
          customer_lng: number
          customer_name: string
          customer_phone: string
          delivered_at: string
          delivery_fee: number
          distance_km: number
          id: string
          items: Json
          order_id: string
          order_number: number
          order_total: number
          payment_method: string
          payment_status: string
          picked_up_at: string
          pickup_voice_note_url: string
          restaurant_address: string
          restaurant_lat: number
          restaurant_lng: number
          restaurant_name: string
          restaurant_phone: string
          status: string
          voice_note_url: string
        }[]
      }
      get_my_notifications: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          body: string
          created_at: string
          id: string
          is_read: boolean
          link: string
          message: string
          read: boolean
          reference_id: string
          reference_type: string
          title: string
          type: string
        }[]
      }
      get_my_profile_private: {
        Args: never
        Returns: {
          merchant_code: string
          orange_money_method: string
          payment_number: string
          verification_doc_url: string
          verification_reason: string
          verification_selfie_url: string
        }[]
      }
      get_my_rateable_orders: {
        Args: never
        Returns: {
          avaliou_motorista: boolean
          avaliou_restaurante: boolean
          order_id: string
          pode_avaliar_motorista: boolean
          pode_avaliar_restaurante: boolean
        }[]
      }
      get_order_history: {
        Args: { p_order_id: string }
        Returns: {
          created_at: string
          note: string
          status: string
        }[]
      }
      get_request_contact_phone: {
        Args: { p_request_id: string }
        Returns: string
      }
      get_unread_notifications_count: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_provider_view: {
        Args: { p_provider_id: string }
        Returns: undefined
      }
      is_business_open: {
        Args: { p_at?: string; p_business_id: string }
        Returns: boolean
      }
      is_business_owner: { Args: { p_business_id: string }; Returns: boolean }
      is_driver_of_fleet: { Args: { p_fleet_id: string }; Returns: boolean }
      ledger_registar_conclusao: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      ledger_reverter_pedido: {
        Args: { p_motivo: string; p_order_id: string }
        Returns: undefined
      }
      lookup_by_bornaal_id: {
        Args: { p_bornaal_id: string }
        Returns: {
          avatar_url: string
          bornaal_id: string
          full_name: string
          user_id: string
        }[]
      }
      mark_notifications_read: {
        Args: { p_ids?: string[] }
        Returns: undefined
      }
      mark_request_completed: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      nota_voz_ligada_a_pedido: { Args: { p_name: string }; Returns: boolean }
      offer_delivery_to_fleet: {
        Args: { p_attempt?: number; p_delivery_id: string }
        Returns: number
      }
      owns_fleet: { Args: { p_fleet_id: string }; Returns: boolean }
      pickup_delivery: { Args: { p_delivery_id: string }; Returns: undefined }
      pode_ouvir_nota_voz: { Args: { p_name: string }; Returns: boolean }
      pode_ver_comprovativo: { Args: { p_name: string }; Returns: boolean }
      pode_ver_comprovativo_comissao: {
        Args: { p_name: string }
        Returns: boolean
      }
      rate_order: {
        Args: {
          p_comment?: string
          p_order_id: string
          p_rating: number
          p_target: string
        }
        Returns: string
      }
      record_business_order: {
        Args: {
          p_address: string
          p_business_id: string
          p_consumption_option: string
          p_items: Json
          p_total: number
        }
        Returns: string
      }
      record_provider_contact: {
        Args: { contact_type: string; p_provider_id: string }
        Returns: undefined
      }
      register_as_beleza: { Args: never; Returns: undefined }
      register_as_business: { Args: never; Returns: undefined }
      register_as_client: { Args: never; Returns: undefined }
      register_as_driver: {
        Args: { p_name: string; p_phone: string; p_vehicle_type?: string }
        Returns: string
      }
      register_as_provider: { Args: never; Returns: undefined }
      remove_driver_from_fleet: {
        Args: { p_driver_id: string }
        Returns: undefined
      }
      reoffer_delivery: { Args: { p_order_id: string }; Returns: Json }
      search_bornaal_id: {
        Args: { p_prefix: string }
        Returns: {
          bornaal_id: string
          full_name: string
          user_id: string
        }[]
      }
      send_bulk_notification: {
        Args: { p_body: string; p_target_groups: string[]; p_title: string }
        Returns: number
      }
      set_accepting_orders: {
        Args: { p_aceitar: boolean; p_business_id: string }
        Returns: boolean
      }
      set_business_hours: {
        Args: { p_business_id: string; p_horario: Json }
        Returns: number
      }
      set_driver_active: {
        Args: { p_active: boolean; p_driver_id: string }
        Returns: undefined
      }
      set_menu_item_stock: {
        Args: {
          p_menu_item_id: string
          p_motivo?: string
          p_stock_qty: number
          p_track?: boolean
        }
        Returns: number
      }
      tem_prova_de_entrega: { Args: { p_order_id: string }; Returns: boolean }
      toggle_driver_availability: { Args: never; Returns: boolean }
      update_appointment_status: {
        Args: {
          p_appointment_id: string
          p_new_status: string
          p_note?: string
        }
        Returns: undefined
      }
      update_business_location: {
        Args: { p_lat: number; p_lng: number }
        Returns: undefined
      }
      update_delivery_tracking: {
        Args: {
          p_delivery_id: string
          p_lat: number
          p_lng: number
          p_status?: string
        }
        Returns: undefined
      }
      update_driver_location: {
        Args: { p_lat: number; p_lng: number }
        Returns: undefined
      }
      update_order_status: {
        Args: {
          p_new_status: string
          p_note?: string
          p_order_id: string
          p_preparation_time?: number
        }
        Returns: undefined
      }
      update_platform_setting: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      upsert_push_subscription: {
        Args: {
          p_endpoint: string
          p_keys: Json
          p_novidades?: boolean
          p_push_enabled?: boolean
        }
        Returns: {
          created_at: string
          endpoint: string
          id: string
          keys: Json
          novidades: boolean
          push_enabled: boolean
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "push_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_zone_price: {
        Args: { p_bairro: string; p_preco: number }
        Returns: undefined
      }
      validate_commission_payment: {
        Args: { p_id: string; p_note?: string; p_status: string }
        Returns: undefined
      }
      validate_delivery_code: {
        Args: { p_code: string; p_delivery_id: string }
        Returns: boolean
      }
      validate_delivery_qr: {
        Args: { p_delivery_id: string; p_order_id: string }
        Returns: boolean
      }
      validate_order_payment: {
        Args: { p_order_id: string; p_status: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "client"
        | "provider"
        | "admin"
        | "business"
        | "beleza"
        | "driver"
        | "fleet"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "client",
        "provider",
        "admin",
        "business",
        "beleza",
        "driver",
        "fleet",
      ],
    },
  },
} as const

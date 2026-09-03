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
          created_at: string
          customer_address: string | null
          customer_lat: number | null
          customer_lng: number | null
          delivered_at: string | null
          delivery_fee: number | null
          distance_km: number | null
          driver_id: string | null
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
          created_at?: string
          customer_address?: string | null
          customer_lat?: number | null
          customer_lng?: number | null
          delivered_at?: string | null
          delivery_fee?: number | null
          distance_km?: number | null
          driver_id?: string | null
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
          created_at?: string
          customer_address?: string | null
          customer_lat?: number | null
          customer_lng?: number | null
          delivered_at?: string | null
          delivery_fee?: number | null
          distance_km?: number | null
          driver_id?: string | null
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
      drivers: {
        Row: {
          bornaal_id: string | null
          created_at: string
          current_lat: number | null
          current_lng: number | null
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
          id?: string
          is_available?: boolean
          last_location_update?: string | null
          name?: string
          phone?: string
          updated_at?: string
          user_id?: string
          vehicle_type?: string
        }
        Relationships: []
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
          name: string
          photo_url: string | null
          price: number
        }
        Insert: {
          business_id: string
          category_id?: string | null
          created_at?: string
          id?: string
          name: string
          photo_url?: string | null
          price: number
        }
        Update: {
          business_id?: string
          category_id?: string | null
          created_at?: string
          id?: string
          name?: string
          photo_url?: string | null
          price?: number
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
          business_id: string
          consumption_option: string
          created_at: string
          customer_id: string | null
          customer_lat: number | null
          customer_lng: number | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          items: Json
          notes: string | null
          order_number: number
          preparation_time: number | null
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          bairro?: string | null
          business_id: string
          consumption_option: string
          created_at?: string
          customer_id?: string | null
          customer_lat?: number | null
          customer_lng?: number | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          items?: Json
          notes?: string | null
          order_number?: number
          preparation_time?: number | null
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          bairro?: string | null
          business_id?: string
          consumption_option?: string
          created_at?: string
          customer_id?: string | null
          customer_lat?: number | null
          customer_lng?: number | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          items?: Json
          notes?: string | null
          order_number?: number
          preparation_time?: number | null
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          name: string
          phone: string
          photo_url: string | null
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
          name: string
          phone: string
          photo_url?: string | null
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
          name?: string
          phone?: string
          photo_url?: string | null
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
      admin_delete_user: { Args: { p_profile_id: string }; Returns: undefined }
      calculate_quality_score: {
        Args: { p_provider_id: string }
        Returns: number
      }
      claim_anonymous_requests: { Args: never; Returns: number }
      complete_delivery: { Args: { p_delivery_id: string }; Returns: undefined }
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
      create_order:
        | {
            Args: {
              p_address?: string
              p_business_id: string
              p_consumption_option: string
              p_customer_id: string
              p_customer_name: string
              p_customer_phone: string
              p_items: Json
              p_notes?: string
              p_total: number
            }
            Returns: string
          }
        | {
            Args: {
              p_address?: string
              p_bairro?: string
              p_business_id: string
              p_consumption_option: string
              p_customer_id: string
              p_customer_name: string
              p_customer_phone: string
              p_items: Json
              p_notes?: string
              p_total: number
            }
            Returns: string
          }
        | {
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
              p_total: number
            }
            Returns: string
          }
      generate_bornaal_id: { Args: never; Returns: string }
      get_anon_key: { Args: never; Returns: string }
      get_available_deliveries: {
        Args: never
        Returns: {
          created_at: string
          customer_address: string
          delivery_fee: number
          distance_km: number
          id: string
          order_id: string
          restaurant_address: string
          restaurant_name: string
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
      get_business_orders: {
        Args: { p_business_id: string; p_status?: string }
        Returns: {
          address: string
          bairro: string
          consumption_option: string
          created_at: string
          customer_name: string
          customer_phone: string
          id: string
          items: Json
          notes: string
          order_number: number
          preparation_time: number
          status: string
          total: number
          updated_at: string
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
          consumption_option: string
          created_at: string
          id: string
          items: Json
          notes: string
          order_number: number
          preparation_time: number
          status: string
          total: number
          updated_at: string
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
      get_delivery_tracking: {
        Args: { p_delivery_id: string }
        Returns: {
          created_at: string
          lat: number
          lng: number
          status: string
        }[]
      }
      get_my_bornaal_id: { Args: never; Returns: string }
      get_my_deliveries: {
        Args: never
        Returns: {
          accepted_at: string
          created_at: string
          customer_address: string
          customer_name: string
          customer_phone: string
          delivered_at: string
          delivery_fee: number
          distance_km: number
          id: string
          order_id: string
          order_number: number
          picked_up_at: string
          restaurant_name: string
          restaurant_phone: string
          status: string
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
      get_order_history: {
        Args: { p_order_id: string }
        Returns: {
          created_at: string
          note: string
          status: string
        }[]
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
      pickup_delivery: { Args: { p_delivery_id: string }; Returns: undefined }
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
      validate_delivery_qr: {
        Args: { p_delivery_id: string; p_order_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "client" | "provider" | "admin" | "business" | "beleza"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["client", "provider", "admin", "business", "beleza"],
    },
  },
} as const

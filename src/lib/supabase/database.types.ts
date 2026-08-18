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
      appointment_management_sessions: {
        Row: {
          appointment_id: string
          created_at: string
          expires_at: string
          id: string
          session_secret_hash: string
          token_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          expires_at: string
          id?: string
          session_secret_hash: string
          token_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          session_secret_hash?: string
          token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_management_sessions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_management_sessions_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "appointment_management_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_management_tokens: {
        Row: {
          appointment_id: string
          created_at: string
          email_outbox_id: string | null
          expires_at: string
          id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          appointment_id: string
          created_at?: string
          email_outbox_id?: string | null
          expires_at: string
          id?: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          appointment_id?: string
          created_at?: string
          email_outbox_id?: string | null
          expires_at?: string
          id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_management_tokens_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_management_tokens_email_outbox_id_fkey"
            columns: ["email_outbox_id"]
            isOneToOne: true
            referencedRelation: "email_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_types: {
        Row: {
          created_at: string
          doctor_id: string
          duration_minutes: number
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          duration_minutes: number
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          duration_minutes?: number
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_types_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_type_id: string
          cancelled_at: string | null
          clinic_id: string
          created_at: string
          created_by_secretary_id: string | null
          doctor_id: string
          ends_at: string
          id: string
          notes: string | null
          patient_email: string | null
          patient_name: string
          patient_phone: string
          starts_at: string
          status: string
        }
        Insert: {
          appointment_type_id: string
          cancelled_at?: string | null
          clinic_id: string
          created_at?: string
          created_by_secretary_id?: string | null
          doctor_id: string
          ends_at: string
          id?: string
          notes?: string | null
          patient_email?: string | null
          patient_name: string
          patient_phone: string
          starts_at: string
          status?: string
        }
        Update: {
          appointment_type_id?: string
          cancelled_at?: string | null
          clinic_id?: string
          created_at?: string
          created_by_secretary_id?: string | null
          doctor_id?: string
          ends_at?: string
          id?: string
          notes?: string | null
          patient_email?: string | null
          patient_name?: string
          patient_phone?: string
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_doctor_id_appointment_type_id_fkey"
            columns: ["doctor_id", "appointment_type_id"]
            isOneToOne: false
            referencedRelation: "appointment_types"
            referencedColumns: ["doctor_id", "id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_clinic_id_fkey"
            columns: ["doctor_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["doctor_id", "id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_created_by_secretary_id_fkey"
            columns: ["doctor_id", "created_by_secretary_id"]
            isOneToOne: false
            referencedRelation: "doctor_secretaries"
            referencedColumns: ["doctor_id", "secretary_user_id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          details: Json
          entity_id: string | null
          entity_table: string
          id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_table: string
          id?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_table?: string
          id?: string
        }
        Relationships: []
      }
      blocked_periods: {
        Row: {
          clinic_id: string | null
          doctor_id: string
          ends_at: string
          id: string
          reason: string | null
          starts_at: string
        }
        Insert: {
          clinic_id?: string | null
          doctor_id: string
          ends_at: string
          id?: string
          reason?: string | null
          starts_at: string
        }
        Update: {
          clinic_id?: string | null
          doctor_id?: string
          ends_at?: string
          id?: string
          reason?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_periods_doctor_id_clinic_id_fkey"
            columns: ["doctor_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["doctor_id", "id"]
          },
          {
            foreignKeyName: "blocked_periods_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      breaks: {
        Row: {
          clinic_id: string
          day_of_week: number
          doctor_id: string
          end_time: string
          id: string
          start_time: string
        }
        Insert: {
          clinic_id: string
          day_of_week: number
          doctor_id: string
          end_time: string
          id?: string
          start_time: string
        }
        Update: {
          clinic_id?: string
          day_of_week?: number
          doctor_id?: string
          end_time?: string
          id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "breaks_doctor_id_clinic_id_fkey"
            columns: ["doctor_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["doctor_id", "id"]
          },
        ]
      }
      clinics: {
        Row: {
          address: string
          city: string | null
          created_at: string
          doctor_id: string
          id: string
          name: string
          timezone: string
          location_type: string
        }
        Insert: {
          address: string
          city?: string | null
          created_at?: string
          doctor_id: string
          id?: string
          name: string
          timezone: string
          location_type?: string
        }
        Update: {
          address?: string
          city?: string | null
          created_at?: string
          doctor_id?: string
          id?: string
          name?: string
          timezone?: string
          location_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinics_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_books: {
        Row: {
          created_at: string
          doctor_id: string
          id: string
          published_year: number | null
          publisher: string | null
          title: string
          url: string | null
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: string
          published_year?: number | null
          publisher?: string | null
          title: string
          url?: string | null
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: string
          published_year?: number | null
          publisher?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_books_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_media_appearances: {
        Row: {
          appeared_on: string | null
          created_at: string
          doctor_id: string
          id: string
          outlet: string | null
          title: string
          url: string | null
        }
        Insert: {
          appeared_on?: string | null
          created_at?: string
          doctor_id: string
          id?: string
          outlet?: string | null
          title: string
          url?: string | null
        }
        Update: {
          appeared_on?: string | null
          created_at?: string
          doctor_id?: string
          id?: string
          outlet?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_media_appearances_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_publications: {
        Row: {
          created_at: string
          doctor_id: string
          id: string
          publication_name: string | null
          published_year: number | null
          title: string
          url: string | null
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: string
          publication_name?: string | null
          published_year?: number | null
          title: string
          url?: string | null
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: string
          publication_name?: string | null
          published_year?: number | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_publications_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_qualifications: {
        Row: {
          created_at: string
          doctor_id: string
          id: string
          institution: string | null
          title: string
          year_obtained: number | null
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: string
          institution?: string | null
          title: string
          year_obtained?: number | null
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: string
          institution?: string | null
          title?: string
          year_obtained?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_qualifications_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_secretaries: {
        Row: {
          created_at: string
          doctor_id: string
          secretary_user_id: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          secretary_user_id: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          secretary_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_secretaries_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          bio: string | null
          created_at: string
          custom_template_key: string | null
          default_locale: string
          deleted_at: string | null
          full_name: string
          id: string
          is_published: boolean
          min_booking_notice_minutes: number
          page_variant: string
          phone: string | null
          slug: string
          specialty_id: string
          suspended_at: string | null
          timezone: string
          user_id: string
          photo_path: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          custom_template_key?: string | null
          default_locale: string
          deleted_at?: string | null
          full_name: string
          id?: string
          is_published?: boolean
          min_booking_notice_minutes?: number
          page_variant?: string
          phone?: string | null
          slug: string
          specialty_id: string
          suspended_at?: string | null
          timezone: string
          user_id: string
          photo_path?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          custom_template_key?: string | null
          default_locale?: string
          deleted_at?: string | null
          full_name?: string
          id?: string
          is_published?: boolean
          min_booking_notice_minutes?: number
          page_variant?: string
          phone?: string | null
          slug?: string
          specialty_id?: string
          suspended_at?: string | null
          timezone?: string
          user_id?: string
          photo_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctors_default_locale_fkey"
            columns: ["default_locale"]
            isOneToOne: false
            referencedRelation: "supported_locales"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "doctors_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          claim_token: string | null
          created_at: string
          first_send_attempt_at: string | null
          id: string
          last_error: string | null
          locale: string | null
          payload: Json
          processing_started_at: string | null
          sent_at: string | null
          status: string
          template: string
          template_version: number
          to_email: string
        }
        Insert: {
          attempts?: number
          claim_token?: string | null
          created_at?: string
          first_send_attempt_at?: string | null
          id?: string
          last_error?: string | null
          locale?: string | null
          payload?: Json
          processing_started_at?: string | null
          sent_at?: string | null
          status?: string
          template: string
          template_version?: number
          to_email: string
        }
        Update: {
          attempts?: number
          claim_token?: string | null
          created_at?: string
          first_send_attempt_at?: string | null
          id?: string
          last_error?: string | null
          locale?: string | null
          payload?: Json
          processing_started_at?: string | null
          sent_at?: string | null
          status?: string
          template?: string
          template_version?: number
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_locale_fkey"
            columns: ["locale"]
            isOneToOne: false
            referencedRelation: "supported_locales"
            referencedColumns: ["code"]
          },
        ]
      }
      schedule_exceptions: {
        Row: {
          clinic_id: string
          date: string
          doctor_id: string
          end_time: string | null
          id: string
          is_closed: boolean
          start_time: string | null
        }
        Insert: {
          clinic_id: string
          date: string
          doctor_id: string
          end_time?: string | null
          id?: string
          is_closed?: boolean
          start_time?: string | null
        }
        Update: {
          clinic_id?: string
          date?: string
          doctor_id?: string
          end_time?: string | null
          id?: string
          is_closed?: boolean
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_exceptions_doctor_id_clinic_id_fkey"
            columns: ["doctor_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["doctor_id", "id"]
          },
        ]
      }
      specialties: {
        Row: {
          created_at: string
          id: string
          name_ar: string
          name_fr: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name_ar: string
          name_fr: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name_ar?: string
          name_fr?: string
          slug?: string
        }
        Relationships: []
      }
      specialty_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          locale: string
          specialty_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          locale: string
          specialty_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          locale?: string
          specialty_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "specialty_aliases_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
        ]
      }
      supported_locales: {
        Row: {
          code: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      working_hours: {
        Row: {
          clinic_id: string
          day_of_week: number
          doctor_id: string
          end_time: string
          id: string
          start_time: string
        }
        Insert: {
          clinic_id: string
          day_of_week: number
          doctor_id: string
          end_time: string
          id?: string
          start_time: string
        }
        Update: {
          clinic_id?: string
          day_of_week?: number
          doctor_id?: string
          end_time?: string
          id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_hours_doctor_id_clinic_id_fkey"
            columns: ["doctor_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["doctor_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      book_appointment: {
        Args: {
          p_appointment_type_id: string
          p_clinic_id: string
          p_created_by_secretary_id?: string
          p_doctor_id: string
          p_management_token_expires_at?: string
          p_management_token_hash?: string
          p_patient_email: string
          p_patient_name: string
          p_patient_phone: string
          p_starts_at: string
        }
        Returns: {
          appointment_type_id: string
          cancelled_at: string | null
          clinic_id: string
          created_at: string
          created_by_secretary_id: string | null
          doctor_id: string
          ends_at: string
          id: string
          notes: string | null
          patient_email: string | null
          patient_name: string
          patient_phone: string
          starts_at: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_appointment: {
        Args: {
          p_actor_user_id?: string
          p_appointment_id: string
          p_management_session_secret_hash?: string
        }
        Returns: {
          appointment_type_id: string
          cancelled_at: string | null
          clinic_id: string
          created_at: string
          created_by_secretary_id: string | null
          doctor_id: string
          ends_at: string
          id: string
          notes: string | null
          patient_email: string | null
          patient_name: string
          patient_phone: string
          starts_at: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_email_outbox_batch: {
        Args: {
          p_claim_token: string
          p_limit: number
          p_max_attempts: number
          p_stale_after_minutes?: number
        }
        Returns: {
          attempts: number
          claim_token: string | null
          created_at: string
          first_send_attempt_at: string | null
          id: string
          last_error: string | null
          locale: string | null
          payload: Json
          processing_started_at: string | null
          sent_at: string | null
          status: string
          template: string
          template_version: number
          to_email: string
        }[]
        SetofOptions: {
          from: "*"
          to: "email_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      compute_available_slots: {
        Args: {
          p_appointment_type_id: string
          p_clinic_id: string
          p_doctor_id: string
          p_local_date: string
          p_now: string
        }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      create_management_token: {
        Args: {
          p_appointment_id: string
          p_email_outbox_id?: string
          p_expires_at: string
          p_token_hash: string
        }
        Returns: {
          appointment_id: string
          created_at: string
          email_outbox_id: string | null
          expires_at: string
          id: string
          token_hash: string
          used_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "appointment_management_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_appointment_outcome: {
        Args: {
          p_actor_user_id: string
          p_appointment_id: string
          p_outcome: string
        }
        Returns: {
          appointment_type_id: string
          cancelled_at: string | null
          clinic_id: string
          created_at: string
          created_by_secretary_id: string | null
          doctor_id: string
          ends_at: string
          id: string
          notes: string | null
          patient_email: string | null
          patient_name: string
          patient_phone: string
          starts_at: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      redeem_management_token: {
        Args: { p_session_secret_hash: string; p_token_hash: string }
        Returns: {
          appointment_id: string
          created_at: string
          expires_at: string
          id: string
          session_secret_hash: string
          token_id: string
        }
        SetofOptions: {
          from: "*"
          to: "appointment_management_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reschedule_appointment: {
        Args: {
          p_actor_user_id?: string
          p_appointment_id: string
          p_management_session_secret_hash?: string
          p_new_management_token_expires_at?: string
          p_new_management_token_hash?: string
          p_new_starts_at: string
        }
        Returns: {
          appointment_type_id: string
          cancelled_at: string | null
          clinic_id: string
          created_at: string
          created_by_secretary_id: string | null
          doctor_id: string
          ends_at: string
          id: string
          notes: string | null
          patient_email: string | null
          patient_name: string
          patient_phone: string
          starts_at: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
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


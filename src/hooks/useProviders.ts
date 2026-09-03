import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProviderWithRating {
  id: string;
  user_id: string;
  name: string;
  category: string;
  phone: string;
  location: string;
  description: string | null;
  photo_url: string | null;
  price_type: string;
  starting_price: number | null;
  services?: string[] | null;
  is_verified?: boolean | null;
  profile_type?: string | null;
  consumption_options?: string[] | null;
  avgRating: number;
  reviewCount: number;
}

export const useProviders = (profileType?: "provider" | "business" | "beleza") =>
  useQuery({
    queryKey: ["providers", profileType ?? "all"],
    queryFn: async (): Promise<ProviderWithRating[]> => {
      let q = supabase
        .from("profiles")
        .select("*")
        .neq("category", "")
        .in("profile_type", ["provider", "business", "beleza"]);
      if (profileType) q = q.eq("profile_type", profileType);
      const { data: profiles, error } = await q;
      if (error) throw error;

      // Fetch all reviews separately
      const profileIds = (profiles ?? []).map((p) => p.id);
      const reviews = profileIds.length
        ? (
            await supabase
              .from("reviews")
              .select("provider_id, rating")
              .eq("status", "aprovado")
              .in("provider_id", profileIds)
          ).data
        : [];

      return (profiles ?? []).map((p) => {
        const ratings = (reviews ?? [])
          .filter((r) => r.provider_id === p.id)
          .map((r) => r.rating);
        return {
          ...p,
          avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
          reviewCount: ratings.length,
        };
      });
    },
  });

export const useProvider = (id: string) =>
  useQuery({
    queryKey: ["provider", id],
    queryFn: async () => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;

      const { data: reviews } = await supabase
        .from("reviews")
        .select("id, rating, comment, created_at, user_id, reviewer_name")
        .eq("status", "aprovado")
        .eq("provider_id", id);

      const ratings = (reviews ?? []).map((r) => r.rating);
      return {
        ...profile,
        reviews: reviews ?? [],
        avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
        reviewCount: ratings.length,
      };
    },
    enabled: !!id,
  });

export const useCategories = () =>
  useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id, name, name_en, name_fr");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; name_en: string | null; name_fr: string | null }[];
    },
  });

// Legacy helper: returns only names sorted (for backwards compat)
export const useCategoryNames = () =>
  useQuery({
    queryKey: ["category-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("name");
      if (error) throw error;
      return (data ?? []).map((c) => c.name).sort();
    },
  });

export const useBusinessCategories = () =>
  useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("business_categories").select("id, name, name_en, name_fr");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; name_en: string | null; name_fr: string | null }[];
    },
  });

export const useBusinessCategoryNames = () =>
  useQuery({
    queryKey: ["business-category-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("business_categories").select("name");
      if (error) throw error;
      return (data ?? []).map((c) => c.name).sort();
    },
  });

export const useBeautyCategories = () =>
  useQuery({
    queryKey: ["beauty-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("beauty_categories").select("id, name, name_en, name_fr");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; name_en: string | null; name_fr: string | null }[];
    },
  });

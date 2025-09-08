import { useState, useEffect } from 'react';
import apiService from '@/lib/api';
import { DDAVariant } from '@/components/widgets/DDAVariantSelector';

interface UseDDAVariantsReturn {
  variants: DDAVariant[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDDAVariants(): UseDDAVariantsReturn {
  const [variants, setVariants] = useState<DDAVariant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVariants = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const { data, error: apiError } = await apiService.request<DDAVariant[]>('/api/dda/variants');
      
      if (apiError) {
        setError(apiError);
        return;
      }
      
      if (data) {
        setVariants(data);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch DDA variants');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVariants();
  }, []);

  return {
    variants,
    isLoading,
    error,
    refetch: fetchVariants,
  };
}
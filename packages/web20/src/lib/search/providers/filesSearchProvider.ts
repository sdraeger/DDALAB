import { SearchProvider, SearchableItem } from '@/types/search';
import apiService from '@/lib/api';
import { FileText, Folder } from 'lucide-react';
import React from 'react';

export const filesSearchProvider: SearchProvider = {
  id: 'files',
  name: 'Files',
  category: 'files',
  priority: 10,
  search: async (query: string): Promise<SearchableItem[]> => {
    try {
      const response = await apiService.request<{
        files: Array<{
          name: string;
          path: string;
          is_directory: boolean;
        }>;
      }>(`/api/files/search?q=${encodeURIComponent(query)}`);

      if (!response.data?.files) return [];

      return response.data.files.map((file, index) => ({
        id: `file-${index}`,
        title: file.name,
        description: file.path,
        category: 'files',
        path: file.path,
        icon: file.is_directory 
          ? React.createElement(Folder, { className: 'h-4 w-4' })
          : React.createElement(FileText, { className: 'h-4 w-4' }),
        onSelect: () => {
          // Handle file selection (could open file viewer, navigate, etc.)
          console.log('Selected file:', file.path);
        },
        metadata: {
          isDirectory: file.is_directory,
          fullPath: file.path,
        },
      }));
    } catch (error) {
      console.error('Files search failed:', error);
      return [];
    }
  },
};
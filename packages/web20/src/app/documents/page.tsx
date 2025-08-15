'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { Footer } from '@/components/layout/Footer';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { useHeaderVisible, useFooterVisible } from '@/store/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  FolderOpen,
  Upload,
  Search,
  Download,
  Eye,
  Edit,
  Trash2,
  MoreHorizontal,
  Calendar,
  HardDrive,
  Archive,
  RefreshCw,
  Filter
} from 'lucide-react';
import { cn } from '@/lib/utils';
import apiService from '@/lib/api';

interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  size?: number;
  last_modified?: string;
  is_favorite?: boolean;
}

function DocumentsContent() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [currentPath, setCurrentPath] = useState('');
  const [sortBy, setSortBy] = useState<string>('name');

  const loadDocuments = async (path: string = '') => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Get allowed roots if no path is provided
      if (!path) {
        const rootsResponse = await apiService.request<{roots: Array<{name: string; relative_path: string}>; default_relative_path: string}>('/api/files/roots');
        if (rootsResponse.error) {
          setError(rootsResponse.error);
          return;
        }
        path = rootsResponse.data?.default_relative_path || '';
        setCurrentPath(path);
      }
      
      // List files in the path
      const filesResponse = await apiService.request<{files: FileItem[]}>(`/api/files/list?path=${encodeURIComponent(path)}`);
      
      if (filesResponse.error) {
        setError(filesResponse.error);
        return;
      }
      
      setFiles(filesResponse.data?.files || []);
    } catch (err) {
      setError('Failed to load documents');
      console.error('Failed to load documents:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const filteredFiles = files.filter(file => {
    const matchesSearch = file.name.toLowerCase().includes(searchTerm.toLowerCase());
    
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    const matchesType = filterType === 'all' || 
      (filterType === 'edf' && fileExtension === 'edf') ||
      (filterType === 'pdf' && fileExtension === 'pdf') ||
      (filterType === 'doc' && ['doc', 'docx'].includes(fileExtension)) ||
      (filterType === 'xlsx' && ['xls', 'xlsx'].includes(fileExtension)) ||
      (filterType === 'txt' && fileExtension === 'txt') ||
      (filterType === 'directory' && file.is_directory);
    
    return matchesSearch && matchesType;
  });

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    // Directories first
    if (a.is_directory && !b.is_directory) return -1;
    if (!a.is_directory && b.is_directory) return 1;
    
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'size':
        return (b.size || 0) - (a.size || 0);
      case 'lastModified':
        const aTime = a.last_modified ? new Date(a.last_modified).getTime() : 0;
        const bTime = b.last_modified ? new Date(b.last_modified).getTime() : 0;
        return bTime - aTime;
      default:
        return 0;
    }
  });

  const getFileIcon = (file: FileItem) => {
    if (file.is_directory) return '📁';
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    switch (extension) {
      case 'edf': return '📊';
      case 'pdf': return '📄';
      case 'doc':
      case 'docx': return '📝';
      case 'xls':
      case 'xlsx': return '📈';
      case 'txt': return '📃';
      default: return '📄';
    }
  };

  const getTypeColor = (file: FileItem) => {
    if (file.is_directory) return 'bg-blue-100 text-blue-800';
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    switch (extension) {
      case 'edf': return 'bg-purple-100 text-purple-800';
      case 'pdf': return 'bg-red-100 text-red-800';
      case 'doc':
      case 'docx': return 'bg-green-100 text-green-800';
      case 'xls':
      case 'xlsx': return 'bg-emerald-100 text-emerald-800';
      case 'txt': return 'bg-gray-100 text-gray-800';
      default: return 'bg-orange-100 text-orange-800';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    
    try {
      // Handle Unix timestamps (numeric strings)
      const timestamp = parseFloat(dateString);
      if (!isNaN(timestamp) && timestamp > 1000000000) {
        // If it looks like a Unix timestamp, convert it
        const date = new Date(timestamp * 1000);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      }
      
      // Try parsing as regular date string
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }
      
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.warn('Failed to parse date:', dateString, error);
      return 'Invalid Date';
    }
  };

  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const totalFiles = files.filter(f => !f.is_directory).length;
  const totalDirectories = files.filter(f => f.is_directory).length;
  const edfFiles = files.filter(f => !f.is_directory && f.name.toLowerCase().endsWith('.edf')).length;

  const handleRefresh = () => {
    loadDocuments(currentPath);
  };

  const handleDirectoryClick = (file: FileItem) => {
    if (file.is_directory) {
      setCurrentPath(file.path);
      loadDocuments(file.path);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Loading documents...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={handleRefresh} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            Browse and manage research documents and data files
          </p>
          {currentPath && (
            <p className="text-sm text-muted-foreground mt-1">
              Current path: {currentPath}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button>
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Files</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalFiles}</div>
            <p className="text-xs text-muted-foreground">
              Files in directory
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Directories</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDirectories}</div>
            <p className="text-xs text-muted-foreground">
              Subdirectories
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">EDF Files</CardTitle>
            <Archive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{edfFiles}</div>
            <p className="text-xs text-muted-foreground">
              Data files
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatFileSize(totalSize)}</div>
            <p className="text-xs text-muted-foreground">
              Total file size
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search documents by name, tags, or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 border border-input rounded-md text-sm"
              >
                <option value="all">All Types</option>
                <option value="directory">Directories</option>
                <option value="edf">EDF Files</option>
                <option value="pdf">PDF Documents</option>
                <option value="doc">Word Documents</option>
                <option value="xlsx">Excel Files</option>
                <option value="txt">Text Files</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-input rounded-md text-sm"
              >
                <option value="name">Sort by Name</option>
                <option value="size">Sort by Size</option>
                <option value="lastModified">Sort by Date Modified</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents Table */}
      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            File Browser ({sortedFiles.length} items)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Name</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-left py-3 px-4 font-medium">Size</th>
                  <th className="text-left py-3 px-4 font-medium">Last Modified</th>
                  <th className="text-right py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiles.map((file, index) => (
                  <tr key={`${file.path}-${index}`} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{getFileIcon(file)}</span>
                        <div className="flex flex-col min-w-0">
                          <button
                            onClick={() => handleDirectoryClick(file)}
                            className={cn(
                              "font-medium truncate text-left hover:underline",
                              file.is_directory ? "text-blue-600 cursor-pointer" : "cursor-default"
                            )}
                          >
                            {file.name}
                          </button>
                          {file.is_favorite && (
                            <span className="text-xs text-yellow-600">★ Favorite</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge className={cn("text-xs", getTypeColor(file))}>
                        {file.is_directory ? 'Directory' : (file.name.split('.').pop()?.toUpperCase() || 'File')}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {file.is_directory ? '—' : formatFileSize(file.size || 0)}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">
                      {formatDate(file.last_modified)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!file.is_directory && (
                          <>
                            <Button variant="ghost" size="sm" title="View">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" title="Download">
                              <Download className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" title="More">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {sortedFiles.length === 0 && (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No files found</h3>
              <p className="text-muted-foreground">
                {searchTerm ? 'Try adjusting your search criteria.' : 'This directory is empty or no files match the current filters.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DocumentsPage() {
  const headerVisible = useHeaderVisible();
  const footerVisible = useFooterVisible();

  return (
    <AuthProvider>
      <div className="min-h-screen w-full bg-background">
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex flex-col flex-1 min-w-0">
            {headerVisible && <Header />}
            <main className="flex-1 overflow-auto">
              <DocumentsContent />
            </main>
            {footerVisible && <Footer />}
          </div>
        </div>
      </div>
    </AuthProvider>
  );
}
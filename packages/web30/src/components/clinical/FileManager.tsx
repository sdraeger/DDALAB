"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Folder, 
  FileText, 
  Upload, 
  Search, 
  Filter, 
  Download, 
  Trash2, 
  Clock, 
  Users, 
  Activity,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  ChevronRight,
  Home
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiService, EDFFileInfo } from '@/services/apiService';
import { useFileManagerPersistence } from '@/hooks/useSessionPersistence';
import { cn } from '@/lib/utils';

interface FileManagerProps {
  selectedFile: EDFFileInfo | null;
  onFileSelect: (file: EDFFileInfo) => void;
  className?: string;
}

interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  size?: number;
  last_modified?: string;
}

type SortField = 'name' | 'size' | 'date';
type FilterType = 'all' | 'edf' | 'ascii' | 'recent' | 'large';

export function FileManager({ selectedFile, onFileSelect, className }: FileManagerProps) {
  // Use persistent file manager state
  const { fileManager, toggleFolder, updateSort } = useFileManagerPersistence();
  
  const [files, setFiles] = useState<FileItem[]>([]);
  const [edfFiles, setEdfFiles] = useState<EDFFileInfo[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>(['data']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Use persisted sort settings
  const [sortField, setSortField] = useState<SortField>(fileManager.sortBy as SortField || 'name');
  const [sortAsc, setSortAsc] = useState(fileManager.sortOrder === 'asc');
  const [filterType, setFilterType] = useState<FilterType>('all');

  const loadDirectory = useCallback(async (path: string = '') => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiService.listDirectory(path);
      setFiles(response.files || []);
      
      // Update breadcrumbs
      if (path === '') {
        setBreadcrumbs(['data']);
      } else {
        const pathParts = path.split('/').filter(Boolean);
        setBreadcrumbs(['data', ...pathParts]);
      }
      
      // Get EDF files for the current directory
      const edfFilesInDir = response.files
        .filter(file => !file.is_directory && 
                       (file.name.toLowerCase().endsWith('.edf') || 
                        file.name.toLowerCase().endsWith('.ascii')))
        .map(file => ({
          file_path: file.path,
          file_name: file.name,
          file_size: file.size || 0,
          duration: 0,
          sample_rate: 256,
          channels: [],
          total_samples: 0,
          start_time: file.last_modified || new Date().toISOString(),
          end_time: file.last_modified || new Date().toISOString(),
          annotations_count: 0
        }));
      setEdfFiles(edfFilesInDir);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const handleDirectoryClick = useCallback((dirPath: string) => {
    setCurrentPath(dirPath);
  }, []);

  const handleBreadcrumbClick = useCallback((index: number) => {
    if (index === 0) {
      setCurrentPath('');
    } else {
      const pathParts = breadcrumbs.slice(1, index);
      setCurrentPath(pathParts.join('/'));
    }
  }, [breadcrumbs]);

  const filteredAndSortedFiles = React.useMemo(() => {
    let filtered = [...files];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(file =>
        file.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        file.path.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply type filter
    switch (filterType) {
      case 'edf':
        filtered = filtered.filter(file => !file.is_directory && file.name.toLowerCase().endsWith('.edf'));
        break;
      case 'ascii':
        filtered = filtered.filter(file => !file.is_directory && (file.name.toLowerCase().endsWith('.ascii') || file.name.toLowerCase().endsWith('.txt')));
        break;
      case 'recent':
        filtered = filtered.filter(file => {
          if (!file.last_modified) return false;
          const fileDate = new Date(file.last_modified);
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          return fileDate > dayAgo;
        });
        break;
      case 'large':
        filtered = filtered.filter(file => !file.is_directory && (file.size || 0) > 10 * 1024 * 1024); // > 10MB
        break;
    }

    // Sort directories first
    filtered.sort((a, b) => {
      if (a.is_directory && !b.is_directory) return -1;
      if (!a.is_directory && b.is_directory) return 1;
      
      // Sort within the same type
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = (a.size || 0) - (b.size || 0);
          break;
        case 'date':
          const aDate = a.last_modified ? new Date(a.last_modified).getTime() : 0;
          const bDate = b.last_modified ? new Date(b.last_modified).getTime() : 0;
          comparison = aDate - bDate;
          break;
        default:
          comparison = a.name.localeCompare(b.name);
      }
      return sortAsc ? comparison : -comparison;
    });

    return filtered;
  }, [files, searchTerm, filterType, sortField, sortAsc]);

  const handleFileClick = useCallback(async (file: FileItem) => {
    if (file.is_directory) {
      const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      setCurrentPath(newPath);
    } else if (file.name.toLowerCase().endsWith('.edf') || file.name.toLowerCase().endsWith('.ascii')) {
      try {
        setLoading(true);
        // Get actual file metadata from the API
        const edfFileInfo = await apiService.getFileInfo(file.path);
        onFileSelect(edfFileInfo);
      } catch (error) {
        console.error('Failed to load file info:', error);
        setError(`Failed to load file info: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Fallback to basic file info
        const edfFile: EDFFileInfo = {
          file_path: file.path,
          file_name: file.name,
          file_size: file.size || 0,
          duration: 0,
          sample_rate: 256,
          channels: [],
          total_samples: 0,
          start_time: file.last_modified || new Date().toISOString(),
          end_time: file.last_modified || new Date().toISOString(),
          annotations_count: 0
        };
        onFileSelect(edfFile);
      } finally {
        setLoading(false);
      }
    }
  }, [currentPath, onFileSelect]);

  const formatFileSize = useCallback((bytes?: number) => {
    if (!bytes) return '-';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }, []);

  const formatDate = useCallback((dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }, []);

  const getFileTypeIcon = useCallback((file: FileItem) => {
    if (file.is_directory) {
      return <Folder className="h-4 w-4 text-blue-500" />;
    }
    
    const extension = file.name.toLowerCase().split('.').pop();
    switch (extension) {
      case 'edf':
        return <Activity className="h-4 w-4 text-blue-500" />;
      case 'ascii':
      case 'txt':
        return <FileText className="h-4 w-4 text-green-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  }, []);

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b space-y-3 bg-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            <h3 className="text-lg font-semibold">File Manager</h3>
            <Badge variant="outline">{filteredAndSortedFiles.length}</Badge>
          </div>
          
          <Button 
            size="sm" 
            onClick={() => loadDirectory(currentPath)}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
        
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Home className="h-4 w-4" />
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={index}>
              <button
                onClick={() => handleBreadcrumbClick(index)}
                className="hover:text-foreground transition-colors"
              >
                {crumb}
              </button>
              {index < breadcrumbs.length - 1 && <ChevronRight className="h-3 w-3" />}
            </React.Fragment>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files and directories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-8"
            />
          </div>
          
          <div className="flex gap-2">
            <Select value={filterType} onValueChange={(value: FilterType) => setFilterType(value)}>
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Items</SelectItem>
                <SelectItem value="edf">EDF Files</SelectItem>
                <SelectItem value="ascii">ASCII Files</SelectItem>
                <SelectItem value="recent">Recent</SelectItem>
                <SelectItem value="large">Large Files</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortField} onValueChange={(value: SortField) => {
              setSortField(value);
              updateSort(value, sortAsc ? 'asc' : 'desc');
            }}>
              <SelectTrigger className="w-24 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="size">Size</SelectItem>
                <SelectItem value="date">Date</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const newOrder = !sortAsc;
                setSortAsc(newOrder);
                updateSort(sortField, newOrder ? 'asc' : 'desc');
              }}
              className="h-8 px-3"
            >
              {sortAsc ? '↑' : '↓'}
            </Button>
          </div>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <div className="p-2 space-y-2">
            {filteredAndSortedFiles.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>Loading directory...</span>
                  </div>
                ) : (
                  <>
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No files found</p>
                    <p className="text-sm">This directory is empty</p>
                  </>
                )}
              </div>
            ) : (
              filteredAndSortedFiles.map((file) => (
                <Card 
                  key={file.path}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50 transition-colors",
                    !file.is_directory && selectedFile?.file_path === file.path && "ring-2 ring-primary bg-primary/5"
                  )}
                  onClick={() => handleFileClick(file)}
                >
                  <CardContent className="p-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {getFileTypeIcon(file)}
                          <span className="font-medium truncate text-sm">{file.name}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!file.is_directory && (
                            <Badge variant="outline" className="text-xs">
                              {file.name.split('.').pop()?.toUpperCase()}
                            </Badge>
                          )}
                          {file.is_directory && (
                            <Badge variant="secondary" className="text-xs">
                              Folder
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{formatFileSize(file.size)}</span>
                        <span>{formatDate(file.last_modified)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
        </div>
      </div>

      {/* Footer with Status */}
      <div className="flex-shrink-0 p-2 border-t space-y-1 bg-background">
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded p-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span className="text-xs font-medium">Error</span>
            </div>
            <p className="text-xs text-destructive/80 mt-1">{error}</p>
          </div>
        )}
        
        {/* EDF Files Summary - More compact */}
        {edfFiles.length > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded p-2">
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle className="h-3 w-3" />
              <span className="text-xs font-medium">
                {edfFiles.length} EDF/ASCII file{edfFiles.length !== 1 ? 's' : ''} available
              </span>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground flex items-center justify-between">
          <span>
            {filteredAndSortedFiles.length} item{filteredAndSortedFiles.length !== 1 ? 's' : ''} • 
            {files.filter(f => !f.is_directory && f.name.endsWith('.edf')).length} EDF • 
            {files.filter(f => !f.is_directory && f.name.endsWith('.ascii')).length} ASCII
          </span>
          <span>
            {Math.round(files.reduce((acc, file) => acc + (file.size || 0), 0) / (1024 * 1024))} MB
          </span>
        </div>
      </div>
    </div>
  );
}
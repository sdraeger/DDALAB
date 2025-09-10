"use client";

import React, { useState, useCallback } from 'react';
import { 
  Plus, 
  Edit3, 
  Trash2, 
  Search, 
  Filter, 
  Clock, 
  User, 
  AlertTriangle,
  Activity,
  Bookmark,
  Zap,
  FileText,
  Eye,
  EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Annotation } from '@/services/apiService';
import { cn } from '@/lib/utils';

interface AnnotationPanelProps {
  annotations: Annotation[];
  onAnnotationCreate: (annotation: Omit<Annotation, 'id' | 'created_at'>) => void;
  onAnnotationUpdate: (id: string, annotation: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string, filePath: string) => void;
  onAnnotationSelect: (annotation: Annotation) => void;
  filePath: string;
  availableChannels: string[];
  currentTime: number;
  selectedAnnotation?: Annotation;
  className?: string;
}

interface AnnotationFormData {
  start_time: number;
  end_time?: number;
  channel?: string;
  label: string;
  description: string;
  annotation_type: Annotation['annotation_type'];
}

const ANNOTATION_TYPES = [
  { value: 'seizure', label: 'Seizure', icon: AlertTriangle, color: 'text-red-500' },
  { value: 'artifact', label: 'Artifact', icon: Zap, color: 'text-orange-500' },
  { value: 'marker', label: 'Marker', icon: Bookmark, color: 'text-green-500' },
  { value: 'clinical', label: 'Clinical Event', icon: Activity, color: 'text-blue-500' },
  { value: 'custom', label: 'Custom', icon: FileText, color: 'text-purple-500' }
] as const;

const QUICK_TEMPLATES = [
  { label: 'Seizure Event', type: 'seizure' as const, duration: 30 },
  { label: 'Muscle Artifact', type: 'artifact' as const, duration: 5 },
  { label: 'Eye Blink', type: 'artifact' as const, duration: 0.5 },
  { label: 'Clinical Note', type: 'clinical' as const, duration: 0 },
];

export function AnnotationPanel({
  annotations,
  onAnnotationCreate,
  onAnnotationUpdate,
  onAnnotationDelete,
  onAnnotationSelect,
  filePath,
  availableChannels,
  currentTime,
  selectedAnnotation,
  className
}: AnnotationPanelProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null);
  const [formData, setFormData] = useState<AnnotationFormData>({
    start_time: 0,
    label: '',
    description: '',
    annotation_type: 'marker'
  });

  const filteredAnnotations = React.useMemo(() => {
    return annotations
      .filter(ann => {
        if (filterType !== 'all' && ann.annotation_type !== filterType) return false;
        if (searchTerm && !ann.label.toLowerCase().includes(searchTerm.toLowerCase()) &&
            !ann.description?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => a.start_time - b.start_time);
  }, [annotations, searchTerm, filterType]);

  const handleCreateAnnotation = useCallback(() => {
    setFormData({
      start_time: currentTime,
      label: '',
      description: '',
      annotation_type: 'marker'
    });
    setShowCreateDialog(true);
  }, [currentTime]);

  const handleQuickCreate = useCallback((template: typeof QUICK_TEMPLATES[0]) => {
    const newAnnotation: Omit<Annotation, 'id' | 'created_at'> = {
      file_path: filePath,
      start_time: currentTime,
      end_time: template.duration > 0 ? currentTime + template.duration : undefined,
      label: template.label,
      description: '',
      annotation_type: template.type
    };
    onAnnotationCreate(newAnnotation);
  }, [currentTime, filePath, onAnnotationCreate]);

  const handleSubmitCreate = useCallback(() => {
    if (!formData.label.trim()) return;

    const newAnnotation: Omit<Annotation, 'id' | 'created_at'> = {
      file_path: filePath,
      start_time: formData.start_time,
      end_time: formData.end_time,
      channel: formData.channel || undefined,
      label: formData.label.trim(),
      description: formData.description.trim() || undefined,
      annotation_type: formData.annotation_type
    };

    onAnnotationCreate(newAnnotation);
    setShowCreateDialog(false);
    setFormData({
      start_time: 0,
      label: '',
      description: '',
      annotation_type: 'marker'
    });
  }, [formData, filePath, onAnnotationCreate]);

  const handleEditAnnotation = useCallback((annotation: Annotation) => {
    setEditingAnnotation(annotation);
    setFormData({
      start_time: annotation.start_time,
      end_time: annotation.end_time,
      channel: annotation.channel,
      label: annotation.label,
      description: annotation.description || '',
      annotation_type: annotation.annotation_type
    });
    setShowEditDialog(true);
  }, []);

  const handleSubmitEdit = useCallback(() => {
    if (!editingAnnotation || !formData.label.trim()) return;

    const updates: Partial<Annotation> = {
      start_time: formData.start_time,
      end_time: formData.end_time,
      channel: formData.channel || undefined,
      label: formData.label.trim(),
      description: formData.description.trim() || undefined,
      annotation_type: formData.annotation_type
    };

    onAnnotationUpdate(editingAnnotation.id!, updates);
    setShowEditDialog(false);
    setEditingAnnotation(null);
  }, [editingAnnotation, formData, onAnnotationUpdate]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }, []);

  const getDuration = useCallback((annotation: Annotation) => {
    if (!annotation.end_time) return '0ms';
    const duration = annotation.end_time - annotation.start_time;
    if (duration < 1) return `${Math.round(duration * 1000)}ms`;
    return `${duration.toFixed(1)}s`;
  }, []);

  const getAnnotationIcon = useCallback((type: string) => {
    const annotationType = ANNOTATION_TYPES.find(t => t.value === type);
    if (!annotationType) return FileText;
    return annotationType.icon;
  }, []);

  const getAnnotationColor = useCallback((type: string) => {
    const annotationType = ANNOTATION_TYPES.find(t => t.value === type);
    return annotationType?.color || 'text-gray-500';
  }, []);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Annotations</h3>
            <Badge variant="outline">{annotations.length}</Badge>
          </div>
          
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={handleCreateAnnotation}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Annotation</DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="start-time">Start Time (s)</Label>
                    <Input
                      id="start-time"
                      type="number"
                      step="0.001"
                      value={formData.start_time}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        start_time: parseFloat(e.target.value) || 0
                      }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="end-time">End Time (s)</Label>
                    <Input
                      id="end-time"
                      type="number"
                      step="0.001"
                      value={formData.end_time || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        end_time: e.target.value ? parseFloat(e.target.value) : undefined
                      }))}
                      placeholder="Optional"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="annotation-type">Type</Label>
                  <Select 
                    value={formData.annotation_type} 
                    onValueChange={(value: any) => setFormData(prev => ({
                      ...prev, 
                      annotation_type: value
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ANNOTATION_TYPES.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className={cn("h-4 w-4", type.color)} />
                            {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="channel">Channel (Optional)</Label>
                  <Select 
                    value={formData.channel || ''} 
                    onValueChange={(value) => setFormData(prev => ({
                      ...prev, 
                      channel: value || undefined
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All channels" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All channels</SelectItem>
                      {availableChannels.map(channel => (
                        <SelectItem key={channel} value={channel}>
                          {channel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="label">Label</Label>
                  <Input
                    id="label"
                    value={formData.label}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      label: e.target.value
                    }))}
                    placeholder="Annotation label"
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      description: e.target.value
                    }))}
                    placeholder="Optional description"
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSubmitCreate} disabled={!formData.label.trim()}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          {QUICK_TEMPLATES.map((template, index) => {
            const Icon = getAnnotationIcon(template.type);
            return (
              <Button
                key={index}
                variant="outline"
                size="sm"
                onClick={() => handleQuickCreate(template)}
                className="text-xs"
              >
                <Icon className={cn("h-3 w-3 mr-1", getAnnotationColor(template.type))} />
                {template.label}
              </Button>
            );
          })}
        </div>

        {/* Search and Filter */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search annotations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {ANNOTATION_TYPES.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  <div className="flex items-center gap-2">
                    <type.icon className={cn("h-4 w-4", type.color)} />
                    {type.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Annotations List */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-2 space-y-2">
            {filteredAnnotations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bookmark className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No annotations found</p>
                <p className="text-sm">Create annotations to mark important events</p>
              </div>
            ) : (
              filteredAnnotations.map((annotation) => {
                const Icon = getAnnotationIcon(annotation.annotation_type);
                const isSelected = selectedAnnotation?.id === annotation.id;
                
                return (
                  <Card 
                    key={annotation.id}
                    className={cn(
                      "cursor-pointer hover:bg-muted/50 transition-colors",
                      isSelected && "ring-2 ring-primary bg-primary/5"
                    )}
                    onClick={() => onAnnotationSelect(annotation)}
                  >
                    <CardContent className="p-3">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <Icon className={cn("h-4 w-4", getAnnotationColor(annotation.annotation_type))} />
                            <Badge variant="outline" className="text-xs">
                              {annotation.annotation_type}
                            </Badge>
                            {annotation.channel && (
                              <Badge variant="secondary" className="text-xs">
                                {annotation.channel}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditAnnotation(annotation);
                              }}
                            >
                              <Edit3 className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAnnotationDelete(annotation.id!, filePath);
                              }}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        
                        <div>
                          <p className="font-medium text-sm">{annotation.label}</p>
                          {annotation.description && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {annotation.description}
                            </p>
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(annotation.start_time)}
                            {annotation.end_time && ` → ${formatTime(annotation.end_time)}`}
                          </div>
                          <div className="flex items-center gap-2">
                            <span>{getDuration(annotation)}</span>
                            {annotation.created_at && (
                              <span>{new Date(annotation.created_at).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Annotation</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-start-time">Start Time (s)</Label>
                <Input
                  id="edit-start-time"
                  type="number"
                  step="0.001"
                  value={formData.start_time}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    start_time: parseFloat(e.target.value) || 0
                  }))}
                />
              </div>
              <div>
                <Label htmlFor="edit-end-time">End Time (s)</Label>
                <Input
                  id="edit-end-time"
                  type="number"
                  step="0.001"
                  value={formData.end_time || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    end_time: e.target.value ? parseFloat(e.target.value) : undefined
                  }))}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit-annotation-type">Type</Label>
              <Select 
                value={formData.annotation_type} 
                onValueChange={(value: any) => setFormData(prev => ({
                  ...prev, 
                  annotation_type: value
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANNOTATION_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        <type.icon className={cn("h-4 w-4", type.color)} />
                        {type.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="edit-label">Label</Label>
              <Input
                id="edit-label"
                value={formData.label}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  label: e.target.value
                }))}
                placeholder="Annotation label"
              />
            </div>

            <div>
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  description: e.target.value
                }))}
                placeholder="Optional description"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitEdit} disabled={!formData.label.trim()}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
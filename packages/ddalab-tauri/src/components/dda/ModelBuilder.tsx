/**
 * Interactive Model Builder Component
 *
 * Visual interface for building DDA MODEL encodings by selecting polynomial terms
 * with LaTeX rendering and persistent presets
 */

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Latex } from '../ui/latex';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Sparkles,
  X,
  Check,
  Trash2,
  Wand2,
  Info,
  Plus,
  Save,
  Database,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { useModelPresets, ModelPreset } from '@/hooks/useModelPresets';

interface ModelBuilderProps {
  numDelays: number;
  polynomialOrder: number;
  selectedTerms: number[];
  onTermsChange: (terms: number[]) => void;
  tauValues?: number[];
  className?: string;
}

interface Monomial {
  index: number;
  encoding: number[];
  termText: string;
  termLatex: string;
  degree: number;
  isLinear: boolean;
  isPure: boolean;
  isCross: boolean;
}

function generateMonomials(numDelays: number, polynomialOrder: number): number[][] {
  const monomials: number[][] = [];

  for (let j = 1; j <= numDelays; j++) {
    monomials.push([0, j]);
  }

  for (let degree = 2; degree <= polynomialOrder; degree++) {
    const combos = combinationsWithReplacement(
      Array.from({ length: numDelays }, (_, i) => i + 1),
      degree
    );
    monomials.push(...combos);
  }

  return monomials;
}

function combinationsWithReplacement<T>(elements: T[], r: number): T[][] {
  const result: T[][] = [];

  function generate(startIdx: number, current: T[], remaining: number) {
    if (remaining === 0) {
      result.push([...current]);
      return;
    }
    for (let i = startIdx; i < elements.length; i++) {
      generate(i, [...current, elements[i]], remaining - 1);
    }
  }

  generate(0, [], r);
  return result;
}

function monomialToLatex(monomial: number[], tauValues?: number[]): string {
  if (monomial.length === 2 && monomial[0] === 0) {
    const delayIdx = monomial[1];
    if (tauValues && delayIdx <= tauValues.length) {
      const tau = tauValues[delayIdx - 1];
      return `x(t - ${tau})`;
    }
    return `x_{${delayIdx}}`;
  }

  const counts: Record<number, number> = {};
  for (const idx of monomial) {
    counts[idx] = (counts[idx] || 0) + 1;
  }

  const terms: string[] = [];
  for (const idx of Object.keys(counts).map(Number).sort()) {
    if (tauValues && idx <= tauValues.length) {
      const tau = tauValues[idx - 1];
      if (counts[idx] === 1) {
        terms.push(`x(t - ${tau})`);
      } else {
        terms.push(`x(t - ${tau})^{${counts[idx]}}`);
      }
    } else {
      if (counts[idx] === 1) {
        terms.push(`x_{${idx}}`);
      } else {
        terms.push(`x_{${idx}}^{${counts[idx]}}`);
      }
    }
  }

  return terms.join(' \\, ');
}

function analyzeMonomialType(monomial: number[]): {
  degree: number;
  isLinear: boolean;
  isPure: boolean;
  isCross: boolean;
} {
  const degree = monomial.length === 2 && monomial[0] === 0 ? 1 : monomial.length;
  const isLinear = degree === 1;

  if (isLinear) {
    return { degree, isLinear, isPure: false, isCross: false };
  }

  const uniqueIndices = new Set(monomial);
  const isPure = uniqueIndices.size === 1;
  const isCross = !isPure;

  return { degree, isLinear, isPure, isCross };
}

export const ModelBuilder: React.FC<ModelBuilderProps> = ({
  numDelays,
  polynomialOrder,
  selectedTerms,
  onTermsChange,
  tauValues,
  className,
}) => {
  const [showInfo, setShowInfo] = useState(false);
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDescription, setNewPresetDescription] = useState('');
  const [newPresetIcon, setNewPresetIcon] = useState('⭐');

  const {
    structuralPresets,
    dataPresets,
    customPresets,
    addPreset,
    removePreset,
  } = useModelPresets();

  const { monomials, groupedByDegree } = useMemo(() => {
    const rawMonomials = generateMonomials(numDelays, polynomialOrder);

    const enrichedMonomials: Monomial[] = rawMonomials.map((mon, idx) => {
      const analysis = analyzeMonomialType(mon);
      return {
        index: idx + 1,
        encoding: mon,
        termText: monomialToLatex(mon, tauValues), // Using LaTeX now
        termLatex: monomialToLatex(mon, tauValues),
        ...analysis,
      };
    });

    const grouped: Record<number, Monomial[]> = {};
    for (const mon of enrichedMonomials) {
      if (!grouped[mon.degree]) {
        grouped[mon.degree] = [];
      }
      grouped[mon.degree].push(mon);
    }

    return {
      monomials: enrichedMonomials,
      groupedByDegree: grouped,
    };
  }, [numDelays, polynomialOrder, tauValues]);

  const selectedSet = useMemo(() => new Set(selectedTerms), [selectedTerms]);

  const equationLatex = useMemo(() => {
    if (selectedTerms.length === 0) return null;

    const terms = selectedTerms.map((idx, i) => {
      const mon = monomials.find(m => m.index === idx);
      if (!mon) return '';
      return `a_{${i + 1}} \\, ${mon.termLatex}`;
    });

    return `\\dot{x} = ${terms.join(' + ')}`;
  }, [selectedTerms, monomials]);

  const toggleTerm = (index: number) => {
    const newTerms = selectedSet.has(index)
      ? selectedTerms.filter(t => t !== index)
      : [...selectedTerms, index].sort((a, b) => a - b);
    onTermsChange(newTerms);
  };

  const applyStructuralPreset = (presetId: string) => {
    // Structural presets compute indices based on monomial properties
    let indices: number[] = [];

    switch (presetId) {
      case 'linear-only':
        indices = monomials.filter(m => m.isLinear).map(m => m.index);
        break;
      case 'quadratic-diagonal':
        indices = monomials.filter(m => m.isLinear || (m.degree === 2 && m.isPure)).map(m => m.index);
        break;
      case 'full-quadratic':
        indices = monomials.filter(m => m.degree <= 2).map(m => m.index);
        break;
      case 'symmetric':
        indices = monomials.filter(m => m.isLinear || m.isPure).map(m => m.index);
        break;
      default:
        // Custom structural preset
        const preset = customPresets.find(p => p.id === presetId);
        if (preset && preset.type === 'structural') {
          indices = preset.encoding;
        }
    }

    onTermsChange(indices);
  };

  const applyDataPreset = (preset: ModelPreset) => {
    // Data-based presets use fixed encoding
    onTermsChange(preset.encoding);
  };

  const clearAll = () => onTermsChange([]);

  const selectAllDegree = (degree: number) => {
    const degreeIndices = groupedByDegree[degree]?.map(m => m.index) || [];
    const newSet = new Set([...selectedTerms, ...degreeIndices]);
    onTermsChange(Array.from(newSet).sort((a, b) => a - b));
  };

  const deselectAllDegree = (degree: number) => {
    const degreeIndices = new Set(groupedByDegree[degree]?.map(m => m.index) || []);
    onTermsChange(selectedTerms.filter(t => !degreeIndices.has(t)));
  };

  const handleSaveAsPreset = () => {
    if (!newPresetName.trim()) return;

    addPreset({
      name: newPresetName,
      description: newPresetDescription || `Custom model with ${selectedTerms.length} terms`,
      icon: newPresetIcon,
      encoding: [...selectedTerms],
      type: 'data-based',
    });

    setNewPresetName('');
    setNewPresetDescription('');
    setNewPresetIcon('⭐');
    setShowAddPreset(false);
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Model Builder
            </CardTitle>
            <CardDescription>
              {numDelays} delays, order {polynomialOrder} · {monomials.length} terms available
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowInfo(!showInfo)}
            >
              <Info className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Info Panel */}
        <AnimatePresence>
          {showInfo && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-4 bg-primary/5 rounded-lg text-sm space-y-2">
                <p className="font-medium">How to build your model:</p>
                <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                  <li>Click terms to add/remove them from your model</li>
                  <li>Use structural presets for common patterns (linear, quadratic, etc.)</li>
                  <li>Use data-based presets for specific data types (EEG, etc.)</li>
                  <li>Equations are shown in LaTeX notation</li>
                  <li>Save your current selection as a custom preset</li>
                </ul>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Data-Based Presets */}
        {dataPresets.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">Data-Based Presets</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {dataPresets.map((preset) => (
                <TooltipProvider key={preset.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => applyDataPreset(preset)}
                        className="justify-start h-auto py-2 relative group"
                      >
                        <span className="mr-2">{preset.icon}</span>
                        <div className="text-left flex-1">
                          <div className="text-xs font-medium">{preset.name}</div>
                          {preset.dataType && (
                            <div className="text-xs text-muted-foreground">
                              {preset.dataType}
                            </div>
                          )}
                        </div>
                        {preset.isCustom && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute right-1 top-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              removePreset(preset.id);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        <p>{preset.description}</p>
                        <p className="text-muted-foreground mt-1">
                          Encoding: [{preset.encoding.join(', ')}]
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* Structural Presets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Structural Presets</span>
            <div className="flex gap-1">
              <Dialog open={showAddPreset} onOpenChange={setShowAddPreset}>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={selectedTerms.length === 0}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save as Preset</DialogTitle>
                    <DialogDescription>
                      Save your current model selection as a reusable preset
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="preset-name">Name</Label>
                      <Input
                        id="preset-name"
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        placeholder="My Custom Model"
                      />
                    </div>
                    <div>
                      <Label htmlFor="preset-description">Description</Label>
                      <Input
                        id="preset-description"
                        value={newPresetDescription}
                        onChange={(e) => setNewPresetDescription(e.target.value)}
                        placeholder="Describe when to use this model..."
                      />
                    </div>
                    <div>
                      <Label htmlFor="preset-icon">Icon (emoji)</Label>
                      <Input
                        id="preset-icon"
                        value={newPresetIcon}
                        onChange={(e) => setNewPresetIcon(e.target.value)}
                        placeholder="⭐"
                        maxLength={2}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      This will save encoding: [{selectedTerms.join(', ')}]
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowAddPreset(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveAsPreset} disabled={!newPresetName.trim()}>
                      <Plus className="h-4 w-4 mr-1" />
                      Save Preset
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={selectedTerms.length === 0}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {structuralPresets.map((preset) => (
              <TooltipProvider key={preset.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => applyStructuralPreset(preset.id)}
                      className="justify-start h-auto py-2 relative group"
                    >
                      <span className="mr-2">{preset.icon}</span>
                      <span className="text-xs flex-1 text-left">{preset.name}</span>
                      {preset.isCustom && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-1 top-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            removePreset(preset.id);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{preset.description}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>

        <Separator />

        {/* Terms by Degree */}
        <div className="space-y-4">
          {Object.entries(groupedByDegree)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([degree, terms]) => {
              const degreeNum = parseInt(degree);
              const allSelected = terms.every(t => selectedSet.has(t.index));
              const someSelected = terms.some(t => selectedSet.has(t.index));

              return (
                <div key={degree} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        Degree {degree}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {terms.length} terms
                      </Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => selectAllDegree(degreeNum)}
                        disabled={allSelected}
                        className="h-7 text-xs"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deselectAllDegree(degreeNum)}
                        disabled={!someSelected}
                        className="h-7 text-xs"
                      >
                        <X className="h-3 w-3 mr-1" />
                        None
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {terms.map((mon) => {
                      const isSelected = selectedSet.has(mon.index);

                      return (
                        <motion.button
                          key={mon.index}
                          onClick={() => toggleTerm(mon.index)}
                          className={`
                            relative p-3 rounded-lg border-2 transition-all
                            ${isSelected
                              ? 'border-primary bg-primary/10 shadow-md'
                              : 'border-border hover:border-primary/50 hover:bg-accent'
                            }
                          `}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          layout
                        >
                          <AnimatePresence>
                            {isSelected && (
                              <motion.div
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                className="absolute top-1 right-1"
                              >
                                <div className="bg-primary text-primary-foreground rounded-full p-0.5">
                                  <Check className="h-3 w-3" />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <div className="text-left space-y-1">
                            <div className="text-xs text-muted-foreground">
                              #{mon.index}
                            </div>
                            <div className="text-sm">
                              <Latex>{mon.termLatex}</Latex>
                            </div>
                            <div className="flex gap-1">
                              {mon.isPure && (
                                <Badge variant="outline" className="text-xs px-1 py-0">
                                  Pure
                                </Badge>
                              )}
                              {mon.isCross && (
                                <Badge variant="outline" className="text-xs px-1 py-0">
                                  Cross
                                </Badge>
                              )}
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Equation Preview */}
        <AnimatePresence>
          {equationLatex && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <Separator className="mb-4" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Your Model</span>
                  <Badge variant="default" className="ml-auto">
                    {selectedTerms.length} term{selectedTerms.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <motion.div
                  key={equationLatex}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg border border-primary/20"
                >
                  <div className="text-lg text-center">
                    <Latex block>{equationLatex}</Latex>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground text-center">
                    Encoding: [{selectedTerms.join(', ')}]
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty State */}
        {selectedTerms.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8 text-muted-foreground"
          >
            <Wand2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Click terms above to build your model</p>
            <p className="text-xs mt-1">Or use a preset to get started</p>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
};

export default ModelBuilder;

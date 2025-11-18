/**
 * Model Encoding Visualization Component
 *
 * Displays and visualizes DDA MODEL parameter encodings,
 * showing how they map to delay differential equation terms.
 */

import React, { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Badge } from "./ui/badge";

interface Monomial {
  index: number;
  encoding: number[];
  termText: string;
  termLatex: string;
  isSelected: boolean;
}

interface ModelEncodingVisualizationProps {
  numDelays: number;
  polynomialOrder: number;
  modelEncoding?: number[];
  tauValues?: number[];
  className?: string;
}

/**
 * Generate all monomials for given num_delays and polynomial_order
 */
function generateMonomials(
  numDelays: number,
  polynomialOrder: number,
): number[][] {
  const monomials: number[][] = [];

  // Degree 1: Linear terms [0, j] for j in 1..numDelays
  for (let j = 1; j <= numDelays; j++) {
    monomials.push([0, j]);
  }

  // Degrees 2 to polynomialOrder: All non-decreasing sequences
  for (let degree = 2; degree <= polynomialOrder; degree++) {
    const combos = combinationsWithReplacement(
      Array.from({ length: numDelays }, (_, i) => i + 1),
      degree,
    );
    monomials.push(...combos);
  }

  return monomials;
}

/**
 * Generate all combinations with replacement
 */
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

/**
 * Convert monomial encoding to plain text representation
 */
function monomialToText(monomial: number[], tauValues?: number[]): string {
  if (monomial.length === 2 && monomial[0] === 0) {
    // Linear term [0, j] → x_j
    const delayIdx = monomial[1];
    if (tauValues && delayIdx <= tauValues.length) {
      const tau = tauValues[delayIdx - 1];
      return `x(t - ${tau})`;
    }
    return `x_${delayIdx}`;
  }

  // Higher order terms: count occurrences
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
        terms.push(`x(t - ${tau})^${counts[idx]}`);
      }
    } else {
      if (counts[idx] === 1) {
        terms.push(`x_${idx}`);
      } else {
        terms.push(`x_${idx}^${counts[idx]}`);
      }
    }
  }

  return terms.join(" · ");
}

/**
 * Decode model encoding to equation string
 */
function decodeModelEncoding(
  modelEncoding: number[],
  monomials: number[][],
  tauValues?: number[],
): string {
  const terms: string[] = [];

  for (let i = 0; i < modelEncoding.length; i++) {
    const monomialIdx = modelEncoding[i] - 1; // Convert to 0-based
    if (monomialIdx < 0 || monomialIdx >= monomials.length) {
      continue;
    }

    const monomial = monomials[monomialIdx];
    const termStr = monomialToText(monomial, tauValues);
    terms.push(`a_${i + 1} ${termStr}`);
  }

  return `dx/dt = ${terms.join(" + ")}`;
}

export const ModelEncodingVisualization: React.FC<
  ModelEncodingVisualizationProps
> = ({
  numDelays,
  polynomialOrder,
  modelEncoding = [],
  tauValues,
  className,
}) => {
  const { monomials, totalMonomials, selectedSet } = useMemo(() => {
    const mons = generateMonomials(numDelays, polynomialOrder);
    const selected = new Set(modelEncoding);
    return {
      monomials: mons,
      totalMonomials: mons.length,
      selectedSet: selected,
    };
  }, [numDelays, polynomialOrder, modelEncoding]);

  const monomialData: Monomial[] = useMemo(() => {
    return monomials.map((mon, idx) => ({
      index: idx + 1,
      encoding: mon,
      termText: monomialToText(mon, tauValues),
      termLatex: monomialToText(mon, tauValues), // Could be LaTeX formatted
      isSelected: selectedSet.has(idx + 1),
    }));
  }, [monomials, tauValues, selectedSet]);

  const equation = useMemo(() => {
    if (modelEncoding.length === 0) {
      return null;
    }
    return decodeModelEncoding(modelEncoding, monomials, tauValues);
  }, [modelEncoding, monomials, tauValues]);

  const tauDisplay = tauValues
    ? tauValues.map((tau, i) => `τ_${i + 1}=${tau}`).join(", ")
    : null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Model Encoding Visualization</CardTitle>
        <CardDescription>
          Model space: {numDelays} delays, polynomial order {polynomialOrder}
          {tauDisplay && (
            <div className="text-xs mt-1">Delays: {tauDisplay}</div>
          )}
          <div className="text-xs mt-1">Total monomials: {totalMonomials}</div>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Model Space Table */}
          <div className="rounded-md border overflow-auto max-h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Index</TableHead>
                  <TableHead className="w-32">Encoding</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monomialData.map((mon) => (
                  <TableRow
                    key={mon.index}
                    className={mon.isSelected ? "bg-primary/5" : ""}
                  >
                    <TableCell className="font-mono text-sm">
                      {mon.index}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      [{mon.encoding.join(", ")}]
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {mon.termText}
                    </TableCell>
                    <TableCell>
                      {mon.isSelected && (
                        <Badge variant="default" className="text-xs">
                          Selected
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Equation Display */}
          {equation && (
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm font-medium mb-2">
                Resulting Equation:
              </div>
              <div className="font-mono text-base">{equation}</div>
              <div className="text-xs text-muted-foreground mt-2">
                Selected terms: [{modelEncoding.join(", ")}]
              </div>
            </div>
          )}

          {/* Help Text */}
          {modelEncoding.length === 0 && (
            <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg">
              <p className="font-medium mb-1">How Model Encoding Works:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Each row represents a possible polynomial term</li>
                <li>Linear terms (degree 1) are encoded as [0, j]</li>
                <li>Higher order terms use indices of delay variables</li>
                <li>
                  Example: [1, 3, 5] selects x₁, x₁², and x₂² for a 2-delay,
                  order-2 model
                </li>
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ModelEncodingVisualization;

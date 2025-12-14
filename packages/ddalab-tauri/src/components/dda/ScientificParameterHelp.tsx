"use client";

import React from "react";
import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export interface ParameterHelpContent {
  name: string;
  explanation: string;
  formula?: string;
  typicalValues?: string;
  impact?: string;
  learnMoreUrl?: string;
}

export interface ScientificParameterHelpProps {
  content: ParameterHelpContent;
  className?: string;
}

export const ScientificParameterHelp: React.FC<
  ScientificParameterHelpProps
> = ({ content, className = "" }) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-5 w-5 p-0 hover:bg-transparent ${className}`}
          aria-label={`Learn more about ${content.name}`}
        >
          <Info className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-sm mb-1">{content.name}</h4>
            <p className="text-sm text-muted-foreground">
              {content.explanation}
            </p>
          </div>

          {content.formula && (
            <div className="bg-muted/50 p-2 rounded text-xs font-mono">
              {content.formula}
            </div>
          )}

          {content.typicalValues && (
            <div>
              <p className="text-xs font-semibold mb-1">Typical Values:</p>
              <p className="text-xs text-muted-foreground">
                {content.typicalValues}
              </p>
            </div>
          )}

          {content.impact && (
            <div>
              <p className="text-xs font-semibold mb-1">Impact:</p>
              <p className="text-xs text-muted-foreground">{content.impact}</p>
            </div>
          )}

          {content.learnMoreUrl && (
            <a
              href={content.learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              Learn more in documentation →
            </a>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const PARAMETER_HELP: Record<string, ParameterHelpContent> = {
  embeddingDimension: {
    name: "Embedding Dimension (dm)",
    explanation:
      "The number of delayed coordinates used to reconstruct the system's state space from time series data.",
    typicalValues: "2-10 (default: 4 for EEG/MEG data)",
    impact:
      "Higher values capture more complex dynamics but require more data and computation time.",
  },
  polynomialOrder: {
    name: "Polynomial Order",
    explanation:
      "The degree of polynomial terms used in the model. Controls the nonlinearity of the approximation.",
    typicalValues: "2-6 (default: 4)",
    impact:
      "Higher orders can model more complex relationships but risk overfitting with limited data.",
  },
  nrTau: {
    name: "Number of Delays (nr_tau)",
    explanation:
      "How many time delay values to test when analyzing the relationship between signals.",
    typicalValues: "2-5 delays (default: 2)",
    impact:
      "More delays provide finer temporal resolution but increase computation time linearly.",
  },
  windowLength: {
    name: "Window Length",
    explanation:
      "Duration of each analysis window in seconds. DDA analyzes data in overlapping or non-overlapping windows.",
    typicalValues: "1-10 seconds depending on signal characteristics",
    impact:
      "Longer windows provide better statistical stability but reduce temporal resolution.",
  },
  windowStep: {
    name: "Window Step",
    explanation:
      "How far to advance between consecutive analysis windows. Smaller values create more overlap.",
    typicalValues: "0.1-2 seconds (often 50% of window length)",
    impact:
      "Smaller steps give smoother results but increase computation time significantly.",
  },
  delays: {
    name: "Delay Values (τ)",
    explanation:
      "Specific time delays (in samples) to test for dynamical relationships between signals.",
    typicalValues:
      "Based on signal frequency content (e.g., [7, 10] for 256Hz EEG)",
    impact:
      "Should match characteristic timescales of the phenomena under study.",
  },
  polynomialEncoding: {
    name: "Polynomial Encoding",
    explanation:
      "Specific polynomial terms to include in the model, allowing fine control over the model structure.",
    typicalValues:
      "[1, 2, 10] for EEG (includes linear and select nonlinear terms)",
    impact:
      "Custom encodings can improve accuracy and reduce overfitting by excluding irrelevant terms.",
  },
};

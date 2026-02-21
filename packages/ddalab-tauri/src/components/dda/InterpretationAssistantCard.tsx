"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { InterpretationAssessment } from "@/lib/clinical/interpretationAdvisor";

interface InterpretationAssistantCardProps {
  assessment: InterpretationAssessment;
  variantLabel: string;
}

function toBadgeVariant(decision: InterpretationAssessment["decision"]) {
  if (decision === "proceed") return "success";
  if (decision === "refine") return "warning";
  return "destructive";
}

function toDecisionLabel(decision: InterpretationAssessment["decision"]) {
  if (decision === "proceed") return "Proceed";
  if (decision === "refine") return "Refine";
  return "Reconsider";
}

export function InterpretationAssistantCard({
  assessment,
  variantLabel,
}: InterpretationAssistantCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">
            Interpretation Assistant ({variantLabel})
          </CardTitle>
          <Badge variant={toBadgeVariant(assessment.decision)}>
            {toDecisionLabel(assessment.decision)} · Score {assessment.score}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          {assessment.summary}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>Channels: {assessment.stats.channelCount}</div>
          <div>Windows: {assessment.stats.windowCount}</div>
          <div>
            Finite ratio: {(assessment.stats.finiteValueRatio * 100).toFixed(1)}
            %
          </div>
          <div>
            Coverage:{" "}
            {(assessment.stats.selectedCoverageRatio * 100).toFixed(1)}%
          </div>
        </div>

        <div>
          <p className="text-xs font-medium mb-1">Why this status</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            {assessment.reasons.slice(0, 2).map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-medium mb-1">Recommended next step</p>
          <p className="text-xs text-muted-foreground">
            {assessment.recommendedActions[0]}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

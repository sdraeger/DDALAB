import { useMutation } from "@tanstack/react-query";
import type { ChunkData } from "@/types/api";
import type {
  PipelineStepType,
  PreprocessingPipeline,
} from "@/types/preprocessing";
import { tauriBackendService } from "@/services/tauriBackendService";
import { useAppStore } from "@/store/appStore";

interface ExecutePipelineParams {
  pipelineId: string;
  pipeline: PreprocessingPipeline;
  chunk: ChunkData;
}

function toStepType(stepType: string): PipelineStepType | null {
  if (stepType === "bad_channel_detection") return "bad_channel_detection";
  if (stepType === "filtering") return "filtering";
  if (stepType === "rereference") return "rereference";
  if (stepType === "ica") return "ica";
  if (stepType === "artifact_removal") return "artifact_removal";
  return null;
}

/**
 * Execute the rich preprocessing pipeline in Rust backend.
 * This bridges frontend pipeline configuration to backend processing.
 */
export function usePreprocessingPipelineExecution() {
  const setPipelineRunning = useAppStore((s) => s.setPipelineRunning);
  const setStepStatus = useAppStore((s) => s.setStepStatus);
  const setStepResult = useAppStore((s) => s.setStepResult);
  const setPipelineProgress = useAppStore((s) => s.setPipelineProgress);

  return useMutation({
    mutationFn: async ({ pipeline, chunk }: ExecutePipelineParams) => {
      return tauriBackendService.executePreprocessingPipeline(chunk, pipeline);
    },
    onMutate: ({ pipelineId }) => {
      setPipelineRunning(pipelineId, true);
      setPipelineProgress(pipelineId, 0, 0);
      setStepStatus(pipelineId, "bad_channel_detection", "pending");
      setStepStatus(pipelineId, "filtering", "pending");
      setStepStatus(pipelineId, "rereference", "pending");
      setStepStatus(pipelineId, "ica", "pending");
      setStepStatus(pipelineId, "artifact_removal", "pending");
    },
    onSuccess: (result, { pipelineId }) => {
      for (const report of result.stepReports) {
        const stepType = toStepType(report.stepType);
        if (!stepType) continue;

        if (report.status === "completed") {
          setStepStatus(pipelineId, stepType, "completed");
        } else if (report.status === "skipped") {
          setStepStatus(pipelineId, stepType, "skipped", report.details);
        } else {
          setStepStatus(pipelineId, stepType, "error", report.details);
        }
      }

      setStepResult(pipelineId, "bad_channel_detection", {
        detectedBadChannels: result.badChannels,
      });
      setStepResult(pipelineId, "artifact_removal", {
        artifactCount: result.artifactCount,
        diagnosticLog: result.diagnosticLog,
      });
      setPipelineProgress(pipelineId, 4, 100);
      setPipelineRunning(pipelineId, false);
    },
    onError: (error, { pipelineId }) => {
      const message = error instanceof Error ? error.message : String(error);
      setStepStatus(pipelineId, "filtering", "error", message);
      setPipelineRunning(pipelineId, false);
    },
  });
}

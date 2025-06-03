"use client";

// Structure: DDAForm.tsx contains a <DDAPlot> component that contains an <EEGChart> component.

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "shared/components/ui/card";
import { Form } from "shared/components/ui/form";
import { toast } from "shared/hooks/useToast";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { DDAPlot } from "../plot/DDAPlot";
import { apiRequest } from "../../lib/utils/request";
import { EdfConfigResponse } from "shared/lib/schemas/edf";
import { PreprocessingOptionsUI } from "../ui/PreprocessingOptionsUI";
import { VisualizationOptionsUI } from "../ui/VisualizationOptionsUI";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "shared/components/ui/alert";

const formSchema = z
  .object({
    filePath: z.string().min(1, "File path is required"),
    preprocessingSteps: z.array(
      z.object({ id: z.string(), label: z.string() }).strict()
    ),
    removeOutliers: z.boolean(),
    smoothing: z.boolean(),
    smoothingWindow: z.number(),
    normalization: z.enum(["none", "minmax", "zscore"]),
  })
  .strict();

export type FormValues = z.infer<typeof formSchema>;

interface DDAFormProps {
  filePath: string;
  selectedChannels: string[];
  setSelectedChannels: (channels: string[]) => void;
}

interface DDAResponse {
  Q: number[][];
  file_path: string;
  metadata: Record<string, string> | null;
  error?: string;
  error_message?: string;
}

export function DDAForm({
  filePath,
  selectedChannels,
  setSelectedChannels,
}: DDAFormProps) {
  const { data: session } = useSession();
  const [Q, setQ] = useState<number[][] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [serverConfigError, setServerConfigError] = useState<string | null>(
    null
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      filePath,
      preprocessingSteps: [],
      removeOutliers: false,
      smoothing: false,
      smoothingWindow: 3,
      normalization: "none",
    },
  });

  const getChannelIndices = (channels: string[]) =>
    channels
      .map((label) => availableChannels.indexOf(label) + 1)
      .filter((index) => index !== -1);

  const submitDDA = async (data: FormValues) => {
    setIsSubmitting(true);
    setQ(null);
    setServerConfigError(null);

    try {
      const channelIndices = getChannelIndices(selectedChannels);
      const response = await apiRequest<DDAResponse>({
        url: "/api/dda",
        method: "POST",
        token: session?.accessToken,
        body: {
          file_path: data.filePath,
          channel_list: channelIndices,
          preprocessing_options: {
            resample: data.preprocessingSteps.some(
              (step) => step.id === "resample"
            ),
            lowpassFilter: data.preprocessingSteps.some(
              (step) => step.id === "lowpassFilter"
            ),
            highpassFilter: data.preprocessingSteps.some(
              (step) => step.id === "highpassFilter"
            ),
            notchFilter: data.preprocessingSteps.some(
              (step) => step.id === "notchFilter"
            ),
            detrend: data.preprocessingSteps.some(
              (step) => step.id === "detrend"
            ),
            removeOutliers: data.removeOutliers,
            smoothing: data.smoothing,
            smoothingWindow: data.smoothingWindow,
            normalization: data.normalization,
          },
        },
        responseType: "json",
      });

      // Check for server configuration errors
      if (response.error === "DDA_BINARY_INVALID") {
        setServerConfigError(
          response.error_message ||
            "DDA binary is not properly configured on the server"
        );
        toast({
          title: "Server Configuration Error",
          description:
            "The DDA binary is not properly configured. Please contact your administrator.",
          variant: "destructive",
        });
        return;
      }

      setQ(response.Q);
      toast({
        title: "DDA Complete",
        description: "Results received successfully",
      });
    } catch (error) {
      toast({
        title: "Error Submitting DDA Task",
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateChannelSelection = async (channels: string[]) => {
    setSelectedChannels(channels);
    try {
      await apiRequest<EdfConfigResponse>({
        url: "/api/config/edf",
        method: "POST",
        token: session?.accessToken,
        body: { channels, file_path: filePath },
        responseType: "json",
      });
    } catch (error) {
      toast({
        title: "Error Updating Channels",
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {serverConfigError && (
        <Alert variant="destructive">
          <AlertTitle>Server Configuration Error</AlertTitle>
          <AlertDescription>
            The DDA binary is not properly configured on the server.
            {serverConfigError && ` Details: ${serverConfigError}`}
            <br />
            Please contact your administrator to resolve this issue.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>DDA</CardTitle>
          <CardDescription>Configure and run DDA</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submitDDA)} className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Selected File</h3>
                  <p className="text-sm text-muted-foreground break-all border p-2 rounded-md bg-muted/50">
                    {filePath}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium mb-2">Configuration</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                        Preprocessing
                      </h4>
                      <PreprocessingOptionsUI form={form} />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                        Visualization
                      </h4>
                      <VisualizationOptionsUI form={form} />
                    </div>
                  </div>
                </div>
              </div>
              <Button
                type="submit"
                disabled={isSubmitting || selectedChannels.length === 0}
                className="w-full md:w-auto"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Run DDA"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <DDAPlot
        filePath={filePath}
        Q={Q}
        selectedChannels={
          selectedChannels.length
            ? selectedChannels
            : availableChannels.slice(0, 5)
        }
        setSelectedChannels={setSelectedChannels}
        onChannelSelectionChange={updateChannelSelection}
        onAvailableChannelsChange={setAvailableChannels}
        preprocessingOptions={{
          removeOutliers: form.watch("removeOutliers"),
          smoothing: form.watch("smoothing"),
          smoothingWindow: form.watch("smoothingWindow"),
          normalization: form.watch("normalization"),
        }}
      />
    </div>
  );
}

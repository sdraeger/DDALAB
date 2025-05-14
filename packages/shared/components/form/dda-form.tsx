"use client";

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
import { toast } from "shared/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { DDAPlot } from "../plot/dda-plot";
import { apiRequest, ApiRequestOptions } from "../../lib/utils/request";
import { useSession } from "next-auth/react";
import { EdfConfigResponse } from "shared/lib/schemas/edf";
import { PreprocessingOptionsUI } from "../ui/PreprocessingOptionsUI";
import { VisualizationOptionsUI } from "../ui/VisualizationOptionsUI";

// Form validation schema
const formSchema = z
  .object({
    filePath: z.string().min(1, "File path is required"),
    // DDA Analysis options - New structure for preprocessing
    preprocessingSteps: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
          })
          .strict()
      )
      .default([]),
    // Visualization options (remain unchanged for now)
    removeOutliers: z.boolean().default(false),
    smoothing: z.boolean().default(false),
    smoothingWindow: z.number().default(3),
    normalization: z.enum(["none", "minmax", "zscore"]).default("none"),
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
}

export function DDAForm({
  filePath,
  selectedChannels,
  setSelectedChannels,
}: DDAFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as z.ZodType<FormValues>),
    defaultValues: {
      filePath,
      preprocessingSteps: [],
      removeOutliers: false,
      smoothing: false,
      smoothingWindow: 3,
      normalization: "none",
    },
  });

  const { data: session } = useSession();
  const [Q, setQ] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    setQ(null);
    try {
      // Convert selected channel labels to indices based on available channels
      const channelIndices = selectedChannels
        .map((label) => availableChannels.indexOf(label) + 1) // Respect DDA's 1-based indexing
        .filter((index) => index !== -1); // Filter out any channels not found in availableChannels

      const requestOptions: ApiRequestOptions & { responseType: "json" } = {
        url: "/api/dda",
        method: "POST",
        token: session?.accessToken,
        body: {
          file_path: data.filePath,
          channel_list: channelIndices,
          preprocessing_options: {
            resample_1000hz: data.preprocessingSteps.some(
              (step) => step.id === "resample1000hz"
            ),
            resample_500hz: data.preprocessingSteps.some(
              (step) => step.id === "resample500hz"
            ),
            lowpass_filter: data.preprocessingSteps.some(
              (step) => step.id === "lowpassFilter"
            ),
            highpass_filter: data.preprocessingSteps.some(
              (step) => step.id === "highpassFilter"
            ),
            notch_filter: data.preprocessingSteps.some(
              (step) => step.id === "notchFilter"
            ),
            detrend: data.preprocessingSteps.some(
              (step) => step.id === "detrend"
            ),
            remove_outliers: data.removeOutliers,
            smoothing: data.smoothing,
            smoothing_window: data.smoothingWindow,
            normalization: data.normalization,
          },
        },
        responseType: "json",
      };

      const response = await apiRequest<DDAResponse>(requestOptions);
      console.log("DDA response:", response);

      setQ(response?.Q);

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

  const handleChannelSelectionChange = async (selectedChannels: string[]) => {
    setSelectedChannels(selectedChannels);

    const body = {
      channels: selectedChannels,
      file_path: filePath,
    };
    const requestOptions: ApiRequestOptions & { responseType: "json" } = {
      url: `/api/config/edf`,
      method: "POST",
      token: session?.accessToken,
      body: body,
      responseType: "json",
    };
    const response = await apiRequest<EdfConfigResponse>(requestOptions);

    console.log("Request Options:", requestOptions);
    console.log("File config:", response);
  };

  const handleAvailableChannelsChange = (channels: string[]) => {
    setAvailableChannels(channels);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>DDA</CardTitle>
          <CardDescription>
            Configure preprocessing options and run analysis on your EEG data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Selected File</h3>
                  <p className="text-sm text-muted-foreground break-all border p-2 rounded-md bg-muted/50">
                    {filePath}
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">
                    Preprocessing Options
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {/* DDA Options Section */}
                    <div className="col-span-full">
                      <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                        DDA Options
                      </h4>
                    </div>

                    {/* New Preprocessing Steps UI */}
                    <PreprocessingOptionsUI form={form} />

                    {/* End New Preprocessing Steps UI */}

                    {/* Visualization Options Section - MOVED to VisualizationOptionsUI.tsx */}
                    <VisualizationOptionsUI form={form} />
                  </div>
                </div>
              </div>

              <div>
                <Button
                  type="submit"
                  disabled={isSubmitting || selectedChannels.length === 0}
                  className="w-full md:w-auto"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                      Submitting...
                    </>
                  ) : (
                    "Run DDA"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <DDAPlot
        filePath={filePath}
        Q={Q}
        selectedChannels={selectedChannels || availableChannels.slice(5)}
        setSelectedChannels={setSelectedChannels}
        onChannelSelectionChange={handleChannelSelectionChange}
        onAvailableChannelsChange={handleAvailableChannelsChange}
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

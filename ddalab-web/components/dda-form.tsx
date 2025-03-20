"use client";
import { useMutation } from "@apollo/client";
import { SUBMIT_DDA_TASK } from "@/lib/graphql/mutations";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { DDAPlot } from "@/components/dda-plot";

// Form validation schema
const formSchema = z.object({
  filePath: z.string().min(1, "File path is required"),
  // DDA Analysis options
  resample1000hz: z.boolean().default(false),
  resample500hz: z.boolean().default(false),
  lowpassFilter: z.boolean().default(false),
  highpassFilter: z.boolean().default(false),
  notchFilter: z.boolean().default(false),
  detrend: z.boolean().default(false),
  // Visualization options
  removeOutliers: z.boolean().default(false),
  smoothing: z.boolean().default(false),
  smoothingWindow: z.number().default(3),
  normalization: z.enum(["none", "minmax", "zscore"]).default("none"),
});

type FormValues = z.infer<typeof formSchema>;

interface DDAFormProps {
  filePath: string;
  onTaskSubmitted: (taskId: string) => void;
}

export function DDAForm({ filePath, onTaskSubmitted }: DDAFormProps) {
  const [submitDDATask, { loading }] = useMutation(SUBMIT_DDA_TASK);
  const [taskId, setTaskId] = useState<string | undefined>(undefined);

  // NOTE: To prevent infinite update loops when clicking the form items:
  // 1. We wrap each checkbox in a div with class "checkbox-container"
  // 2. In the onClick handlers, we check if the click target is NOT inside that container
  // 3. We only toggle the checkbox value if the click happened outside the checkbox
  // This prevents the checkbox's onChange and the FormItem's onClick from both firing and
  // creating an infinite loop of state updates

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      filePath,
      resample1000hz: false,
      resample500hz: false,
      lowpassFilter: false,
      highpassFilter: false,
      notchFilter: false,
      detrend: false,
      removeOutliers: false,
      smoothing: false,
      smoothingWindow: 3,
      normalization: "none",
    },
  });

  const onSubmit = async (data: FormValues) => {
    try {
      const { data: responseData } = await submitDDATask({
        variables: {
          filePath: data.filePath,
          preprocessingOptions: {
            resample1000hz: data.resample1000hz,
            resample500hz: data.resample500hz,
            lowpassFilter: data.lowpassFilter,
            highpassFilter: data.highpassFilter,
            notchFilter: data.notchFilter,
            detrend: data.detrend,
            removeOutliers: data.removeOutliers,
            smoothing: data.smoothing,
            smoothingWindow: data.smoothingWindow,
            normalization: data.normalization,
          },
        },
      });

      if (responseData?.startDda?.taskId) {
        toast({
          title: "DDA Task Submitted",
          description: `Task ID: ${responseData.startDda.taskId}`,
        });
        setTaskId(responseData.startDda.taskId);
        onTaskSubmitted(responseData.startDda.taskId);
      }
    } catch (error) {
      toast({
        title: "Error Submitting DDA Task",
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>DDA Analysis</CardTitle>
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
                    {/* DDA Analysis Options Section */}
                    <div className="col-span-full">
                      <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                        DDA Analysis Options
                      </h4>
                    </div>

                    <FormField
                      control={form.control}
                      name="resample1000hz"
                      render={({ field }) => (
                        <FormItem
                          className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                            field.value ? "bg-primary/10 border-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            if (
                              !(e.target as HTMLElement).closest(
                                ".checkbox-container"
                              )
                            ) {
                              field.onChange(!field.value);
                            }
                          }}
                        >
                          <FormControl>
                            <div className="checkbox-container">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer">
                              Resample to 1000Hz
                            </FormLabel>
                            <FormDescription>
                              Resample the data to 1000Hz
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="resample500hz"
                      render={({ field }) => (
                        <FormItem
                          className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                            field.value ? "bg-primary/10 border-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            if (
                              !(e.target as HTMLElement).closest(
                                ".checkbox-container"
                              )
                            ) {
                              field.onChange(!field.value);
                            }
                          }}
                        >
                          <FormControl>
                            <div className="checkbox-container">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer">
                              Resample to 500Hz
                            </FormLabel>
                            <FormDescription>
                              Resample the data to 500Hz
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="lowpassFilter"
                      render={({ field }) => (
                        <FormItem
                          className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                            field.value ? "bg-primary/10 border-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            if (
                              !(e.target as HTMLElement).closest(
                                ".checkbox-container"
                              )
                            ) {
                              field.onChange(!field.value);
                            }
                          }}
                        >
                          <FormControl>
                            <div className="checkbox-container">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer">
                              Low-pass Filter
                            </FormLabel>
                            <FormDescription>
                              Apply a low-pass filter to the data
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="highpassFilter"
                      render={({ field }) => (
                        <FormItem
                          className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                            field.value ? "bg-primary/10 border-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            if (
                              !(e.target as HTMLElement).closest(
                                ".checkbox-container"
                              )
                            ) {
                              field.onChange(!field.value);
                            }
                          }}
                        >
                          <FormControl>
                            <div className="checkbox-container">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer">
                              High-pass Filter
                            </FormLabel>
                            <FormDescription>
                              Apply a high-pass filter to the data
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notchFilter"
                      render={({ field }) => (
                        <FormItem
                          className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                            field.value ? "bg-primary/10 border-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            if (
                              !(e.target as HTMLElement).closest(
                                ".checkbox-container"
                              )
                            ) {
                              field.onChange(!field.value);
                            }
                          }}
                        >
                          <FormControl>
                            <div className="checkbox-container">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer">
                              Notch Filter
                            </FormLabel>
                            <FormDescription>
                              Apply a notch filter to remove line noise
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="detrend"
                      render={({ field }) => (
                        <FormItem
                          className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                            field.value ? "bg-primary/10 border-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            if (
                              !(e.target as HTMLElement).closest(
                                ".checkbox-container"
                              )
                            ) {
                              field.onChange(!field.value);
                            }
                          }}
                        >
                          <FormControl>
                            <div className="checkbox-container">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer">
                              Detrend
                            </FormLabel>
                            <FormDescription>
                              Remove linear trends from the data
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />

                    {/* Visualization Options Section */}
                    <div className="col-span-full mt-6">
                      <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                        Visualization Options
                      </h4>
                    </div>

                    <FormField
                      control={form.control}
                      name="removeOutliers"
                      render={({ field }) => (
                        <FormItem
                          className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                            field.value ? "bg-primary/10 border-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            if (
                              !(e.target as HTMLElement).closest(
                                ".checkbox-container"
                              )
                            ) {
                              field.onChange(!field.value);
                            }
                          }}
                        >
                          <FormControl>
                            <div className="checkbox-container">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer">
                              Remove Outliers
                            </FormLabel>
                            <FormDescription>
                              Remove extreme values from the signal
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="smoothing"
                      render={({ field }) => (
                        <FormItem
                          className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                            field.value ? "bg-primary/10 border-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            if (
                              !(e.target as HTMLElement).closest(
                                ".checkbox-container"
                              )
                            ) {
                              field.onChange(!field.value);
                            }
                          }}
                        >
                          <FormControl>
                            <div className="checkbox-container">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer">
                              Apply Smoothing
                            </FormLabel>
                            <FormDescription>
                              Smooth the signal to reduce noise
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />

                    {form.watch("smoothing") && (
                      <FormField
                        control={form.control}
                        name="smoothingWindow"
                        render={({ field }) => (
                          <FormItem className="rounded-md border p-4 space-y-2">
                            <FormLabel>Smoothing Window</FormLabel>
                            <FormDescription>
                              Window size for smoothing filter: {field.value}
                            </FormDescription>
                            <FormControl>
                              <input
                                type="range"
                                min={3}
                                max={15}
                                step={2}
                                value={field.value}
                                onChange={(e) =>
                                  field.onChange(parseInt(e.target.value))
                                }
                                className="w-full"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    )}

                    <FormField
                      control={form.control}
                      name="normalization"
                      render={({ field }) => (
                        <FormItem className="rounded-md border p-4 space-y-2">
                          <FormLabel>Normalization</FormLabel>
                          <FormDescription>
                            Choose signal normalization method
                          </FormDescription>
                          <FormControl>
                            <select
                              className="w-full rounded-md border border-input bg-background px-3 py-2"
                              value={field.value}
                              onChange={field.onChange}
                            >
                              <option value="none">None</option>
                              <option value="minmax">Min-Max</option>
                              <option value="zscore">Z-Score</option>
                            </select>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>

              <div>
                <Button type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Run DDA Analysis"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <DDAPlot
        filePath={filePath}
        taskId={taskId}
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

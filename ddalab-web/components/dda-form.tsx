"use client"
import { useMutation } from "@apollo/client"
import { SUBMIT_DDA_TASK } from "@/lib/graphql/mutations"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form"
import { toast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

// Form validation schema
const formSchema = z.object({
  filePath: z.string().min(1, "File path is required"),
  resample1000hz: z.boolean().default(false),
  resample500hz: z.boolean().default(false),
  lowpassFilter: z.boolean().default(false),
  highpassFilter: z.boolean().default(false),
  notchFilter: z.boolean().default(false),
  detrend: z.boolean().default(false),
})

type FormValues = z.infer<typeof formSchema>

interface DDAFormProps {
  filePath: string
  onTaskSubmitted: (taskId: string) => void
}

export function DDAForm({ filePath, onTaskSubmitted }: DDAFormProps) {
  const [submitDDATask, { loading }] = useMutation(SUBMIT_DDA_TASK)

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
    },
  })

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
          },
        },
      })

      if (responseData?.submitDDATask?.taskId) {
        toast({
          title: "DDA Task Submitted",
          description: `Task ID: ${responseData.submitDDATask.taskId}`,
        })
        onTaskSubmitted(responseData.submitDDATask.taskId)
      }
    } catch (error) {
      toast({
        title: "Error Submitting DDA Task",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit DDA Task</CardTitle>
        <CardDescription>Configure preprocessing options for your DDA analysis</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Selected File</h3>
                <p className="text-sm text-muted-foreground break-all border p-2 rounded-md bg-muted/50">{filePath}</p>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Preprocessing Options</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="resample1000hz"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Resample to 1000Hz</FormLabel>
                          <FormDescription>Resample the data to 1000Hz</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="resample500hz"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Resample to 500Hz</FormLabel>
                          <FormDescription>Resample the data to 500Hz</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="lowpassFilter"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Low-pass Filter</FormLabel>
                          <FormDescription>Apply a low-pass filter to the data</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="highpassFilter"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>High-pass Filter</FormLabel>
                          <FormDescription>Apply a high-pass filter to the data</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notchFilter"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Notch Filter</FormLabel>
                          <FormDescription>Apply a notch filter to remove line noise</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="detrend"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Detrend</FormLabel>
                          <FormDescription>Remove linear trends from the data</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit DDA Task"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}


/**
 * Example demonstrating how to integrate WorkflowRecorder into DDALAB
 *
 * Add this to DashboardLayout.tsx or page.tsx:
 *
 * ```tsx
 * import { WorkflowRecorder } from "@/components/workflow/WorkflowRecorder";
 *
 * export function DashboardLayout() {
 *   return (
 *     <div>
 *       {/* Add to header/toolbar area *\/}
 *       <div className="flex items-center justify-between p-4 border-b">
 *         <h1>DDALAB</h1>
 *         <WorkflowRecorder />
 *       </div>
 *
 *       {/* Rest of dashboard *\/}
 *       <main>...</main>
 *     </div>
 *   );
 * }
 * ```
 *
 * The WorkflowRecorder provides:
 * - Start/Stop recording button
 * - Buffer status indicator (N actions buffered)
 * - Export dropdown (JSON or Code in Python/Julia)
 * - Clear buffer option
 *
 * Once integrated, users can:
 * 1. Click "Start Recording" before beginning analysis
 * 2. Perform their analysis workflow normally
 * 3. Click "Export Workflow" when done
 * 4. Choose language (Python/Julia) and time window
 * 5. Save as executable script
 */

"use client";

import { WorkflowRecorder } from "./WorkflowRecorder";

export function WorkflowRecorderExample() {
  return (
    <div className="container mx-auto p-8 space-y-8">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Workflow Recording Demo</h1>
        <p className="text-muted-foreground">
          This demonstrates the workflow recording system. The recorder will
          appear in the top-right corner of the dashboard once integrated.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">Workflow Recorder</h2>
        <WorkflowRecorder />
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">How It Works</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li>
            Click <strong>"Start Recording"</strong> to begin capturing actions
          </li>
          <li>
            Perform your analysis (load files, select channels, configure DDA,
            run analysis)
          </li>
          <li>
            Actions are automatically recorded in a circular buffer (last 200
            actions)
          </li>
          <li>
            Click <strong>"Actions" → "Export Workflow"</strong> when done
          </li>
          <li>Choose language (Python or Julia) and time window</li>
          <li>Save as executable script or JSON workflow definition</li>
        </ol>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Recorded Actions</h2>
        <div className="rounded-lg bg-muted p-4 text-sm font-mono">
          <p># Example Python output:</p>
          <pre className="mt-2 text-xs">
            {`import ddalab_py as dda

# Load data file
file = dda.load_file("data.edf")

# Select channels
channels = [0, 1, 2, 3]
file.select_channels(channels)

# Configure DDA
dda.set_parameters(
    window_length=1000,
    window_step=100,
    delays=[-10, -5, 0, 5, 10]
)

# Run analysis
result = dda.run_analysis(
    file,
    channels=channels,
    variants=["single_timeseries"]
)

# Export results
result.to_csv("results.csv")`}
          </pre>
        </div>
      </div>
    </div>
  );
}

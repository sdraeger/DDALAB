import type { TutorialDefinition } from "@/types/learn";

export const tutorials: TutorialDefinition[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    description:
      "Learn the basics: open a file, explore channels, and navigate the time series view.",
    icon: "Rocket",
    estimatedMinutes: 5,
    requiredDataset: "eeg-sample-rest",
    steps: [
      {
        id: "welcome",
        type: "narrative",
        title: "Welcome to DDALAB",
        content:
          "DDALAB is a desktop application for Delay Differential Analysis of neurophysiology data. In this tutorial, you'll learn how to open a data file and explore its contents.\n\nLet's start by downloading a sample dataset.",
      },
      {
        id: "navigate-learn",
        type: "highlight",
        title: "Sample Data",
        target: "[data-nav='learn']",
        content:
          "You're in the Learn tab. If you haven't already, switch to the **Sample Data** sub-tab to download example datasets.",
      },
      {
        id: "open-file",
        type: "action",
        title: "Open the Sample File",
        actionDescription:
          "In the file sidebar, navigate to the downloaded sample dataset and click on it to open.",
        completionCheck: {
          storeKey: "fileManager.selectedFile",
          expectedValue: "non-null",
        },
      },
      {
        id: "explore-channels",
        type: "highlight",
        title: "Channel List",
        target: "[data-tour='file-manager']",
        content:
          "The sidebar shows all channels in the file. Each channel represents an electrode or sensor. You can select/deselect channels to control which ones are displayed.",
      },
      {
        id: "view-timeseries",
        type: "auto",
        title: "Navigate to Time Series",
        autoAction: {
          type: "navigate",
          payload: { primary: "explore", secondary: "timeseries" },
        },
      },
      {
        id: "timeseries-overview",
        type: "narrative",
        title: "Time Series View",
        content:
          "The time series view shows the raw signal data over time. You can:\n\n- **Scroll** horizontally to navigate through the recording\n- **Zoom** with the mouse wheel to see more or less detail\n- **Select channels** from the sidebar to add/remove traces\n\nTry scrolling and zooming to explore the data!",
      },
      {
        id: "complete",
        type: "narrative",
        title: "Tutorial Complete!",
        content:
          "You've learned the basics of opening and exploring data in DDALAB. Next, try the **Your First DDA Analysis** tutorial to learn about running Delay Differential Analysis.",
      },
    ],
  },
  {
    id: "first-dda-analysis",
    title: "Your First DDA Analysis",
    description:
      "Configure DDA parameters, run an analysis, and interpret the results heatmap.",
    icon: "Brain",
    estimatedMinutes: 10,
    requiredDataset: "eeg-sample-rest",
    steps: [
      {
        id: "intro",
        type: "narrative",
        title: "What is DDA?",
        content:
          "Delay Differential Analysis (DDA) fits delay differential equation models to time series data. The resulting coefficients reveal the underlying dynamics of the signal.\n\nIn this tutorial, you'll run a DDA analysis on sample EEG data and learn to interpret the results.",
      },
      {
        id: "nav-to-dda",
        type: "auto",
        title: "Navigate to DDA",
        autoAction: {
          type: "navigate",
          payload: { primary: "analyze", secondary: "dda" },
        },
      },
      {
        id: "select-channels",
        type: "action",
        title: "Select Channels",
        actionDescription:
          "Select 3-5 channels for analysis (e.g., Fz, Cz, Pz, O1, O2). Fewer channels means faster analysis for this tutorial.",
      },
      {
        id: "configure-params",
        type: "highlight",
        title: "DDA Parameters",
        target: "[data-tour='analysis-config']",
        content:
          "The analysis configuration panel lets you set:\n\n- **Variants**: Which DDA models to fit (DDA1-DDA9)\n- **Window Length**: How many seconds per analysis window\n- **Delays**: The time delays (tau values) to test\n\nThe defaults are a good starting point. Click **Run Analysis** when ready.",
      },
      {
        id: "run-analysis",
        type: "action",
        title: "Run the Analysis",
        actionDescription:
          "Click the Run Analysis button to start the DDA computation.",
        target: "#dda-run-button",
        completionCheck: {
          storeKey: "dda.currentAnalysis",
          expectedValue: "non-null",
        },
      },
      {
        id: "interpret-results",
        type: "narrative",
        title: "Interpreting Results",
        content:
          "The heatmap shows DDA coefficients across channels and time windows:\n\n- **X-axis**: Time windows across the recording\n- **Y-axis**: DDA model coefficients\n- **Color**: Coefficient magnitude (brighter = stronger)\n\nLook for patterns: consistent bands indicate stable dynamics, while changes across time may indicate state transitions.",
      },
      {
        id: "complete",
        type: "narrative",
        title: "Analysis Complete!",
        content:
          "Congratulations! You've run your first DDA analysis. Explore the results by hovering over the heatmap for detailed values, or try different parameter settings.",
      },
    ],
  },
  {
    id: "reproduce-paper",
    title: "Reproduce a Published Result",
    description:
      "Download a paper recipe and reproduce a DDA analysis from published research.",
    icon: "FileSearch",
    estimatedMinutes: 15,
    steps: [
      {
        id: "intro",
        type: "narrative",
        title: "Reproducing Published Results",
        content:
          "One of DDALAB's key features is the ability to reproduce DDA results from published papers. Each paper recipe includes the exact dataset, channels, parameters, and expected outcomes.\n\nLet's walk through the process.",
      },
      {
        id: "nav-to-papers",
        type: "auto",
        title: "Navigate to Papers",
        autoAction: {
          type: "navigate",
          payload: { primary: "learn", secondary: "papers" },
        },
      },
      {
        id: "browse-recipes",
        type: "narrative",
        title: "Browse Available Recipes",
        content:
          "The Papers view lists available reproduction recipes. Each card shows:\n\n- **Citation**: Authors, journal, year\n- **Description**: What figure or result to reproduce\n- **Dataset**: Which data is needed\n\nSelect a recipe to see its full details and run it.",
      },
      {
        id: "run-recipe",
        type: "action",
        title: "Run a Recipe",
        actionDescription:
          "Select a recipe card and click 'Run Recipe'. The app will download the required dataset (if needed), pre-fill the DDA parameters, and navigate to the analysis view.",
      },
      {
        id: "compare-results",
        type: "narrative",
        title: "Compare Your Results",
        content:
          "After the analysis completes, compare your results with the reference description in the recipe. The patterns should match the published findings.\n\nNote: Small numerical differences are normal due to floating-point precision and random initialization.",
      },
      {
        id: "complete",
        type: "narrative",
        title: "Reproduction Complete!",
        content:
          "You've successfully reproduced a published DDA result! This workflow validates both the software implementation and your understanding of the analysis.\n\nNew paper recipes are added regularly — check back for more.",
      },
    ],
  },
];

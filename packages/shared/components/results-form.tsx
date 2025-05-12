import React, { useState } from "react";
import { EEGChart } from "./plot/eeg-chart";
import type { EEGData } from "./eeg-dashboard";
import { DDAPlot } from "./plot/dda-plot";

// Define the expected props structure
interface ResultsFormProps {
  edfData: EEGData;
  filePath: string; // Add filePath prop for DDAPlot
  taskId?: string; // Add optional taskId prop for DDAPlot
  sharedByUser: string;
  snapshotTimestamp: string;
  selectedChannels?: string[];
  preprocessingOptions?: {
    removeOutliers: boolean;
    smoothing: boolean;
    smoothingWindow: number;
    normalization: string;
  };
}

const ResultsForm: React.FC<ResultsFormProps> = ({
  edfData,
  filePath,
  taskId,
  sharedByUser,
  snapshotTimestamp,
  selectedChannels,
  preprocessingOptions,
}) => {
  // State for the EDF chart's time window to enable local pan/zoom
  const [edfTimeWindow, setEdfTimeWindow] = useState<[number, number]>([
    0,
    edfData?.duration || 10,
  ]);

  // Update timeWindow state if edfData changes
  React.useEffect(() => {
    if (edfData?.duration) {
      setEdfTimeWindow([0, edfData.duration]);
    }
  }, [edfData]);

  // Use all channels from edfData if selectedChannels prop is not provided
  const channelsToDisplay = selectedChannels || edfData?.channels || [];

  const renderEdfPlot = () => {
    if (!edfData || channelsToDisplay.length === 0) {
      return (
        <div
          style={{
            border: "1px solid #ccc",
            borderRadius: "4px",
            minHeight: "300px",
            marginBottom: "20px",
            padding: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#888",
          }}
        >
          {channelsToDisplay.length === 0
            ? "No channels selected or available in EDF data."
            : "EDF Data not available."}
        </div>
      );
    }

    return (
      <div
        style={{
          height: "400px",
          border: "1px solid #ccc",
          borderRadius: "4px",
          marginBottom: "20px",
          position: "relative",
        }}
      >
        <EEGChart
          eegData={edfData}
          selectedChannels={channelsToDisplay}
          timeWindow={edfTimeWindow}
          onTimeWindowChange={setEdfTimeWindow}
          zoomLevel={1}
          editMode={false}
          className="w-full h-full"
          filePath={filePath}
        />
      </div>
    );
  };

  const renderDdaPlot = () => {
    return (
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: "4px",
          minHeight: "300px",
          padding: "10px",
        }}
      >
        {taskId ? (
          <DDAPlot
            filePath={filePath}
            taskId={taskId}
            preprocessingOptions={preprocessingOptions}
            selectedChannels={channelsToDisplay}
            setSelectedChannels={() => {}}
            onChannelSelectionChange={() => {}}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "300px",
              color: "#888",
            }}
          >
            DDA Plot Data not available. No task ID provided.
          </div>
        )}
      </div>
    );
  };

  // Format timestamp for display
  const formattedTimestamp = React.useMemo(() => {
    try {
      return new Date(snapshotTimestamp).toLocaleString();
    } catch (e) {
      console.error("Error formatting timestamp:", e);
      return "Invalid Date";
    }
  }, [snapshotTimestamp]);

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1 style={{ borderBottom: "1px solid #eee", paddingBottom: "10px" }}>
        Analysis Result Snapshot
      </h1>
      <div
        style={{
          margin: "15px 0",
          backgroundColor: "#f0f0f0",
          padding: "10px",
          borderRadius: "4px",
        }}
      >
        <p style={{ margin: "5px 0" }}>
          Shared by: <strong>{sharedByUser}</strong>
        </p>
        <p style={{ margin: "5px 0" }}>
          Snapshot taken on: <strong>{formattedTimestamp}</strong>
        </p>
      </div>
      <div style={{ marginTop: "20px" }}>
        <h2>EDF Data Chunk</h2>
        {renderEdfPlot()}
      </div>
      <div style={{ marginTop: "30px" }}>
        <h2>DDA Plot</h2>
        {renderDdaPlot()}
      </div>
      <p
        style={{
          marginTop: "20px",
          fontSize: "0.9em",
          color: "grey",
          textAlign: "center",
        }}
      >
        You can pan and zoom the plots using your mouse or trackpad. Data
        modification is disabled for this view.
      </p>
    </div>
  );
};

export default ResultsForm;

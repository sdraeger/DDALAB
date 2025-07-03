import logger from "./logger";

const ARTIFACT_CHANNEL_NAME = "artifact-channel";
const PLOT_CHANNEL_NAME = "plot-channel";

let artifactChannel: BroadcastChannel | null = null;
let plotChannel: BroadcastChannel | null = null;

if (typeof window !== "undefined") {
  try {
    artifactChannel = new BroadcastChannel(ARTIFACT_CHANNEL_NAME);
    plotChannel = new BroadcastChannel(PLOT_CHANNEL_NAME);
    logger.info(
      `Broadcast channels "${ARTIFACT_CHANNEL_NAME}" and "${PLOT_CHANNEL_NAME}" initialized`
    );
  } catch (e) {
    logger.error("Error creating broadcast channels", e);
  }
}

// Artifact channel
export const postArtifactCreatedMessage = (artifactId: string) => {
  if (artifactChannel) {
    artifactChannel.postMessage({ type: "NEW_ARTIFACT", artifactId });
    logger.info(`Posted NEW_ARTIFACT message for artifactId: ${artifactId}`);
  }
};

export const addArtifactListener = (callback: (artifactId: string) => void) => {
  if (artifactChannel) {
    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === "NEW_ARTIFACT") {
        logger.info(
          `Received NEW_ARTIFACT message for artifactId: ${event.data.artifactId}`
        );
        callback(event.data.artifactId);
      }
    };
    artifactChannel.addEventListener("message", handler);

    return () => {
      artifactChannel?.removeEventListener("message", handler);
    };
  }
  return () => {};
};

// Plot channel
export const postPlotUpdateMessage = (filePath: string, ddaResults: any) => {
  if (plotChannel) {
    plotChannel.postMessage({
      type: "DDA_RESULTS_UPDATED",
      filePath,
      ddaResults,
    });
    logger.info(`Posted DDA_RESULTS_UPDATED message for filePath: ${filePath}`);
  }
};

export const addPlotUpdateListener = (
  callback: (filePath: string, ddaResults: any) => void
) => {
  if (plotChannel) {
    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === "DDA_RESULTS_UPDATED") {
        logger.info(
          `Received DDA_RESULTS_UPDATED message for filePath: ${event.data.filePath}`
        );
        callback(event.data.filePath, event.data.ddaResults);
      }
    };
    plotChannel.addEventListener("message", handler);

    return () => {
      plotChannel?.removeEventListener("message", handler);
    };
  }
  return () => {};
};

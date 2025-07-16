import { useEffect } from "react";
import { useAppDispatch } from "../store";
import { initializePlot, loadChunk } from "../store/slices/plotSlice";
import { useUnifiedSessionData } from "./useUnifiedSession";
import logger from "../lib/utils/logger";

interface DashboardRestorationEvent {
  filePath: string;
  selectedChannels: string[];
}

export function useDashboardRestoration() {
  const dispatch = useAppDispatch();
  const { data: session } = useUnifiedSessionData();

  useEffect(() => {
    const handleDashboardRestoration = async (event: Event) => {
      const customEvent = event as CustomEvent<DashboardRestorationEvent>;
      const { filePath, selectedChannels } = customEvent.detail;

      if (!filePath || !session?.accessToken) {
        logger.warn("Dashboard restoration: missing file path or session");
        return;
      }

      try {
        logger.info(
          `Dashboard restoration: reloading plot data for ${filePath}`
        );

        // Initialize the plot first
        const initResult = await dispatch(
          initializePlot({
            filePath,
            token: session.accessToken,
          })
        ).unwrap();

        if (initResult) {
          // Load the first chunk to restore the plot data
          const loadResult = await dispatch(
            loadChunk({
              filePath,
              chunkNumber: 1,
              chunkSizeSeconds: 10,
              token: session.accessToken,
            })
          ).unwrap();

          if (loadResult) {
            logger.info(
              `Dashboard restoration: successfully reloaded plot data for ${filePath}`
            );
          } else {
            logger.warn(
              `Dashboard restoration: failed to load chunk data for ${filePath}`
            );
          }
        } else {
          logger.warn(
            `Dashboard restoration: failed to initialize plot for ${filePath}`
          );
        }
      } catch (error) {
        logger.error(
          `Dashboard restoration: error reloading plot data for ${filePath}:`,
          error
        );
      }
    };

    // Listen for the custom event
    window.addEventListener(
      "dashboard-file-restored",
      handleDashboardRestoration
    );

    return () => {
      window.removeEventListener(
        "dashboard-file-restored",
        handleDashboardRestoration
      );
    };
  }, [dispatch, session?.accessToken]);
}

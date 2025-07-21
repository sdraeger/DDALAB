import { useEffect } from "react";
import { useAppDispatch } from "../store";
import { initializePlot, loadChunk } from "../store/slices/plotSlice";
import { useUnifiedSessionData } from "./useUnifiedSession";
import { useLoadingManager } from "./useLoadingManager";
import { useToast } from "../components/ui/use-toast";
import logger from "../lib/utils/logger";

interface DashboardRestorationEvent {
  filePath: string;
  selectedChannels: string[];
}

export function useDashboardRestoration() {
  const dispatch = useAppDispatch();
  const { data: session } = useUnifiedSessionData();
  const loadingManager = useLoadingManager();
  const { toast } = useToast();

  useEffect(() => {
    const handleDashboardRestoration = async (event: Event) => {
      const customEvent = event as CustomEvent<DashboardRestorationEvent>;
      const { filePath, selectedChannels } = customEvent.detail;

      logger.info("Dashboard restoration event received:", {
        filePath,
        selectedChannels,
        hasSession: !!session,
        hasToken: !!session?.accessToken,
      });

      if (!filePath || !session?.accessToken) {
        logger.warn("Dashboard restoration: missing file path or session");
        return;
      }

      const loadingId = `dashboard-restoration-${filePath}`;
      const fileName = filePath.split("/").pop() || "file";

      try {
        // Start loading with timeout protection
        loadingManager.startFileLoad(
          loadingId,
          `Restoring ${fileName}...`,
          true // Show global overlay
        );

        logger.info(
          `Dashboard restoration: reloading plot data for ${filePath}`
        );

        // Set a timeout to prevent indefinite loading
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Restoration timeout: ${fileName} took too long to load`
              )
            );
          }, 30000); // 30 second timeout
        });

        // Initialize the plot first
        const initPromise = dispatch(
          initializePlot({
            filePath,
            token: session.accessToken,
          })
        ).unwrap();

        const initResult = await Promise.race([initPromise, timeoutPromise]);

        if (initResult) {
          // Update loading message for data phase
          loadingManager.updateProgress(
            loadingId,
            50,
            `Loading data for ${fileName}...`
          );

          // Load the first chunk to restore the plot data
          const loadPromise = dispatch(
            loadChunk({
              filePath,
              chunkNumber: 1,
              chunkSizeSeconds: 10,
              token: session.accessToken,
            })
          ).unwrap();

          const loadResult = await Promise.race([loadPromise, timeoutPromise]);

          if (loadResult) {
            logger.info(
              `Dashboard restoration: successfully reloaded plot data for ${filePath}`
            );

            // Complete loading successfully
            loadingManager.updateProgress(
              loadingId,
              100,
              `Successfully restored ${fileName}`
            );
            setTimeout(() => {
              loadingManager.stop(loadingId);
            }, 800);

            toast({
              title: "Dashboard Restored",
              description: `Successfully restored ${fileName} to your dashboard.`,
              duration: 3000,
            });
          } else {
            logger.warn(
              `Dashboard restoration: failed to load chunk data for ${filePath}`
            );
            throw new Error(`Failed to load data for ${fileName}`);
          }
        } else {
          logger.warn(
            `Dashboard restoration: failed to initialize plot for ${filePath}`
          );
          throw new Error(`Failed to initialize ${fileName}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : `Failed to restore ${fileName}`;

        logger.error(
          `Dashboard restoration: error reloading plot data for ${filePath}:`,
          error
        );

        // Always stop loading on error
        loadingManager.stop(loadingId);

        // Show user-friendly error message
        toast({
          title: "Restoration Failed",
          description: errorMessage,
          variant: "destructive",
          duration: 5000,
        });
      }
    };

    // Listen for the custom event
    window.addEventListener(
      "dashboard-file-restored",
      handleDashboardRestoration
    );

    logger.info(
      "Dashboard restoration hook initialized - listening for 'dashboard-file-restored' events"
    );

    return () => {
      window.removeEventListener(
        "dashboard-file-restored",
        handleDashboardRestoration
      );
    };
  }, [dispatch, session?.accessToken, loadingManager, toast]);
}

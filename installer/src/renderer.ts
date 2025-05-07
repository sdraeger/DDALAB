import type { ElectronAPI } from "../preload";

const siteContent = document.getElementById("site-content");
const backButton = document.getElementById("back-button") as HTMLButtonElement;
const nextButton = document.getElementById("next-button") as HTMLButtonElement;
const finishButton = document.getElementById(
  "finish-button"
) as HTMLButtonElement;

if (!siteContent || !backButton || !nextButton || !finishButton) {
  throw new Error(
    "Critical UI elements are missing. Installer cannot proceed."
  );
}

interface UserSelections {
  setupType: "" | "automatic" | "manual";
  dataLocation: string;
  envVariables: { [key: string]: string };
}

let currentSite = 0;
const userSelections: UserSelections = {
  setupType: "",
  dataLocation: "",
  envVariables: {},
};

interface Site {
  id: string;
  title: string;
  condition?: () => boolean;
  render: () => void | Promise<void>;
  onNext?: () => boolean | Promise<boolean>; // Modified to allow async onNext
}

// Helper function to format comments into basic HTML
function formatCommentsToHtml(comments: string[]): string {
  if (!comments || comments.length === 0) {
    return "<p><em>No description provided.</em></p>";
  }
  return comments
    .map((comment) => {
      let processedComment = comment;
      // Process **bold** and __italic__ first
      processedComment = processedComment.replace(
        /\*\*(.*?)\*\*/g,
        "<strong>$1</strong>"
      );
      processedComment = processedComment.replace(/__(.*?)__/g, "<em>$1</em>");

      // Process *bold* and _italic_ - ensure there's content inside
      // Match a single *, then at least one char which is not a whitespace or *, then any non-* chars, then a single *
      processedComment = processedComment.replace(
        /\*([^\\s*][^\\*]*?)\*/g,
        "<strong>$1</strong>"
      );
      processedComment = processedComment.replace(
        /_([^\\s_][^_]*?)_/g,
        "<em>$1</em>"
      );

      return processedComment;
    })
    .join("<br>");
}

// Add this helper function at the top level
function formatTimestamp(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
}

const sites: Site[] = [
  {
    id: "welcome",
    title: "Welcome to the Setup Wizard",
    render: () => {
      if (!siteContent) return;
      siteContent.innerHTML = `
                <h2>Welcome!</h2>
                <p>This wizard will help you configure DDALAB.</p>
                <p>Choose your setup preference:</p>
                <div class="radio-group">
                    <label>
                        <input type="radio" name="setupType" value="automatic" ${
                          userSelections.setupType === "automatic"
                            ? "checked"
                            : ""
                        }>
                        Automatic Setup (Recommended)
                    </label>
                    <br>
                    <label>
                        <input type="radio" name="setupType" value="manual" ${
                          userSelections.setupType === "manual" ? "checked" : ""
                        }>
                        Manual Setup (For expert users)
                    </label>
                </div>
                <hr style="margin: 20px 0;">
                <p style="font-size: 0.9em;">
                  This setup wizard is optional.
                  If you are an expert user, you can configure the application by directly editing the <code>.env</code> file
                  (located in the root directory).
                  <br>
                  <strong>However, only do this if you know what you are doing, as incorrect configurations can lead to application errors.</strong>
                </p>
            `;
      const radioButtons = siteContent.querySelectorAll(
        'input[name="setupType"]'
      );
      radioButtons.forEach((radio) => {
        radio.addEventListener("change", (event) => {
          userSelections.setupType = (event.target as HTMLInputElement)
            .value as "automatic" | "manual";
          updateNavigation();
        });
      });
    },
    onNext: () => {
      if (!userSelections.setupType) {
        alert("Please select a setup type.");
        return false;
      }
      return true;
    },
  },
  {
    id: "data-location",
    title: "Data Location (Automatic)",
    condition: () => userSelections.setupType === "automatic",
    render: () => {
      if (!siteContent) return;
      siteContent.innerHTML = `
                <h2>Data Location</h2>
                <p>Please select the directory where the application data will be stored.</p>
                <button id="select-data-dir">Select Directory</button>
                <p>Selected: <strong id="data-path-display">${
                  userSelections.dataLocation || "Not selected"
                }</strong></p>
            `;
      const selectButton = document.getElementById("select-data-dir");
      if (selectButton) {
        selectButton.addEventListener("click", async () => {
          if (window.electronAPI && window.electronAPI.selectDirectory) {
            const path = await window.electronAPI.selectDirectory();
            if (path) {
              userSelections.dataLocation = path;
              const displayElem = document.getElementById("data-path-display");
              if (displayElem) {
                displayElem.textContent = path;
              }
              updateNavigation();
            }
          } else {
            console.error("electronAPI.selectDirectory is not available");
            alert("Error: Directory selection functionality is not available.");
          }
        });
      }
    },
    onNext: async () => {
      // Make onNext async
      if (!userSelections.dataLocation) {
        alert("Please select a data location.");
        return false;
      }
      // For automatic, fetch default envs from .env.example
      if (
        window.electronAPI &&
        window.electronAPI.parseEnvExampleWithComments
      ) {
        // Use new API
        try {
          const parsedEntries =
            await window.electronAPI.parseEnvExampleWithComments();
          if (parsedEntries) {
            parsedEntries.forEach((entry) => {
              userSelections.envVariables[entry.key] = entry.value;
            });
          } else {
            // Fallback if content is not available
            console.warn(
              "parseEnvExampleWithComments returned undefined for auto setup."
            );
            userSelections.envVariables = {
              DEFAULT_VAR1: "default_value1_auto",
              DEFAULT_VAR2: "default_value2_auto",
            };
          }
        } catch (err: any) {
          console.error(
            "Error fetching/parsing .env.example for auto setup:",
            err
          );
          // Fallback in case of error
          userSelections.envVariables = {
            DEFAULT_VAR1: "default_value1_auto_error",
            DEFAULT_VAR2: "default_value2_auto_error",
          };
        }
      } else {
        // Fallback if API is not available
        console.error(
          "parseEnvExampleWithComments API is not available for auto setup."
        );
        userSelections.envVariables = {
          DEFAULT_VAR1: "default_value1_auto_no_api",
          DEFAULT_VAR2: "default_value2_auto_no_api",
        };
      }
      return true;
    },
  },
  {
    id: "manual-config",
    title: "Manual Configuration",
    condition: () => userSelections.setupType === "manual",
    render: async () => {
      if (!siteContent) return;
      siteContent.innerHTML = `<h2>Manual Configuration</h2><p>Please provide values for the following variables. Descriptions are provided based on comments from the .env.example file.</p><div id="manual-form-fields">Loading...</div>`;

      if (
        window.electronAPI &&
        window.electronAPI.parseEnvExampleWithComments
      ) {
        try {
          const parsedEntries =
            await window.electronAPI.parseEnvExampleWithComments();
          const formFieldsContainer =
            document.getElementById("manual-form-fields");

          if (!formFieldsContainer) {
            console.error("manual-form-fields element not found!");
            if (siteContent)
              siteContent.innerHTML =
                "<p>Error: UI element for form fields is missing.</p>";
            return;
          }
          formFieldsContainer.innerHTML = ""; // Clear loading

          if (parsedEntries && parsedEntries.length > 0) {
            parsedEntries.forEach((entry) => {
              const { key, value: defaultValue, comments } = entry;
              const inputId = `env-${key}`;

              // Initialize from existing selections or use default
              userSelections.envVariables[key] =
                userSelections.envVariables[key] !== undefined
                  ? userSelections.envVariables[key]
                  : defaultValue;

              const fieldHtml = `
                <div class="form-group env-variable-item">
                  <label for="${inputId}">${key}:</label>
                  <input type="text" id="${inputId}" name="${key}" value="${
                userSelections.envVariables[key]
              }">
                  <div class="variable-description">
                    ${formatCommentsToHtml(comments)}
                  </div>
                </div>
              `;
              formFieldsContainer.innerHTML += fieldHtml;
            });

            // Add event listeners to update userSelections on input change
            formFieldsContainer
              .querySelectorAll("input[type='text']")
              .forEach((input) => {
                input.addEventListener("input", (event) => {
                  const target = event.target as HTMLInputElement;
                  userSelections.envVariables[target.name] = target.value;
                });
              });
          } else if (parsedEntries && parsedEntries.length === 0) {
            formFieldsContainer.innerHTML =
              "<p>No variables found in the .env file to configure.</p>";
          } else {
            formFieldsContainer.innerHTML =
              "<p>Could not load variables from the .env file. Please check the console for errors.</p>";
          }
        } catch (error) {
          console.error("Error rendering manual configuration:", error);
          if (siteContent)
            siteContent.innerHTML =
              "<p>Error loading manual configuration. Check console.</p>";
        }
      } else {
        if (siteContent)
          siteContent.innerHTML =
            "<p>Configuration API is not available. Cannot load variables.</p>";
        console.error(
          "electronAPI.parseEnvExampleWithComments is not available"
        );
      }
    },
    onNext: () => {
      // Basic validation: ensure no essential variable is left empty if needed
      // For now, just return true
      console.log("Manual config selections:", userSelections.envVariables);
      return true;
    },
  },
  {
    id: "summary",
    title: "Summary & Finish",
    render: () => {
      if (!siteContent) return;
      siteContent.innerHTML = `
                <h2>Setup Summary</h2>
                <p><strong>Setup Type:</strong> ${userSelections.setupType}</p>
                <p><strong>Data Location:</strong> ${
                  userSelections.dataLocation || "N/A"
                }</p>
                <h3>Environment Variables:</h3>
                <ul>
                    ${Object.entries(userSelections.envVariables)
                      .map(
                        ([key, value]) =>
                          `<li><strong>${key}:</strong> ${value}</li>`
                      )
                      .join("")}
                </ul>
                <p>Click Finish to save your configuration and proceed to the control panel.</p>
            `;
    },
    onNext: async () => {
      if (window.electronAPI && window.electronAPI.saveEnvConfig) {
        try {
          const envContent = Object.entries(userSelections.envVariables)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");
          window.electronAPI.saveEnvConfig(envContent);
          return true;
        } catch (error) {
          console.error("Error saving .env config:", error);
          alert("Failed to save configuration. Please check the console.");
          return false;
        }
      } else {
        alert("Error: Save functionality is not available.");
        return false;
      }
    },
  },
  {
    id: "control-panel",
    title: "Application Control Panel",
    render: async () => {
      if (!siteContent) return;

      // Get initial Docker status
      let isRunning = false;
      if (window.electronAPI?.getDockerStatus) {
        isRunning = await window.electronAPI.getDockerStatus();
      }

      siteContent.innerHTML = `
        <div class="loading-overlay">
          <div class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">Processing...</div>
          </div>
        </div>
        <h2 class="mb-4">Application Control Panel</h2>
        <div class="control-panel">
          <!-- Status Card -->
          <div class="card mb-4 h-100">
            <div class="card-body">
              <h5 class="card-title fw-bold mb-3">Application Status</h5>
              <p class="card-text mb-4">Status: <strong id="app-status" class="ms-2 ${
                isRunning ? "text-success" : "text-danger"
              }">${isRunning ? "Running" : "Stopped"}</strong></p>
              ${
                isRunning
                  ? `<a href="https://localhost" target="_blank" id="app-link" class="btn btn-outline-primary">Open Application</a>`
                  : ""
              }
            </div>
          </div>

          <!-- Controls Card -->
          <div class="card mb-4 h-100">
            <div class="card-body">
              <h5 class="card-title fw-bold mb-3">Controls</h5>
              <div class="d-flex gap-3">
                <button id="start-btn" class="btn ${
                  isRunning ? "btn-success disabled" : "btn-success"
                }">
                  <span class="button-content">
                    <span class="button-spinner"></span>
                    <span class="button-text">Start Application</span>
                  </span>
                </button>
                <button id="stop-btn" class="btn ${
                  !isRunning ? "btn-danger disabled" : "btn-danger"
                }">
                  <span class="button-content">
                    <span class="button-spinner"></span>
                    <span class="button-text">Stop Application</span>
                  </span>
                </button>
              </div>
            </div>
          </div>

          <!-- Logs Card -->
          <div class="card h-100">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-center mb-3">
                <h5 class="card-title fw-bold mb-0">Application Logs</h5>
                <div class="form-check form-switch">
                  <input class="form-check-input" type="checkbox" id="auto-scroll" checked>
                  <label class="form-check-label" for="auto-scroll">Auto-scroll</label>
                </div>
              </div>
              <div id="log-container" class="log-container border rounded bg-dark">
                <div id="log-content"></div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Add event listeners
      const startBtn = document.getElementById(
        "start-btn"
      ) as HTMLButtonElement;
      const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
      const statusEl = document.getElementById("app-status");
      const logContent = document.getElementById("log-content");
      const loadingOverlay = document.querySelector(
        ".loading-overlay"
      ) as HTMLElement;
      const controlPanel = document.querySelector(
        ".control-panel"
      ) as HTMLElement;

      function showLoading(action: "start" | "stop") {
        if (loadingOverlay) {
          const loadingText = loadingOverlay.querySelector(
            ".loading-text"
          ) as HTMLElement;
          loadingText.textContent =
            action === "start"
              ? "Starting Application..."
              : "Stopping Application...";
          loadingOverlay.classList.add("visible");
        }
        if (controlPanel) {
          controlPanel.classList.add("loading-active");
        }

        // Add loading state to the specific button
        const button = action === "start" ? startBtn : stopBtn;
        if (button) {
          button.classList.add("loading");
        }
      }

      function hideLoading() {
        if (loadingOverlay) {
          loadingOverlay.classList.remove("visible");
        }
        if (controlPanel) {
          controlPanel.classList.remove("loading-active");
        }
        // Remove loading state from all buttons
        [startBtn, stopBtn].forEach((btn) => {
          if (btn) {
            btn.classList.remove("loading");
          }
        });
      }

      // Setup log listener
      if (window.electronAPI?.onDockerLogs && logContent) {
        const autoScrollCheckbox = document.getElementById(
          "auto-scroll"
        ) as HTMLInputElement;

        // Function to handle auto-scrolling
        const scrollToBottom = () => {
          requestAnimationFrame(() => {
            logContent.scrollTop = logContent.scrollHeight;
          });
        };

        // Initialize logs if running
        if (isRunning && window.electronAPI?.getDockerLogs) {
          const initialLogs = await window.electronAPI.getDockerLogs();
          if (initialLogs) {
            logContent.innerHTML = `<div class="log-entry"><span class="timestamp">${formatTimestamp()}</span> ${initialLogs}</div>`;
            scrollToBottom();
          }
        }

        window.electronAPI.onDockerLogs((log) => {
          const logEntry = document.createElement("div");
          logEntry.className = `log-entry ${log.type}`;
          logEntry.innerHTML = `<span class="timestamp">${formatTimestamp()}</span> ${
            log.data
          }`;
          logContent.appendChild(logEntry);

          // Only auto-scroll if the checkbox is checked and user hasn't scrolled up
          if (autoScrollCheckbox && autoScrollCheckbox.checked) {
            const isScrolledToBottom =
              logContent.scrollHeight - logContent.clientHeight <=
              logContent.scrollTop + 50;
            if (isScrolledToBottom) {
              scrollToBottom();
            }
          }
        });

        // Add scroll event listener to handle manual scrolling
        let userHasScrolled = false;
        logContent.addEventListener("scroll", () => {
          const isScrolledToBottom =
            logContent.scrollHeight - logContent.clientHeight <=
            logContent.scrollTop + 50;
          userHasScrolled = !isScrolledToBottom;
        });

        // Add change event listener for the auto-scroll checkbox
        autoScrollCheckbox.addEventListener("change", () => {
          if (autoScrollCheckbox.checked) {
            scrollToBottom();
          }
        });
      }

      async function updateUI(running: boolean) {
        hideLoading();
        if (statusEl) statusEl.textContent = running ? "Running" : "Stopped";
        if (startBtn) startBtn.disabled = running;
        if (stopBtn) stopBtn.disabled = !running;

        // Update localhost link
        const linkContainer = document.querySelector(".status-section");
        if (linkContainer) {
          const existingLink = document.getElementById("app-link");
          if (running && !existingLink) {
            const link = document.createElement("p");
            link.innerHTML =
              '<a href="https://localhost" target="_blank" id="app-link">Open Application</a>';
            linkContainer.appendChild(link);
          } else if (!running && existingLink) {
            existingLink.parentElement?.remove();
          }
        }

        // Clear logs when stopping
        if (!running && logContent) {
          logContent.innerHTML = "";
        }
      }

      if (startBtn) {
        startBtn.addEventListener("click", async () => {
          if (window.electronAPI?.startDockerCompose) {
            showLoading("start");
            const success = await window.electronAPI.startDockerCompose();
            if (success) {
              updateUI(true);
            } else {
              hideLoading();
              alert(
                "Failed to start the application. Check the console for details."
              );
              startBtn.disabled = false;
            }
          }
        });
      }

      if (stopBtn) {
        stopBtn.addEventListener("click", async () => {
          if (window.electronAPI?.stopDockerCompose) {
            showLoading("stop");
            const success = await window.electronAPI.stopDockerCompose();
            if (success) {
              updateUI(false);
              if (window.electronAPI.clearDockerLogsListener) {
                window.electronAPI.clearDockerLogsListener();
              }
            } else {
              hideLoading();
              alert(
                "Failed to stop the application. Check the console for details."
              );
              stopBtn.disabled = false;
            }
          }
        });
      }
    },
    onNext: () => true,
  },
];

function getCurrentSiteDefinition(): Site | null {
  const activeSites = sites.filter(
    (site) => !site.condition || site.condition()
  );
  if (currentSite >= 0 && currentSite < activeSites.length) {
    return activeSites[currentSite];
  }
  return null;
}

function getTotalActiveSites(): number {
  return sites.filter((site) => !site.condition || site.condition()).length;
}

async function renderCurrentSite() {
  const siteDef = getCurrentSiteDefinition();
  if (siteDef && siteContent) {
    document.title = siteDef.title; // Update window title
    await siteDef.render(); // Await render if it's async
    updateNavigation();
  }
}

function updateNavigation() {
  const totalActiveSites = getTotalActiveSites();
  const siteDef = getCurrentSiteDefinition();

  if (!siteDef) {
    // Should not happen if logic is correct
    backButton.style.display = "none";
    nextButton.style.display = "none";
    finishButton.style.display = "none";
    return;
  }

  // Back button visibility
  backButton.style.display = currentSite > 0 ? "inline-block" : "none";

  // Next/Finish button visibility and text
  if (currentSite >= totalActiveSites - 1) {
    // Last active site
    nextButton.style.display = "none";
    finishButton.style.display = "inline-block";
  } else {
    nextButton.style.display = "inline-block";
    finishButton.style.display = "none";
  }

  // Disable next/finish if current site has specific conditions not met (e.g. setupType not chosen)
  if (siteDef.id === "welcome" && !userSelections.setupType) {
    nextButton.disabled = true;
  } else if (siteDef.id === "data-location" && !userSelections.dataLocation) {
    nextButton.disabled = true;
  } else {
    nextButton.disabled = false;
  }
  // Finish button is generally enabled on the last page, specific onNext logic handles validation
}

// Event Listeners
backButton.addEventListener("click", () => {
  if (currentSite > 0) {
    currentSite--;
    renderCurrentSite();
  }
});

nextButton.addEventListener("click", async () => {
  const siteDef = getCurrentSiteDefinition();
  let canProceed = true;
  if (siteDef && siteDef.onNext) {
    canProceed = await siteDef.onNext(); // Await if onNext is async
  }
  if (canProceed && currentSite < getTotalActiveSites() - 1) {
    currentSite++;
    renderCurrentSite();
  }
});

finishButton.addEventListener("click", async () => {
  const siteDef = getCurrentSiteDefinition();
  if (siteDef && siteDef.onNext) {
    const canFinish = await siteDef.onNext(); // Await if onNext is async
    if (canFinish) {
      // Action handled within onNext (e.g., saving config and quitting)
      console.log("Setup finished.");
    }
  }
});

// Initial render
renderCurrentSite();

// Expose types for ElectronAPI if not done by preload.ts (for renderer's own type checking)
// This is usually handled by including preload.ts's d.ts or by direct import.
declare global {
  interface Window {
    electronAPI?: ElectronAPI; // Use the imported ElectronAPI type
  }
}

export {};

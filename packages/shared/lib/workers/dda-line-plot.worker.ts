// Inlined worker for transforming DDA Q matrix for line plot
// This avoids needing a separate worker file and build configuration

self.onmessage = (event) => {
  const { Q, plotMode, selectedRow, maxDisplayRows } = event.data;

  // For debugging: log received data structure
  if (Q && Array.isArray(Q) && Q.length > 0) {
    const firstRowSample = Q[0]
      .slice(0, 5)
      .map((v: any) => (Array.isArray(v) ? v[0] : v));
    console.log(
      `[DDA Worker] Received Q matrix: ${Q.length}x${Q[0].length}. First row sample:`,
      firstRowSample
    );
    const nonNullCount = Q.flat().filter(
      (v: any) => (Array.isArray(v) ? v[0] : v) !== null
    ).length;
    if (nonNullCount === 0) {
      console.warn("[DDA Worker] Q matrix contains only null or empty values.");
    }
  }

  if (!Q || !Array.isArray(Q) || Q.length === 0) {
    self.postMessage({
      chartData: { datasets: [] },
      error: "Invalid Q matrix",
    });
    return;
  }

  try {
    const numRows = Q.length;
    const numCols = Q[0]?.length || 0;

    if (numCols === 0) {
      self.postMessage({
        chartData: { datasets: [] },
        error: "Empty Q matrix",
      });
      return;
    }

    const datasets = [];
    const colors = [
      "#3b82f6",
      "#ef4444",
      "#10b981",
      "#f59e0b",
      "#8b5cf6",
      "#06b6d4",
      "#84cc16",
      "#f97316",
      "#ec4899",
      "#6366f1",
    ];

    const transformData = (rowData: any[]): (number | null)[] => {
      if (!Array.isArray(rowData)) return [];
      const points = [];
      for (let i = 0; i < rowData.length; i++) {
        let value = rowData[i];

        // Handle cases where the value might be wrapped in an array e.g. [0.123]
        const unwrappedValue = Array.isArray(value) ? value[0] : value;

        if (unwrappedValue === undefined) continue;
        if (unwrappedValue === null) {
          points.push(null);
          continue;
        }

        let numericValue = unwrappedValue;
        if (typeof numericValue === "string") {
          numericValue = parseFloat(numericValue);
        }

        if (typeof numericValue === "number" && isFinite(numericValue)) {
          points.push(numericValue);
        } else {
          points.push(null);
        }
      }
      return points;
    };

    const labels = Array.from({ length: numCols }, (_, i) => i);

    if (plotMode === "average") {
      const averageData = new Array(numCols).fill(null);
      for (let col = 0; col < numCols; col++) {
        let sum = 0;
        let count = 0;
        for (let row = 0; row < numRows; row++) {
          let val = Q[row]?.[col];
          if (val === null || val === undefined) continue;
          if (typeof val === "string") {
            val = parseFloat(val);
          }
          if (typeof val === "number" && isFinite(val)) {
            sum += val;
            count++;
          }
        }
        if (count > 0) {
          averageData[col] = sum / count;
        }
      }
      datasets.push({
        label: "Average",
        data: transformData(averageData),
        borderColor: "#3b82f6",
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.1,
      });
    } else if (plotMode === "individual") {
      if (selectedRow < numRows) {
        datasets.push({
          label: `Channel ${selectedRow + 1}`,
          data: transformData(Q[selectedRow]),
          borderColor: "#3b82f6",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.1,
        });
      }
    } else if (plotMode === "all") {
      const rowsToShow = Math.min(maxDisplayRows, numRows);
      for (let i = 0; i < rowsToShow; i++) {
        datasets.push({
          label: `Channel ${i + 1}`,
          data: transformData(Q[i]),
          borderColor: colors[i % colors.length],
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.1,
        });
      }
    }

    console.log("[DDA Worker] datasets", datasets);

    self.postMessage({
      chartData: {
        datasets,
        labels,
      },
      error: null,
    });
  } catch (e) {
    self.postMessage({ chartData: null, error: (e as Error).message });
  }
};

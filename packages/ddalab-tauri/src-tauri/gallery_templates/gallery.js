/* DDALAB Gallery - Static Site JavaScript */
(function () {
  "use strict";

  // ========== Viridis colormap (ported from colorSchemes.ts) ==========
  var VIRIDIS = [
    [68, 1, 84],
    [72, 40, 120],
    [62, 73, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [109, 205, 89],
    [180, 222, 44],
    [253, 231, 37],
  ];

  function viridis(t) {
    t = Math.max(0, Math.min(1, t));
    var idx = Math.floor(t * (VIRIDIS.length - 1));
    var frac = t * (VIRIDIS.length - 1) - idx;
    var c1 = VIRIDIS[idx] || VIRIDIS[0];
    var c2 = VIRIDIS[idx + 1] || VIRIDIS[VIRIDIS.length - 1];
    return [
      Math.round(c1[0] + frac * (c2[0] - c1[0])),
      Math.round(c1[1] + frac * (c2[1] - c1[1])),
      Math.round(c1[2] + frac * (c2[2] - c1[2])),
    ];
  }

  // ========== Canvas Heatmap Renderer ==========
  function renderHeatmap(canvasId, data, options) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !data || !data.ddaMatrix) return;

    var channels = Object.keys(data.ddaMatrix).sort();
    if (channels.length === 0) return;

    var nCols = data.ddaMatrix[channels[0]].length;
    var nRows = channels.length;
    var colorRange = data.colorRange || [0, 1];
    var low = colorRange[0];
    var high = colorRange[1];
    var range = high - low;
    if (range === 0) range = 1;

    // Set canvas native size
    var cellW = (options && options.cellWidth) || 1;
    var cellH = (options && options.cellHeight) || 4;
    canvas.width = nCols * cellW;
    canvas.height = nRows * cellH;

    var ctx = canvas.getContext("2d");
    var imgData = ctx.createImageData(canvas.width, canvas.height);
    var pixels = imgData.data;

    for (var r = 0; r < nRows; r++) {
      var row = data.ddaMatrix[channels[r]];
      for (var c = 0; c < nCols; c++) {
        var val = row[c];
        var t = (val - low) / range;
        var rgb = viridis(t);
        for (var dy = 0; dy < cellH; dy++) {
          for (var dx = 0; dx < cellW; dx++) {
            var pixelIdx =
              ((r * cellH + dy) * canvas.width + c * cellW + dx) * 4;
            pixels[pixelIdx] = rgb[0];
            pixels[pixelIdx + 1] = rgb[1];
            pixels[pixelIdx + 2] = rgb[2];
            pixels[pixelIdx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Tooltip
    if (options && options.tooltip) {
      var tooltip = document.getElementById(options.tooltip);
      if (tooltip) {
        canvas.addEventListener("mousemove", function (e) {
          var rect = canvas.getBoundingClientRect();
          var scaleX = canvas.width / rect.width;
          var scaleY = canvas.height / rect.height;
          var x = Math.floor(((e.clientX - rect.left) * scaleX) / cellW);
          var y = Math.floor(((e.clientY - rect.top) * scaleY) / cellH);
          if (x >= 0 && x < nCols && y >= 0 && y < nRows) {
            var ch = channels[y];
            var val = data.ddaMatrix[ch][x];
            var winIdx =
              data.windowIndices && data.windowIndices[x] !== undefined
                ? data.windowIndices[x]
                : x;
            tooltip.textContent =
              ch + " | window " + winIdx.toFixed(0) + " | " + val.toFixed(4);
            tooltip.style.display = "block";
            tooltip.style.left = e.clientX + 12 + "px";
            tooltip.style.top = e.clientY - 24 + "px";
          }
        });
        canvas.addEventListener("mouseleave", function () {
          tooltip.style.display = "none";
        });
      }
    }
  }

  // ========== Color Legend ==========
  function renderColorLegend(barId, data) {
    var bar = document.getElementById(barId);
    if (!bar || !data) return;
    var colorRange = data.colorRange || [0, 1];

    var canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 1;
    var ctx = canvas.getContext("2d");
    var imgData = ctx.createImageData(256, 1);
    for (var i = 0; i < 256; i++) {
      var rgb = viridis(i / 255);
      imgData.data[i * 4] = rgb[0];
      imgData.data[i * 4 + 1] = rgb[1];
      imgData.data[i * 4 + 2] = rgb[2];
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    bar.style.backgroundImage = "url(" + canvas.toDataURL() + ")";
    bar.style.backgroundSize = "100% 100%";

    // Update labels
    var lowEl =
      bar.parentElement && bar.parentElement.querySelector(".legend-low");
    var highEl =
      bar.parentElement && bar.parentElement.querySelector(".legend-high");
    if (lowEl) lowEl.textContent = colorRange[0].toFixed(2);
    if (highEl) highEl.textContent = colorRange[1].toFixed(2);
  }

  // ========== Thumbnail Renderer ==========
  function renderThumbnail(canvas, thumbnail, colorRange) {
    if (!canvas || !thumbnail || thumbnail.length === 0) return;
    var nRows = thumbnail.length;
    var nCols = thumbnail[0].length;
    var low = colorRange ? colorRange[0] : 0;
    var high = colorRange ? colorRange[1] : 1;
    var range = high - low;
    if (range === 0) range = 1;

    canvas.width = nCols;
    canvas.height = nRows;
    var ctx = canvas.getContext("2d");
    var imgData = ctx.createImageData(nCols, nRows);
    var pixels = imgData.data;

    for (var r = 0; r < nRows; r++) {
      for (var c = 0; c < nCols; c++) {
        var t = (thumbnail[r][c] - low) / range;
        var rgb = viridis(t);
        var idx = (r * nCols + c) * 4;
        pixels[idx] = rgb[0];
        pixels[idx + 1] = rgb[1];
        pixels[idx + 2] = rgb[2];
        pixels[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ========== Summary Tables ==========
  function renderTable(containerId, data, title) {
    var container = document.getElementById(containerId);
    if (!container || !data) return;

    var keys = Object.keys(data).sort();
    if (keys.length === 0) {
      container.innerHTML =
        '<p style="color:var(--text-muted);font-size:0.813rem">No data</p>';
      return;
    }

    var html =
      '<table class="data-table"><thead><tr><th>Channel</th><th>' +
      title +
      "</th></tr></thead><tbody>";
    for (var i = 0; i < keys.length; i++) {
      var val =
        typeof data[keys[i]] === "number"
          ? data[keys[i]].toFixed(4)
          : data[keys[i]];
      html +=
        "<tr><td>" +
        escapeHtml(keys[i]) +
        "</td><td>" +
        escapeHtml(String(val)) +
        "</td></tr>";
    }
    html += "</tbody></table>";
    container.innerHTML = html;
  }

  // ========== Parameters ==========
  function renderParameters(containerId, params) {
    var container = document.getElementById(containerId);
    if (!container || !params) return;

    var keys = Object.keys(params).sort();
    var html = '<div class="params-grid">';
    for (var i = 0; i < keys.length; i++) {
      var val = params[keys[i]];
      if (typeof val === "object" && val !== null) {
        val = JSON.stringify(val);
        if (val.length > 60) val = val.substring(0, 57) + "...";
      }
      html +=
        '<div class="params-item"><span class="key">' +
        escapeHtml(keys[i]) +
        '</span><span class="value">' +
        escapeHtml(String(val)) +
        "</span></div>";
    }
    html += "</div>";
    container.innerHTML = html;
  }

  // ========== Index Search/Sort ==========
  function initGalleryIndex() {
    var searchInput = document.getElementById("gallery-search");
    var sortSelect = document.getElementById("gallery-sort");
    var grid = document.getElementById("gallery-grid");
    var countEl = document.getElementById("gallery-count");
    if (!grid) return;

    var cards = Array.from(grid.querySelectorAll(".gallery-card"));

    function filterAndSort() {
      var query = (searchInput ? searchInput.value : "").toLowerCase();
      var sortBy = sortSelect ? sortSelect.value : "date-desc";

      cards.forEach(function (card) {
        var title = (card.dataset.title || "").toLowerCase();
        var variant = (card.dataset.variant || "").toLowerCase();
        var channels = (card.dataset.channels || "").toLowerCase();
        var tags = (card.dataset.tags || "").toLowerCase();
        var match =
          !query ||
          title.indexOf(query) >= 0 ||
          variant.indexOf(query) >= 0 ||
          channels.indexOf(query) >= 0 ||
          tags.indexOf(query) >= 0;
        card.style.display = match ? "" : "none";
      });

      var visible = cards.filter(function (c) {
        return c.style.display !== "none";
      });

      visible.sort(function (a, b) {
        switch (sortBy) {
          case "date-asc":
            return (a.dataset.date || "").localeCompare(b.dataset.date || "");
          case "date-desc":
            return (b.dataset.date || "").localeCompare(a.dataset.date || "");
          case "name-asc":
            return (a.dataset.title || "").localeCompare(b.dataset.title || "");
          case "name-desc":
            return (b.dataset.title || "").localeCompare(a.dataset.title || "");
          default:
            return 0;
        }
      });

      // Reorder DOM
      visible.forEach(function (card) {
        grid.appendChild(card);
      });
      // Append hidden ones at the end
      cards
        .filter(function (c) {
          return c.style.display === "none";
        })
        .forEach(function (card) {
          grid.appendChild(card);
        });

      if (countEl) {
        countEl.textContent =
          visible.length + " of " + cards.length + " results";
      }
    }

    if (searchInput) searchInput.addEventListener("input", filterAndSort);
    if (sortSelect) sortSelect.addEventListener("change", filterAndSort);
    filterAndSort();
  }

  // ========== Thumbnail Initialization ==========
  function initThumbnails() {
    var thumbCanvases = document.querySelectorAll("canvas[data-thumbnail]");
    thumbCanvases.forEach(function (canvas) {
      try {
        var thumbData = JSON.parse(canvas.dataset.thumbnail);
        var colorRange = canvas.dataset.colorrange
          ? JSON.parse(canvas.dataset.colorrange)
          : null;
        renderThumbnail(canvas, thumbData, colorRange);
      } catch (e) {
        // Skip failed thumbnails
      }
    });
  }

  // ========== Utility ==========
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ========== Exports ==========
  window.DDAGallery = {
    renderHeatmap: renderHeatmap,
    renderColorLegend: renderColorLegend,
    renderThumbnail: renderThumbnail,
    renderTable: renderTable,
    renderParameters: renderParameters,
    initGalleryIndex: initGalleryIndex,
    initThumbnails: initThumbnails,
  };
})();

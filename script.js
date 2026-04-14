const { Deck, GeoJsonLayer, ScatterplotLayer, _GlobeView } = deck;

const DATA_URL = "./countries2.geojson";
const PROJECTS_URL = "./projects_site.json";

let mode = "projects";
let hoveredName = null;
let deckgl = null;
let autoRotate = true;
let resumeRotateTimeout = null;

let currentViewState = {
  longitude: -12,
  latitude: -5,
  zoom: 0.92
};

let filterType = "none";
let filterValue = "ALL";
let filterMinAmount = 0;

let geoFeatures = [];
let projectsData = null;
let projectsRows = [];
let amountBreaks = [0, 0, 0, 0, 0];

const FILTER_LABELS = {
  funder: "Tous les bailleurs",
  responsible: "Tous les responsables",
  filiale: "Toutes les filiales",
  sector: "Tous les secteurs",
  expert: "Tous les experts"
};

const OFFICE_LOCATIONS = [
  { name: "Paris", coordinates: [2.3522, 48.8566] },
  { name: "Avignon", coordinates: [4.8057, 43.9493] },
  { name: "Yaoundé", coordinates: [11.5021, 3.8480] },
  { name: "Bogota", coordinates: [-74.0721, 4.7110] }
];

let pulsePhase = 2;

const PALETTE_BLUE = {
  project: [
    { label: "0", color: [185, 205, 225, 130] },
    { label: "1", color: [198, 219, 239, 190] },
    { label: "2–3", color: [158, 202, 225, 200] },
    { label: "4–5", color: [107, 174, 214, 210] },
    { label: "6–10", color: [49, 130, 189, 220] },
    { label: "10+", color: [8, 81, 156, 230] }
  ],
  amount: [
    [185, 205, 225, 110],
    [210, 225, 242, 190],
    [166, 198, 232, 200],
    [119, 168, 218, 210],
    [66, 127, 194, 220],
    [10, 77, 156, 230]
  ]
};

const PALETTE_ORANGE = {
  project: [
    { label: "0", color: [185, 205, 225, 130] },
    { label: "1", color: [253, 224, 178, 190] },
    { label: "2–3", color: [253, 187, 99, 200] },
    { label: "4–5", color: [240, 134, 28, 210] },
    { label: "6–10", color: [210, 82, 8, 220] },
    { label: "10+", color: [155, 45, 2, 230] }
  ],
  amount: [
    [185, 205, 225, 110],
    [253, 224, 178, 190],
    [253, 187, 99, 200],
    [240, 134, 28, 210],
    [210, 82, 8, 220],
    [155, 45, 2, 230]
  ]
};

const PALETTE_GREEN = {
  project: [
    { label: "0", color: [185, 205, 225, 130] },
    { label: "1", color: [198, 239, 210, 190] },
    { label: "2–3", color: [129, 204, 155, 200] },
    { label: "4–5", color: [65, 171, 103, 210] },
    { label: "6–10", color: [30, 130, 65, 220] },
    { label: "10+", color: [10, 85, 35, 230] }
  ],
  amount: [
    [185, 205, 225, 110],
    [198, 239, 210, 190],
    [129, 204, 155, 200],
    [65, 171, 103, 210],
    [30, 130, 65, 220],
    [10, 85, 35, 230]
  ]
};

function getActivePalette() {
  if (filterType === "filiale" && filterValue === "Leader: Urbaconsulting") return PALETTE_ORANGE;
  if (filterType === "filiale" && filterValue === "Leader: Nexsom") return PALETTE_GREEN;
  return PALETTE_BLUE;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function numberFmt(n) {
  return Number(n || 0).toLocaleString("fr-FR");
}

function amountShort(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(".", ",") + " Md EUR";
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(".", ",") + " M EUR";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + " k EUR";
  return numberFmt(v) + " EUR";
}

// ─── Helpers projets ──────────────────────────────────────────────────────────

function getFilterOptions(type) {
  if (!projectsData?.filters_metadata) return [];

  if (type === "funder") return projectsData.filters_metadata.funders_ordered || [];
  if (type === "responsible") return projectsData.filters_metadata.responsibles_ordered || [];
  if (type === "filiale") return projectsData.filters_metadata.filiales_ordered || [];
  if (type === "sector") return projectsData.filters_metadata.sectors_ordered || [];
  if (type === "expert") return projectsData.filters_metadata.experts_ordered || [];

  return [];
}

function getFilteredProjects() {
  return projectsRows.filter(project => {
    if (filterType === "none") return true;

    if (filterType === "amount") {
      return Number(project.amount || 0) >= filterMinAmount;
    }

    if (filterType === "funder") {
      return filterValue === "ALL" || (project.funder || "") === filterValue;
    }

    if (filterType === "responsible") {
      return filterValue === "ALL" || (project.responsible || "") === filterValue;
    }

    if (filterType === "filiale") {
      return filterValue === "ALL" || (project.filiale || "") === filterValue;
    }

    if (filterType === "sector") {
      return filterValue === "ALL" || (project.sectors || []).includes(filterValue);
    }

    if (filterType === "expert") {
      return filterValue === "ALL" || (project.experts || []).includes(filterValue);
    }

    return true;
  });
}

function buildCountryStatsFromProjects(projects) {
  const stats = {};

  projects.forEach(project => {
    const countryKeys = Array.isArray(project.country_keys) ? project.country_keys : [];
    const amount = Number(project.amount || 0);

    if (!countryKeys.length) return;

    const amountPerCountry = amount / countryKeys.length;

    countryKeys.forEach(key => {
      if (!stats[key]) {
        stats[key] = { nb_projets: 0, somme_argent: 0 };
      }

      stats[key].nb_projets += 1;
      stats[key].somme_argent += amountPerCountry;
    });
  });

  return stats;
}

// ─── Dynamic filter UI ────────────────────────────────────────────────────────

function buildFilterValueUI() {
  const wrapper = document.getElementById("filterValueWrapper");
  if (!wrapper) return;

  if (filterType === "none") {
    wrapper.style.display = "none";
    wrapper.innerHTML = "";
    return;
  }

  wrapper.style.display = "block";

  if (filterType === "amount") {
  const maxAmt = 5000000;
  const stepAmt = 50000;

  if (filterMinAmount > maxAmt) filterMinAmount = maxAmt;

  wrapper.innerHTML = `
    <div class="amount-slider-wrapper">
      <div class="amount-slider-label">
        <span>0 EUR</span>
        <span>5 M EUR</span>
      </div>
      <input
        type="range"
        id="amountSlider"
        min="0"
        max="${maxAmt}"
        step="${stepAmt}"
        value="${filterMinAmount}"
      />
      <div class="amount-slider-value" id="amountSliderLabel">
        ≥ ${amountShort(filterMinAmount)}
      </div>
    </div>
  `;

    const slider = document.getElementById("amountSlider");
    if (slider) {
      slider.addEventListener("input", e => {
        filterMinAmount = Number(e.target.value);
        const label = document.getElementById("amountSliderLabel");
        if (label) label.textContent = "≥ " + amountShort(filterMinAmount);
        hoveredName = null;
        applyFilterToMap();
        pauseAutoRotate();
      });
    }

    return;
  }

  const values = getFilterOptions(filterType);

  const select = document.createElement("select");
  select.id = "filterValueSelect";

  const allOpt = document.createElement("option");
  allOpt.value = "ALL";
  allOpt.textContent = FILTER_LABELS[filterType] || "Toutes les valeurs";
  select.appendChild(allOpt);

  values.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.name;
    opt.textContent = `${item.name} (${item.count_rows})`;
    select.appendChild(opt);
  });

  const validValues = values.map(v => v.name);
  select.value = validValues.includes(filterValue) ? filterValue : "ALL";
  filterValue = select.value;

  wrapper.innerHTML = "";
  wrapper.appendChild(select);

  select.addEventListener("change", e => {
    filterValue = e.target.value;
    hoveredName = null;
    applyFilterToMap();
    pauseAutoRotate();
  });
}

// ─── Colors ───────────────────────────────────────────────────────────────────

function computeAmountBreaks(values) {
  const arr = values.filter(v => v > 0).sort((a, b) => a - b);
  if (!arr.length) return [0, 0, 0, 0, 0];
  const q = p => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
  return [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
}

function getProjectColor(v) {
  const palette = getActivePalette().project;
  if (!v || v <= 0) return palette[0].color;
  if (v <= 1) return palette[1].color;
  if (v <= 3) return palette[2].color;
  if (v <= 5) return palette[3].color;
  if (v <= 10) return palette[4].color;
  return palette[5].color;
}

function getAmountColor(v) {
  const palette = getActivePalette().amount;
  if (!v || v <= 0) return palette[0];
  if (v <= amountBreaks[0]) return palette[1];
  if (v <= amountBreaks[1]) return palette[2];
  if (v <= amountBreaks[2]) return palette[3];
  if (v <= amountBreaks[3]) return palette[4];
  return palette[5];
}

function getResponsableColor(v) {
  if (!v || v <= 0) return [185, 205, 225, 110];
  return [49, 130, 189, 220];
}

function getFillColor(props) {
  const isHovered = hoveredName && props.country_name === hoveredName;
  let color;

  if (filterType === "responsible" && filterValue !== "ALL") {
    color = getResponsableColor(Number(props.nb_projets || 0));
  } else if (mode === "projects") {
    color = getProjectColor(Number(props.nb_projets || 0));
  } else {
    color = getAmountColor(Number(props.somme_argent || 0));
  }

  if (isHovered) {
    return [
      Math.min(255, color[0] + 20),
      Math.min(255, color[1] + 20),
      Math.min(255, color[2] + 20),
      245
    ];
  }

  return color;
}

function getElevation(v) {
  return !v || v < 1 ? 0 : 5000;
}

// ─── Earth background layer ───────────────────────────────────────────────────

function makeEarthLayer() {
  return new GeoJsonLayer({
    id: "earth-bg",
    data: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-179.9, -89.9],
            [179.9, -89.9],
            [179.9, 89.9],
            [-179.9, 89.9],
            [-179.9, -89.9]
          ]]
        },
        properties: {}
      }]
    },
    filled: true,
    stroked: false,
    extruded: false,
    pickable: false,
    getFillColor: [20, 20, 50, 255],
    parameters: { depthTest: true, cullFace: "back" }
  });
}

// ─── Countries fill layer ─────────────────────────────────────────────────────

function makeCountriesFillLayer() {
  return new GeoJsonLayer({
    id: "countries-fill",
    data: { type: "FeatureCollection", features: geoFeatures },
    filled: true,
    stroked: false,
    extruded: true,
    wireframe: false,
    pickable: true,
    autoHighlight: false,
    getFillColor: f => getFillColor(f.properties),
    getElevation: f => getElevation(
      mode === "projects"
        ? Number(f.properties.nb_projets || 0)
        : Number(f.properties.somme_argent || 0) > 0 ? 1 : 0
    ),
    elevationScale: 5,
    material: {
      ambient: 0.9,
      diffuse: 0.3,
      shininess: 80,
      specularColor: [180, 200, 220]
    },
    parameters: { depthTest: true, cullFace: "back" },
    updateTriggers: {
      getFillColor: [
        mode,
        hoveredName,
        filterType,
        filterValue,
        filterMinAmount,
        amountBreaks.join("-")
      ],
      getElevation: [mode, filterType, filterValue, filterMinAmount]
    },
    onHover: info => {
      hoveredName = info.object ? info.object.properties.country_name : null;
      updateTooltip(info);
      if (deckgl) deckgl.setProps({ layers: getLayers() });
    }
  });
}

// ─── Countries border layer ───────────────────────────────────────────────────

function makeCountriesBorderLayer() {
  return new GeoJsonLayer({
    id: "countries-border",
    data: { type: "FeatureCollection", features: geoFeatures },
    filled: false,
    stroked: true,
    extruded: false,
    pickable: false,
    getLineColor: f => {
      const isHovered = hoveredName && f.properties.country_name === hoveredName;
      return isHovered ? [255, 255, 255, 255] : [255, 255, 255, 160];
    },
    getLineWidth: f =>
      hoveredName && f.properties.country_name === hoveredName ? 1 : 0,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 0.5,
    parameters: { depthTest: false, cullFace: "back" },
    updateTriggers: {
      getLineColor: [hoveredName],
      getLineWidth: [hoveredName]
    }
  });
}

// ─── Office locations layer ───────────────────────────────────────────────────

function makeOfficesLayer() {
  const pulse = 0.5 + 0.5 * Math.sin(pulsePhase);
  const haloRadius = 80000 + pulse * 60000;
  const haloOpacity = Math.round(40 + pulse * 80);

  return [
    new ScatterplotLayer({
      id: "offices-halo",
      data: OFFICE_LOCATIONS,
      getPosition: d => d.coordinates,
      getRadius: haloRadius,
      getFillColor: [255, 60, 60, haloOpacity],
      stroked: false,
      pickable: false,
      parameters: { depthTest: false, depthMask: false }
    }),
    new ScatterplotLayer({
      id: "offices-dot",
      data: OFFICE_LOCATIONS,
      getPosition: d => d.coordinates,
      getRadius: 35000,
      getFillColor: [220, 50, 50, 255],
      stroked: true,
      getLineColor: [255, 200, 200, 200],
      getLineWidth: 0,
      lineWidthUnits: "pixels",
      pickable: false,
      parameters: { depthTest: false, depthMask: false }
    })
  ];
}

// ─── Layers helper ────────────────────────────────────────────────────────────

function getLayers() {
  return [
    makeEarthLayer(),
    makeCountriesFillLayer(),
    makeCountriesBorderLayer(),
    ...makeOfficesLayer()
  ];
}

// ─── Halo ─────────────────────────────────────────────────────────────────────

function updateHalo() {
  const container = document.getElementById("container");
  const haloCanvas = document.getElementById("halo-canvas");
  if (!haloCanvas || !container) return;

  const w = container.clientWidth;
  const h = container.clientHeight;

  haloCanvas.width = w;
  haloCanvas.height = h;

  const ctx = haloCanvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  // halo plus serré autour du globe
  const zoomFactor = Math.pow(2, currentViewState.zoom - 1);
  const radius = Math.min(w, h) * 0.30 * zoomFactor;

  const grad = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, radius);

  grad.addColorStop(0.00, "rgba(120, 190, 255, 0.00)");
  grad.addColorStop(0.55, "rgba(120, 190, 255, 0.00)");
  grad.addColorStop(0.72, "rgba(120, 190, 255, 0.03)");
  grad.addColorStop(0.84, "rgba(120, 190, 255, 0.09)");
  grad.addColorStop(0.91, "rgba(120, 190, 255, 0.13)");
  grad.addColorStop(0.96, "rgba(120, 190, 255, 0.08)");
  grad.addColorStop(1.00, "rgba(120, 190, 255, 0.00)");

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function updateLegend() {
  const title = document.getElementById("legendTitle");
  const box = document.getElementById("legendItems");
  if (!title || !box) return;

  box.innerHTML = "";

  if (filterType === "responsible" && filterValue !== "ALL") {
    title.textContent = "";
    const items = [{ label: "Pays d'expérience", color: [49, 130, 189, 220] }];
    items.forEach(({ label, color }) => {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `
        <div class="legend-swatch" style="background:rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255});"></div>
        <div>${label}</div>`;
      box.appendChild(row);
    });
    return;
  }

  const palette = getActivePalette();

  if (mode === "projects") {
    title.textContent = "Nombre de projets";
    palette.project.forEach(c => {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `
        <div class="legend-swatch" style="background:rgba(${c.color[0]},${c.color[1]},${c.color[2]},${c.color[3] / 255});"></div>
        <div>${c.label}</div>`;
      box.appendChild(row);
    });
  } else {
    title.textContent = "Montant cumulé";
    const labels = [
      "0",
      `≤ ${amountShort(amountBreaks[0])}`,
      `≤ ${amountShort(amountBreaks[1])}`,
      `≤ ${amountShort(amountBreaks[2])}`,
      `≤ ${amountShort(amountBreaks[3])}`,
      `> ${amountShort(amountBreaks[3])}`
    ];
    palette.amount.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `
        <div class="legend-swatch" style="background:rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255});"></div>
        <div>${labels[i]}</div>`;
      box.appendChild(row);
    });
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function updateStatsCards(filteredProjects, features) {
  const coveredCountries = features.filter(
    f => Number(f.properties.nb_projets || 0) > 0
  ).length;

  const totalProjects = filteredProjects.length;
  const totalAmount = filteredProjects.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0
  );

  document.getElementById("stat-countries").textContent = numberFmt(coveredCountries);
  document.getElementById("stat-projects").textContent = numberFmt(totalProjects);
  document.getElementById("stat-amount").textContent =
    Math.round(totalAmount / 1000000).toLocaleString("fr-FR") + " M €";
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function updateTooltip(info) {
  const tooltip = document.getElementById("tooltip");
  if (!tooltip) return;

  if (!info.object) {
    tooltip.style.display = "none";
    return;
  }

  const props = info.object.properties;
  tooltip.innerHTML = `
    <div style="font-size:14px;font-weight:700;margin-bottom:6px;color:#ffffff;">
      ${props.country_name || "Pays"}
    </div>
    <div style="font-size:12px;line-height:1.55;color:#edf6ff;">
      <span style="color:#b9d8f5;">Nombre de projets :</span>
      <b style="color:#ffffff;">${numberFmt(props.nb_projets || 0)}</b><br/>
      <span style="color:#b9d8f5;">Montant cumulé :</span>
      <b style="color:#ffffff;">${numberFmt(props.somme_argent || 0)} EUR</b>
    </div>`;

  tooltip.style.left = `${info.x + 16}px`;
  tooltip.style.top = `${info.y + 16}px`;
  tooltip.style.display = "block";
}

// ─── Apply filter to map ──────────────────────────────────────────────────────

function applyFilterToMap() {
  const filteredProjects = getFilteredProjects();
  const statsByCountry = buildCountryStatsFromProjects(filteredProjects);

  geoFeatures.forEach(f => {
    const key = f.properties.country_key;
    const stats = statsByCountry[key] || { nb_projets: 0, somme_argent: 0 };

    f.properties.nb_projets = Number(stats.nb_projets || 0);
    f.properties.somme_argent = Math.round(Number(stats.somme_argent || 0));
  });

  amountBreaks = computeAmountBreaks(
    geoFeatures.map(f => Number(f.properties.somme_argent || 0))
  );

  updateStatsCards(filteredProjects, geoFeatures);
  refreshMap();
}

function refreshMap() {
  if (!deckgl) return;

  deckgl.setProps({ layers: getLayers() });
  updateLegend();

  const btnProjects = document.getElementById("btnProjects");
  const btnAmount = document.getElementById("btnAmount");

  if (btnProjects) btnProjects.classList.toggle("active", mode === "projects");
  if (btnAmount) btnAmount.classList.toggle("active", mode === "amount");
}

// ─── Export visibilité ────────────────────────────────────────────────────────

function updateExportVisibility() {
  const exportPanel = document.getElementById("ui-export");
  if (!exportPanel) return;

  const hide = filterType === "amount" || (filterType === "responsible" && filterValue !== "ALL");
  exportPanel.style.display = hide ? "none" : "block";
}

// ─── Auto-rotate ──────────────────────────────────────────────────────────────

function pauseAutoRotate() {
  autoRotate = false;
  if (resumeRotateTimeout) clearTimeout(resumeRotateTimeout);
  resumeRotateTimeout = setTimeout(() => { autoRotate = true; }, 1000);
}

function animateRotation() {
  if (!deckgl) return;
  pulsePhase += 0.04;
  updateHalo();

  if (autoRotate) {
    currentViewState = {
      ...currentViewState,
      longitude: currentViewState.longitude + 0.03
    };
  }

  deckgl.setProps({ viewState: currentViewState, layers: getLayers() });
  requestAnimationFrame(animateRotation);
}

// ─── Export PNG ───────────────────────────────────────────────────────────────

function exportMapPNG() {
  const status = document.getElementById("exportStatus");
  if (status) {
    status.style.display = "block";
    status.textContent = "Génération en cours…";
  }

  const ROB = [
    [0,1.0000,0.0000],[5,0.9986,0.0620],[10,0.9954,0.1240],[15,0.9900,0.1860],
    [20,0.9822,0.2480],[25,0.9730,0.3100],[30,0.9600,0.3720],[35,0.9427,0.4340],
    [40,0.9216,0.4958],[45,0.8962,0.5571],[50,0.8679,0.6176],[55,0.8350,0.6769],
    [60,0.7986,0.7346],[65,0.7597,0.7903],[70,0.7186,0.8435],[75,0.6732,0.8936],
    [80,0.6213,0.9394],[85,0.5722,0.9761],[90,0.5322,1.0000]
  ];

  function robInterp(lat) {
    const a = Math.abs(lat);
    const i = Math.min(Math.floor(a / 5), 17);
    const t = (a - i * 5) / 5;
    const plen = ROB[i][1] + t * (ROB[i + 1][1] - ROB[i][1]);
    const pdfe = ROB[i][2] + t * (ROB[i + 1][2] - ROB[i][2]);
    return { plen, pdfe: lat < 0 ? -pdfe : pdfe };
  }

  const LAT_CLIP = -58;
  const LAT_MAX = 85;
  const { pdfe: pTop } = robInterp(LAT_MAX);
  const { pdfe: pBot } = robInterp(LAT_CLIP);
  const robW = 2 * 0.8487;

  const FONT = "Bahnschrift, 'Franklin Gothic Medium', Arial Narrow, Arial, sans-serif";
  const FS_T = 24;
  const FS_L = 18;
  const FS_S = 15;
  const PAD = 14;
  const BAR = 3;
  const TITLE_H = FS_T + 10;
  const LEG_H = FS_S + 14;
  const VPAD = 6;

  const MAP_W = 1200;
  const sX = (MAP_W / robW) * 0.99;
  const sY = sX * 0.78;

  const yTop = (1.3523 * pTop / 2) * sY;
  const yBot = (1.3523 * Math.abs(pBot) / 2) * sY;
  const MAP_H = Math.round(yTop + yBot);

  const W = MAP_W + PAD * 2;
  const H = BAR + VPAD + MAP_H + VPAD + TITLE_H + LEG_H + VPAD + BAR;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const MAP_TOP = BAR + VPAD;
  const TEXT_TOP = MAP_TOP + MAP_H + VPAD;

  const cx = PAD + MAP_W / 2;
  const robMidPdfe = (pTop + pBot) / 2;
  const cy = MAP_TOP + MAP_H / 2 + (1.3523 * robMidPdfe / 2) * sY;

  const CROP_L = Math.round(20 * (200 / 25.4));
  const CROP_R = Math.round(5 * (200 / 25.4));
  const croppedW = W - CROP_L - CROP_R;
  const centerX = CROP_L + croppedW / 2;

  function robinson(lon, lat) {
    const { plen, pdfe } = robInterp(lat);
    return [
      cx + 0.8487 * plen * (lon / 180) * sX,
      cy - (1.3523 * pdfe / 2) * sY
    ];
  }

  function robBoundary() {
    ctx.beginPath();
    for (let lat = LAT_CLIP; lat <= LAT_MAX; lat += 1) {
      const [x, y] = robinson(-180, lat);
      lat === LAT_CLIP ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let lat = LAT_MAX; lat >= LAT_CLIP; lat -= 1) {
      const [x, y] = robinson(180, lat);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  let mapTitle = "Projets de Global Development";
  if (filterType === "funder" && filterValue !== "ALL") {
    mapTitle = `Projets avec ${filterValue}`;
  } else if (filterType === "responsible" && filterValue !== "ALL") {
    mapTitle = `Projets de ${filterValue}`;
  } else if (filterType === "filiale" && filterValue === "Leader: Hydroconseil") {
    mapTitle = "Projets de la filiale Hydroconseil";
  } else if (filterType === "filiale" && filterValue === "Leader: Urbaconsulting") {
    mapTitle = "Projets de la filiale Urbaconsulting";
  } else if (filterType === "filiale" && filterValue === "Leader: Nexsom") {
    mapTitle = "Projets de la filiale Nexsom";
  } else if (filterType === "sector" && filterValue !== "ALL") {
    mapTitle = `Projets secteur : ${filterValue}`;
  } else if (filterType === "expert" && filterValue !== "ALL") {
    mapTitle = `Projets de l'expert ${filterValue}`;
  } else if (filterType === "amount" && filterMinAmount > 0) {
    mapTitle = `Projets ≥ ${amountShort(filterMinAmount)}`;
  }

  const COLOR_EMPTY = [208, 218, 228, 110];

  function getExportFillColor(props) {
    let color;

    if (filterType === "responsible" && filterValue !== "ALL") {
      const v = Number(props.nb_projets || 0);
      color = v <= 0 ? COLOR_EMPTY : [49, 130, 189, 220];
    } else if (mode === "projects") {
      const v = Number(props.nb_projets || 0);
      if (!v || v <= 0) color = COLOR_EMPTY;
      else if (v <= 1) color = getActivePalette().project[1].color;
      else if (v <= 3) color = getActivePalette().project[2].color;
      else if (v <= 5) color = getActivePalette().project[3].color;
      else if (v <= 10) color = getActivePalette().project[4].color;
      else color = getActivePalette().project[5].color;
    } else {
      const v = Number(props.somme_argent || 0);
      const p = getActivePalette().amount;
      if (!v || v <= 0) color = COLOR_EMPTY;
      else if (v <= amountBreaks[0]) color = p[1];
      else if (v <= amountBreaks[1]) color = p[2];
      else if (v <= amountBreaks[2]) color = p[3];
      else if (v <= amountBreaks[3]) color = p[4];
      else color = p[5];
    }

    return color;
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  robBoundary();
  ctx.fill();

  ctx.save();
  robBoundary();
  ctx.clip();

  geoFeatures.forEach(f => {
    const color = getExportFillColor(f.properties);
    const isEmpty =
      color[0] === COLOR_EMPTY[0] &&
      color[1] === COLOR_EMPTY[1] &&
      color[2] === COLOR_EMPTY[2];

    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${(color[3] || 255) / 255})`;
    ctx.strokeStyle = isEmpty ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)";
    ctx.lineWidth = isEmpty ? 1.5 : 0.4;

    const geom = f.geometry;
    const polys = geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : [];

    polys.forEach(poly => {
      poly.forEach(ring => {
        ctx.beginPath();
        let prevLon = null;
        let penDown = false;

        ring.forEach(([lon, lat]) => {
          if (lat < LAT_CLIP - 2 || lat > LAT_MAX + 2) {
            penDown = false;
            return;
          }
          if (prevLon !== null && Math.abs(lon - prevLon) > 180) penDown = false;
          const [x, y] = robinson(lon, lat);
          penDown ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          penDown = true;
          prevLon = lon;
        });

        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
    });
  });

  ctx.restore();

  ctx.font = `bold ${FS_T}px ${FONT}`;
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.textAlign = "center";
  ctx.fillText(mapTitle, centerX, TEXT_TOP + FS_T);

  const legendTitle =
    filterType === "responsible" && filterValue !== "ALL"
      ? "Présence"
      : mode === "projects"
        ? "Nombre de projets"
        : "Montant cumulé";

  let legendItems = [];

  if (filterType === "responsible" && filterValue !== "ALL") {
    legendItems = [
      { label: "Aucun projet", color: COLOR_EMPTY },
      { label: "≥ 1 projet", color: [49, 130, 189, 220] }
    ];
  } else if (mode === "projects") {
    legendItems = [
      { label: "0", color: COLOR_EMPTY },
      ...getActivePalette().project.slice(1).map(c => ({ label: c.label, color: c.color }))
    ];
  } else {
    legendItems = getActivePalette().amount.map((color, i) => ({
      color,
      label: [
        "0",
        `≤ ${amountShort(amountBreaks[0])}`,
        `≤ ${amountShort(amountBreaks[1])}`,
        `≤ ${amountShort(amountBreaks[2])}`,
        `≤ ${amountShort(amountBreaks[3])}`,
        `> ${amountShort(amountBreaks[3])}`
      ][i]
    }));
  }

  const SH = 13, SW = 20, SGAP = 5;
  const LEG_Y = TEXT_TOP + TITLE_H;

  ctx.font = `bold ${FS_L}px ${FONT}`;
  let totalLegW = ctx.measureText(legendTitle).width + 14;
  ctx.font = `${FS_S}px ${FONT}`;
  legendItems.forEach(({ label }) => {
    totalLegW += SW + SGAP + ctx.measureText(label).width + 14;
  });

  let lx = centerX - totalLegW / 2;

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.font = `bold ${FS_L}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(legendTitle, lx, LEG_Y + FS_S);
  lx += ctx.measureText(legendTitle).width + 14;

  ctx.font = `${FS_S}px ${FONT}`;
  legendItems.forEach(({ label, color }) => {
    const top = LEG_Y + Math.round((FS_S - SH) / 2);
    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${(color[3] || 255) / 255})`;
    ctx.fillRect(lx, top, SW, SH);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, top, SW, SH);
    ctx.fillStyle = "rgba(0,0,0,0.70)";
    ctx.fillText(label, lx + SW + SGAP, LEG_Y + FS_S);
    lx += SW + SGAP + ctx.measureText(label).width + 14;
  });

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, BAR);
  ctx.fillRect(0, H - BAR, W, BAR);

  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = croppedW;
  croppedCanvas.height = H;
  const cctx = croppedCanvas.getContext("2d");
  cctx.drawImage(canvas, -CROP_L, 0);

  try {
    croppedCanvas.toBlob(blob => {
      if (!blob) {
        if (status) status.textContent = "canvas vide";
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `projet_gd_${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 300);

      if (status) {
        status.textContent = "Exporté";
        setTimeout(() => { status.style.display = "none"; }, 2500);
      }
    }, "image/png");
  } catch (e) {
    console.error("Export error:", e);
    if (status) status.textContent = e.message;
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const btnProjects = document.getElementById("btnProjects");
  const btnAmount = document.getElementById("btnAmount");
  const filterTypeSelect = document.getElementById("filterTypeSelect");
  const btnExport = document.getElementById("btnExport");

  if (btnProjects) {
    btnProjects.addEventListener("click", () => {
      mode = "projects";
      refreshMap();
      pauseAutoRotate();
    });
  }

  if (btnAmount) {
    btnAmount.addEventListener("click", () => {
      mode = "amount";
      refreshMap();
      pauseAutoRotate();
    });
  }

  if (filterTypeSelect) {
    filterTypeSelect.addEventListener("change", e => {
      filterType = e.target.value;
      filterValue = "ALL";
      filterMinAmount = 0;
      hoveredName = null;
      buildFilterValueUI();
      applyFilterToMap();
      pauseAutoRotate();
      updateExportVisibility();
    });
  }

  if (btnExport) {
    btnExport.addEventListener("click", exportMapPNG);
  }

  // ─── Stars ──────────────────────────────────────────────────────────────────

  (function generateStars() {
    const container = document.getElementById("stars-container");
    if (!container) return;
    const count = 220;

    for (let i = 0; i < count; i++) {
      const star = document.createElement("div");
      star.className = "star";
      const size = Math.random() < 0.8 ? 1 : Math.random() < 0.7 ? 1.5 : 2;
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      const dur = 2.5 + Math.random() * 5;
      const del = Math.random() * 8;
      const op = 0.4 + Math.random() * 0.6;

      star.style.cssText = `
        width:${size}px; height:${size}px;
        left:${x}%; top:${y}%;
        --duration:${dur}s; --delay:${del}s; --max-opacity:${op};
      `;

      container.appendChild(star);
    }
  })();

  // ─── Load data ──────────────────────────────────────────────────────────────

  Promise.all([
    fetch(DATA_URL).then(r => {
      if (!r.ok) throw new Error(`countries2.geojson introuvable (${r.status})`);
      return r.json();
    }),
    fetch(PROJECTS_URL).then(r => {
      if (!r.ok) throw new Error(`projects_site.json introuvable (${r.status})`);
      return r.json();
    })
  ])
    .then(([geojson, projectsJson]) => {
      geoFeatures = geojson.features || [];
      projectsData = projectsJson || null;
      projectsRows = Array.isArray(projectsJson?.projects) ? projectsJson.projects : [];

      buildFilterValueUI();
      applyFilterToMap();
      updateExportVisibility();

      deckgl = new Deck({
        parent: document.getElementById("container"),
        views: [new _GlobeView()],
        controller: true,
        viewState: currentViewState,
        layers: getLayers(),
        onViewStateChange: ({ viewState, interactionState }) => {
          currentViewState = { ...viewState };
          if (
            interactionState.isDragging ||
            interactionState.isZooming ||
            interactionState.isRotating
          ) {
            pauseAutoRotate();
          }
          if (deckgl) deckgl.setProps({ viewState: currentViewState });
        }
      });

      updateLegend();
      animateRotation();
    })
    .catch(err => {
      console.error("Erreur chargement données :", err);
      ["stat-projects", "stat-countries", "stat-amount"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "—";
      });
    });
});

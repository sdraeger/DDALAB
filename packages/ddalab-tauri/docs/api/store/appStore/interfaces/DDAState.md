[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [store/appStore](../README.md) / DDAState

# Interface: DDAState

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:87](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L87)

## Properties

### currentAnalysis

> **currentAnalysis**: [`DDAResult`](../../../types/api/interfaces/DDAResult.md) \| `null`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:88](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L88)

---

### previousAnalysis

> **previousAnalysis**: [`DDAResult`](../../../types/api/interfaces/DDAResult.md) \| `null`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:89](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L89)

---

### analysisHistory

> **analysisHistory**: [`DDAResult`](../../../types/api/interfaces/DDAResult.md)[]

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:90](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L90)

---

### analysisParameters

> **analysisParameters**: `object`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:91](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L91)

#### variants

> **variants**: `string`[]

#### windowLength

> **windowLength**: `number`

#### windowStep

> **windowStep**: `number`

#### scaleMin

> **scaleMin**: `number`

#### scaleMax

> **scaleMax**: `number`

#### scaleNum

> **scaleNum**: `number`

---

### customDelayPresets

> **customDelayPresets**: [`DelayPreset`](DelayPreset.md)[]

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:99](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L99)

---

### isRunning

> **isRunning**: `boolean`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:100](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L100)

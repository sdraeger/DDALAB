[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [store/appStore](../README.md) / AppState

# Interface: AppState

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:174](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L174)

## Properties

### isInitialized

> **isInitialized**: `boolean`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:176](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L176)

---

### isPersistenceRestored

> **isPersistenceRestored**: `boolean`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:177](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L177)

---

### persistenceService

> **persistenceService**: `StatePersistenceService` \| `null`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:178](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L178)

---

### initializeFromTauri()

> **initializeFromTauri**: () => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:179](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L179)

#### Returns

`Promise`\<`void`\>

---

### initializePersistence()

> **initializePersistence**: () => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:180](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L180)

#### Returns

`Promise`\<`void`\>

---

### fileManager

> **fileManager**: [`FileManagerState`](FileManagerState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:183](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L183)

---

### setDataDirectoryPath()

> **setDataDirectoryPath**: (`path`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:184](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L184)

#### Parameters

##### path

`string`

#### Returns

`void`

---

### setCurrentPath()

> **setCurrentPath**: (`path`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:185](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L185)

#### Parameters

##### path

`string`[]

#### Returns

`void`

---

### resetCurrentPathSync()

> **resetCurrentPathSync**: () => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:186](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L186)

#### Returns

`Promise`\<`void`\>

---

### setSelectedFile()

> **setSelectedFile**: (`file`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:187](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L187)

#### Parameters

##### file

[`EDFFileInfo`](../../../types/api/interfaces/EDFFileInfo.md) | `null`

#### Returns

`void`

---

### setSelectedChannels()

> **setSelectedChannels**: (`channels`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:188](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L188)

#### Parameters

##### channels

`string`[]

#### Returns

`void`

---

### setTimeWindow()

> **setTimeWindow**: (`window`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:189](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L189)

#### Parameters

##### window

###### start

`number`

###### end

`number`

#### Returns

`void`

---

### updateFileManagerState()

> **updateFileManagerState**: (`updates`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:190](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L190)

#### Parameters

##### updates

`Partial`\<[`FileManagerState`](FileManagerState.md)\>

#### Returns

`void`

---

### clearPendingFileSelection()

> **clearPendingFileSelection**: () => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:191](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L191)

#### Returns

`void`

---

### navigateToFile()

> **navigateToFile**: (`filePath`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:193](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L193)

Navigate file browser to show the file's directory and highlight it

#### Parameters

##### filePath

`string`

#### Returns

`void`

---

### clearHighlightedFile()

> **clearHighlightedFile**: () => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:195](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L195)

Clear the highlighted file

#### Returns

`void`

---

### plot

> **plot**: [`PlotState`](PlotState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:198](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L198)

---

### setCurrentChunk()

> **setCurrentChunk**: (`chunk`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:199](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L199)

#### Parameters

##### chunk

[`ChunkData`](../../../types/api/interfaces/ChunkData.md) | `null`

#### Returns

`void`

---

### updatePlotState()

> **updatePlotState**: (`updates`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:200](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L200)

#### Parameters

##### updates

`Partial`\<[`PlotState`](PlotState.md)\>

#### Returns

`void`

---

### savePlotData()

> **savePlotData**: (`plotData`, `analysisId?`) => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:201](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L201)

#### Parameters

##### plotData

`any`

##### analysisId?

`string`

#### Returns

`Promise`\<`void`\>

---

### dda

> **dda**: [`DDAState`](DDAState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:204](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L204)

---

### setCurrentAnalysis()

> **setCurrentAnalysis**: (`analysis`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:205](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L205)

#### Parameters

##### analysis

[`DDAResult`](../../../types/api/interfaces/DDAResult.md) | `null`

#### Returns

`void`

---

### restorePreviousAnalysis()

> **restorePreviousAnalysis**: () => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:206](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L206)

#### Returns

`void`

---

### addAnalysisToHistory()

> **addAnalysisToHistory**: (`analysis`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:207](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L207)

#### Parameters

##### analysis

[`DDAResult`](../../../types/api/interfaces/DDAResult.md)

#### Returns

`void`

---

### setAnalysisHistory()

> **setAnalysisHistory**: (`analyses`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:208](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L208)

#### Parameters

##### analyses

[`DDAResult`](../../../types/api/interfaces/DDAResult.md)[]

#### Returns

`void`

---

### updateAnalysisParameters()

> **updateAnalysisParameters**: (`parameters`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:209](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L209)

#### Parameters

##### parameters

`Partial`\<[`DDAState`](DDAState.md)\[`"analysisParameters"`\]\>

#### Returns

`void`

---

### setDDARunning()

> **setDDARunning**: (`running`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:212](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L212)

#### Parameters

##### running

`boolean`

#### Returns

`void`

---

### saveAnalysisResult()

> **saveAnalysisResult**: (`analysis`) => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:213](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L213)

#### Parameters

##### analysis

[`DDAResult`](../../../types/api/interfaces/DDAResult.md)

#### Returns

`Promise`\<`void`\>

---

### addDelayPreset()

> **addDelayPreset**: (`preset`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:214](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L214)

#### Parameters

##### preset

`Omit`\<[`DelayPreset`](DelayPreset.md), `"id"` \| `"isBuiltIn"`\>

#### Returns

`void`

---

### updateDelayPreset()

> **updateDelayPreset**: (`id`, `updates`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:215](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L215)

#### Parameters

##### id

`string`

##### updates

`Partial`\<[`DelayPreset`](DelayPreset.md)\>

#### Returns

`void`

---

### deleteDelayPreset()

> **deleteDelayPreset**: (`id`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:216](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L216)

#### Parameters

##### id

`string`

#### Returns

`void`

---

### health

> **health**: [`HealthState`](HealthState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:219](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L219)

---

### updateHealthStatus()

> **updateHealthStatus**: (`status`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:220](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L220)

#### Parameters

##### status

`Partial`\<[`HealthState`](HealthState.md)\> | (`current`) => `Partial`\<[`HealthState`](HealthState.md)\>

#### Returns

`void`

---

### sync

> **sync**: [`SyncState`](SyncState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:227](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L227)

---

### updateSyncStatus()

> **updateSyncStatus**: (`status`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:228](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L228)

#### Parameters

##### status

`Partial`\<[`SyncState`](SyncState.md)\>

#### Returns

`void`

---

### ica

> **ica**: [`ICAState`](ICAState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:231](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L231)

---

### updateICAState()

> **updateICAState**: (`updates`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:232](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L232)

#### Parameters

##### updates

`Partial`\<[`ICAState`](ICAState.md)\>

#### Returns

`void`

---

### resetICAChannels()

> **resetICAChannels**: (`channels`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:233](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L233)

#### Parameters

##### channels

`number`[]

#### Returns

`void`

---

### ui

> **ui**: [`UIState`](UIState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:236](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L236)

---

### setActiveTab()

> **setActiveTab**: (`tab`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:237](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L237)

#### Parameters

##### tab

`string`

#### Returns

`void`

---

### setPrimaryNav()

> **setPrimaryNav**: (`tab`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:238](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L238)

#### Parameters

##### tab

`PrimaryNavTab`

#### Returns

`void`

---

### setSecondaryNav()

> **setSecondaryNav**: (`tab`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:239](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L239)

#### Parameters

##### tab

`SecondaryNavTab` | `null`

#### Returns

`void`

---

### setSidebarOpen()

> **setSidebarOpen**: (`open`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:240](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L240)

#### Parameters

##### open

`boolean`

#### Returns

`void`

---

### setSidebarWidth()

> **setSidebarWidth**: (`width`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:241](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L241)

#### Parameters

##### width

`number`

#### Returns

`void`

---

### setZoom()

> **setZoom**: (`zoom`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:242](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L242)

#### Parameters

##### zoom

`number`

#### Returns

`void`

---

### increaseZoom()

> **increaseZoom**: () => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:243](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L243)

#### Returns

`void`

---

### decreaseZoom()

> **decreaseZoom**: () => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:244](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L244)

#### Returns

`void`

---

### resetZoom()

> **resetZoom**: () => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:245](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L245)

#### Returns

`void`

---

### setPanelSizes()

> **setPanelSizes**: (`sizes`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:246](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L246)

#### Parameters

##### sizes

`number`[]

#### Returns

`void`

---

### setLayout()

> **setLayout**: (`layout`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:247](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L247)

#### Parameters

##### layout

`"default"` | `"analysis"` | `"plots"`

#### Returns

`void`

---

### setTheme()

> **setTheme**: (`theme`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:248](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L248)

#### Parameters

##### theme

`"light"` | `"dark"` | `"auto"`

#### Returns

`void`

---

### setServerReady()

> **setServerReady**: (`ready`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:249](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L249)

#### Parameters

##### ready

`boolean`

#### Returns

`void`

---

### annotations

> **annotations**: [`AnnotationState`](AnnotationState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:252](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L252)

---

### addTimeSeriesAnnotation()

> **addTimeSeriesAnnotation**: (`filePath`, `annotation`, `channel?`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:253](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L253)

#### Parameters

##### filePath

`string`

##### annotation

`PlotAnnotation`

##### channel?

`string`

#### Returns

`void`

---

### updateTimeSeriesAnnotation()

> **updateTimeSeriesAnnotation**: (`filePath`, `annotationId`, `updates`, `channel?`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:258](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L258)

#### Parameters

##### filePath

`string`

##### annotationId

`string`

##### updates

`Partial`\<`PlotAnnotation`\>

##### channel?

`string`

#### Returns

`void`

---

### deleteTimeSeriesAnnotation()

> **deleteTimeSeriesAnnotation**: (`filePath`, `annotationId`, `channel?`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:264](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L264)

#### Parameters

##### filePath

`string`

##### annotationId

`string`

##### channel?

`string`

#### Returns

`void`

---

### getTimeSeriesAnnotations()

> **getTimeSeriesAnnotations**: (`filePath`, `channel?`) => `PlotAnnotation`[]

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:269](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L269)

#### Parameters

##### filePath

`string`

##### channel?

`string`

#### Returns

`PlotAnnotation`[]

---

### loadAllFileAnnotations()

> **loadAllFileAnnotations**: () => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:273](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L273)

#### Returns

`Promise`\<`void`\>

---

### addDDAAnnotation()

> **addDDAAnnotation**: (`resultId`, `variantId`, `plotType`, `annotation`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:274](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L274)

#### Parameters

##### resultId

`string`

##### variantId

`string`

##### plotType

`"heatmap"` | `"line"`

##### annotation

`PlotAnnotation`

#### Returns

`void`

---

### updateDDAAnnotation()

> **updateDDAAnnotation**: (`resultId`, `variantId`, `plotType`, `annotationId`, `updates`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:280](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L280)

#### Parameters

##### resultId

`string`

##### variantId

`string`

##### plotType

`"heatmap"` | `"line"`

##### annotationId

`string`

##### updates

`Partial`\<`PlotAnnotation`\>

#### Returns

`void`

---

### deleteDDAAnnotation()

> **deleteDDAAnnotation**: (`resultId`, `variantId`, `plotType`, `annotationId`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:287](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L287)

#### Parameters

##### resultId

`string`

##### variantId

`string`

##### plotType

`"heatmap"` | `"line"`

##### annotationId

`string`

#### Returns

`void`

---

### getDDAAnnotations()

> **getDDAAnnotations**: (`resultId`, `variantId`, `plotType`) => `PlotAnnotation`[]

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:293](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L293)

#### Parameters

##### resultId

`string`

##### variantId

`string`

##### plotType

`"heatmap"` | `"line"`

#### Returns

`PlotAnnotation`[]

---

### workflowRecording

> **workflowRecording**: [`WorkflowRecordingState`](WorkflowRecordingState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:300](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L300)

---

### startWorkflowRecording()

> **startWorkflowRecording**: (`sessionName?`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:301](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L301)

#### Parameters

##### sessionName?

`string`

#### Returns

`void`

---

### stopWorkflowRecording()

> **stopWorkflowRecording**: () => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:302](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L302)

#### Returns

`void`

---

### incrementActionCount()

> **incrementActionCount**: () => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:303](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L303)

#### Returns

`void`

---

### getRecordingStatus()

> **getRecordingStatus**: () => [`WorkflowRecordingState`](WorkflowRecordingState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:304](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L304)

#### Returns

[`WorkflowRecordingState`](WorkflowRecordingState.md)

---

### streaming

> **streaming**: [`StreamingState`](StreamingState.md)

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:307](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L307)

---

### createStreamSession()

> **createStreamSession**: (`sourceConfig`, `ddaConfig`) => `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:308](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L308)

#### Parameters

##### sourceConfig

`StreamSourceConfig`

##### ddaConfig

`StreamingDDAConfig`

#### Returns

`Promise`\<`string`\>

---

### stopStreamSession()

> **stopStreamSession**: (`streamId`) => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:312](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L312)

#### Parameters

##### streamId

`string`

#### Returns

`Promise`\<`void`\>

---

### pauseStreamSession()

> **pauseStreamSession**: (`streamId`) => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:313](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L313)

#### Parameters

##### streamId

`string`

#### Returns

`Promise`\<`void`\>

---

### resumeStreamSession()

> **resumeStreamSession**: (`streamId`) => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:314](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L314)

#### Parameters

##### streamId

`string`

#### Returns

`Promise`\<`void`\>

---

### updateStreamSession()

> **updateStreamSession**: (`streamId`, `updates`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:315](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L315)

#### Parameters

##### streamId

`string`

##### updates

`Partial`\<`StreamSession`\>

#### Returns

`void`

---

### removeStreamSession()

> **removeStreamSession**: (`streamId`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:319](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L319)

#### Parameters

##### streamId

`string`

#### Returns

`void`

---

### addStreamData()

> **addStreamData**: (`streamId`, `chunk`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:320](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L320)

#### Parameters

##### streamId

`string`

##### chunk

`DataChunk`

#### Returns

`void`

---

### addStreamResult()

> **addStreamResult**: (`streamId`, `result`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:321](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L321)

#### Parameters

##### streamId

`string`

##### result

`StreamingDDAResult`

#### Returns

`void`

---

### clearStreamPlotData()

> **clearStreamPlotData**: (`streamId`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:322](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L322)

#### Parameters

##### streamId

`string`

#### Returns

`void`

---

### updateStreamUI()

> **updateStreamUI**: (`updates`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:323](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L323)

#### Parameters

##### updates

`Partial`\<`StreamUIState`\>

#### Returns

`void`

---

### handleStreamEvent()

> **handleStreamEvent**: (`event`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:324](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L324)

#### Parameters

##### event

`StreamEvent`

#### Returns

`void`

---

### addToStreamHistory()

> **addToStreamHistory**: (`sourceConfig`, `ddaConfig`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:325](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L325)

#### Parameters

##### sourceConfig

`StreamSourceConfig`

##### ddaConfig

`StreamingDDAConfig`

#### Returns

`void`

---

### createStreamFromHistory()

> **createStreamFromHistory**: (`historyId`) => `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:329](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L329)

#### Parameters

##### historyId

`string`

#### Returns

`Promise`\<`string`\>

---

### removeFromStreamHistory()

> **removeFromStreamHistory**: (`historyId`) => `void`

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:330](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L330)

#### Parameters

##### historyId

`string`

#### Returns

`void`

---

### saveCurrentState()

> **saveCurrentState**: () => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:333](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L333)

#### Returns

`Promise`\<`void`\>

---

### forceSave()

> **forceSave**: () => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:334](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L334)

#### Returns

`Promise`\<`void`\>

---

### clearPersistedState()

> **clearPersistedState**: () => `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:335](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L335)

#### Returns

`Promise`\<`void`\>

---

### getPersistedState()

> **getPersistedState**: () => `Promise`\<`AppState` \| `null`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:336](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L336)

#### Returns

`Promise`\<`AppState` \| `null`\>

---

### createStateSnapshot()

> **createStateSnapshot**: () => `Promise`\<`any`\>

Defined in: [packages/ddalab-tauri/src/store/appStore.ts:337](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/store/appStore.ts#L337)

#### Returns

`Promise`\<`any`\>

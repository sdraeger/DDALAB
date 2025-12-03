[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [services/apiService](../README.md) / ApiService

# Class: ApiService

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:87](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L87)

## Constructors

### Constructor

> **new ApiService**(`baseURL`, `sessionToken?`): `ApiService`

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:93](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L93)

#### Parameters

##### baseURL

`string`

##### sessionToken?

`string`

#### Returns

`ApiService`

## Properties

### baseURL

> **baseURL**: `string`

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:89](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L89)

## Methods

### setSessionToken()

> **setSessionToken**(`token`): `void`

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:115](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L115)

#### Parameters

##### token

`string`

#### Returns

`void`

---

### getSessionToken()

> **getSessionToken**(): `string` \| `null`

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:120](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L120)

#### Returns

`string` \| `null`

---

### checkHealth()

> **checkHealth**(): `Promise`\<[`HealthResponse`](../../../types/api/interfaces/HealthResponse.md)\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:125](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L125)

#### Returns

`Promise`\<[`HealthResponse`](../../../types/api/interfaces/HealthResponse.md)\>

---

### getAvailableFiles()

> **getAvailableFiles**(): `Promise`\<[`EDFFileInfo`](../../../types/api/interfaces/EDFFileInfo.md)[]\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:136](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L136)

#### Returns

`Promise`\<[`EDFFileInfo`](../../../types/api/interfaces/EDFFileInfo.md)[]\>

---

### getFileInfo()

> **getFileInfo**(`filePath`): `Promise`\<[`EDFFileInfo`](../../../types/api/interfaces/EDFFileInfo.md)\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:175](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L175)

#### Parameters

##### filePath

`string`

#### Returns

`Promise`\<[`EDFFileInfo`](../../../types/api/interfaces/EDFFileInfo.md)\>

---

### listDirectory()

> **listDirectory**(`path`): `Promise`\<\{ `files`: `object`[]; \}\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:237](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L237)

#### Parameters

##### path

`string` = `""`

#### Returns

`Promise`\<\{ `files`: `object`[]; \}\>

---

### getOverviewData()

> **getOverviewData**(`filePath`, `requestedChannels?`, `maxPoints?`, `signal?`): `Promise`\<[`ChunkData`](../../../types/api/interfaces/ChunkData.md)\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:255](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L255)

#### Parameters

##### filePath

`string`

##### requestedChannels?

`string`[]

##### maxPoints?

`number` = `2000`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<[`ChunkData`](../../../types/api/interfaces/ChunkData.md)\>

---

### getOverviewProgress()

> **getOverviewProgress**(`filePath`, `requestedChannels?`, `maxPoints?`, `signal?`): `Promise`\<\{ `has_cache`: `boolean`; `completion_percentage`: `number`; `is_complete`: `boolean`; `samples_processed?`: `number`; `total_samples?`: `number`; \}\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:311](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L311)

#### Parameters

##### filePath

`string`

##### requestedChannels?

`string`[]

##### maxPoints?

`number` = `2000`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<\{ `has_cache`: `boolean`; `completion_percentage`: `number`; `is_complete`: `boolean`; `samples_processed?`: `number`; `total_samples?`: `number`; \}\>

---

### getChunkData()

> **getChunkData**(`filePath`, `chunkStart`, `chunkSize`, `requestedChannels?`, `signal?`, `preprocessing?`): `Promise`\<[`ChunkData`](../../../types/api/interfaces/ChunkData.md)\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:351](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L351)

#### Parameters

##### filePath

`string`

##### chunkStart

`number`

##### chunkSize

`number`

##### requestedChannels?

`string`[]

##### signal?

`AbortSignal`

##### preprocessing?

###### highpass?

`number`

###### lowpass?

`number`

###### notch?

`number`[]

#### Returns

`Promise`\<[`ChunkData`](../../../types/api/interfaces/ChunkData.md)\>

---

### getAnnotations()

> **getAnnotations**(`filePath`): `Promise`\<[`Annotation`](../../../types/api/interfaces/Annotation.md)[]\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:485](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L485)

#### Parameters

##### filePath

`string`

#### Returns

`Promise`\<[`Annotation`](../../../types/api/interfaces/Annotation.md)[]\>

---

### createAnnotation()

> **createAnnotation**(`annotation`): `Promise`\<[`Annotation`](../../../types/api/interfaces/Annotation.md)\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:502](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L502)

#### Parameters

##### annotation

`Omit`\<[`Annotation`](../../../types/api/interfaces/Annotation.md), `"id"` \| `"created_at"`\>

#### Returns

`Promise`\<[`Annotation`](../../../types/api/interfaces/Annotation.md)\>

---

### updateAnnotation()

> **updateAnnotation**(`id`, `annotation`): `Promise`\<[`Annotation`](../../../types/api/interfaces/Annotation.md)\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:524](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L524)

#### Parameters

##### id

`string`

##### annotation

`Partial`\<[`Annotation`](../../../types/api/interfaces/Annotation.md)\>

#### Returns

`Promise`\<[`Annotation`](../../../types/api/interfaces/Annotation.md)\>

---

### deleteAnnotation()

> **deleteAnnotation**(`id`, `filePath`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:548](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L548)

#### Parameters

##### id

`string`

##### filePath

`string`

#### Returns

`Promise`\<`void`\>

---

### submitDDAAnalysis()

> **submitDDAAnalysis**(`request`): `Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md)\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:583](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L583)

#### Parameters

##### request

[`DDAAnalysisRequest`](../../../types/api/interfaces/DDAAnalysisRequest.md)

#### Returns

`Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md)\>

---

### getDDAResults()

> **getDDAResults**(`jobId?`, `filePath?`): `Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md)[]\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:999](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L999)

#### Parameters

##### jobId?

`string`

##### filePath?

`string`

#### Returns

`Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md)[]\>

---

### getDDAResult()

> **getDDAResult**(`jobId`): `Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md)\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1013](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1013)

#### Parameters

##### jobId

`string`

#### Returns

`Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md)\>

---

### getDDAStatus()

> **getDDAStatus**(`jobId`): `Promise`\<\{ `status`: `string`; `progress?`: `number`; `message?`: `string`; \}\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1023](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1023)

#### Parameters

##### jobId

`string`

#### Returns

`Promise`\<\{ `status`: `string`; `progress?`: `number`; `message?`: `string`; \}\>

---

### cancelDDAAnalysis()

> **cancelDDAAnalysis**(): `Promise`\<\{ `success`: `boolean`; `message`: `string`; `cancelled_analysis_id?`: `string`; \}\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1036](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1036)

#### Returns

`Promise`\<\{ `success`: `boolean`; `message`: `string`; `cancelled_analysis_id?`: `string`; \}\>

---

### saveAnalysisToHistory()

> **saveAnalysisToHistory**(`result`): `Promise`\<`boolean`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1057](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1057)

#### Parameters

##### result

[`DDAResult`](../../../types/api/interfaces/DDAResult.md)

#### Returns

`Promise`\<`boolean`\>

---

### getAnalysisHistory()

> **getAnalysisHistory**(): `Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md)[]\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1085](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1085)

#### Returns

`Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md)[]\>

---

### getAnalysisFromHistory()

> **getAnalysisFromHistory**(`resultId`): `Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md) \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1139](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1139)

#### Parameters

##### resultId

`string`

#### Returns

`Promise`\<[`DDAResult`](../../../types/api/interfaces/DDAResult.md) \| `null`\>

---

### deleteAnalysisFromHistory()

> **deleteAnalysisFromHistory**(`resultId`): `Promise`\<`boolean`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1204](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1204)

#### Parameters

##### resultId

`string`

#### Returns

`Promise`\<`boolean`\>

---

### renameAnalysisInHistory()

> **renameAnalysisInHistory**(`resultId`, `newName`): `Promise`\<`boolean`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1226](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1226)

#### Parameters

##### resultId

`string`

##### newName

`string`

#### Returns

`Promise`\<`boolean`\>

---

### submitICAAnalysis()

> **submitICAAnalysis**(`request`, `signal?`): `Promise`\<`ICAResult`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1257](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1257)

#### Parameters

##### request

`ICAAnalysisRequest`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<`ICAResult`\>

---

### getICAResults()

> **getICAResults**(): `Promise`\<`ICAResult`[]\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1269](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1269)

#### Returns

`Promise`\<`ICAResult`[]\>

---

### getICAResult()

> **getICAResult**(`analysisId`): `Promise`\<`ICAResult`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1274](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1274)

#### Parameters

##### analysisId

`string`

#### Returns

`Promise`\<`ICAResult`\>

---

### deleteICAResult()

> **deleteICAResult**(`analysisId`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1281](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1281)

#### Parameters

##### analysisId

`string`

#### Returns

`Promise`\<`void`\>

---

### reconstructWithoutComponents()

> **reconstructWithoutComponents**(`request`): `Promise`\<`ReconstructResponse`\>

Defined in: [packages/ddalab-tauri/src/services/apiService.ts:1285](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/apiService.ts#L1285)

#### Parameters

##### request

`ReconstructRequest`

#### Returns

`Promise`\<`ReconstructResponse`\>

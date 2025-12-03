[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [hooks/useStreamingData](../README.md) / useStreamingData

# Function: useStreamingData()

> **useStreamingData**(`streamId`): `object`

Defined in: [packages/ddalab-tauri/src/hooks/useStreamingData.ts:13](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/hooks/useStreamingData.ts#L13)

## Parameters

### streamId

`string` | `null`

## Returns

`object`

### session

> **session**: `StreamSession` \| `null`

### plotData

> **plotData**: `StreamPlotData` \| `null`

### latestChunks

> **latestChunks**: `DataChunk`[]

### latestResults

> **latestResults**: `StreamingDDAResult`[]

### stats

> **stats**: `StreamStats` \| `undefined`

### isRunning

> **isRunning**: `boolean`

### isPaused

> **isPaused**: `boolean`

### hasError

> **hasError**: `boolean`

### isConnecting

> **isConnecting**: `boolean`

### createStream()

> **createStream**: (`sourceConfig`, `ddaConfig`) => `Promise`\<`string`\> = `createStreamSession`

#### Parameters

##### sourceConfig

`StreamSourceConfig`

##### ddaConfig

`StreamingDDAConfig`

#### Returns

`Promise`\<`string`\>

### stopStream()

> **stopStream**: (`streamId`) => `Promise`\<`void`\> = `stopStreamSession`

#### Parameters

##### streamId

`string`

#### Returns

`Promise`\<`void`\>

### pauseStream()

> **pauseStream**: (`streamId`) => `Promise`\<`void`\> = `pauseStreamSession`

#### Parameters

##### streamId

`string`

#### Returns

`Promise`\<`void`\>

### resumeStream()

> **resumeStream**: (`streamId`) => `Promise`\<`void`\> = `resumeStreamSession`

#### Parameters

##### streamId

`string`

#### Returns

`Promise`\<`void`\>

### clearData()

> **clearData**: (`streamId`) => `void` = `clearStreamPlotData`

#### Parameters

##### streamId

`string`

#### Returns

`void`

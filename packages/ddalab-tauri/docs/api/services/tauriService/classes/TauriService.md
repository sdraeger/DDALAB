[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [services/tauriService](../README.md) / TauriService

# Class: TauriService

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:126](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L126)

## Constructors

### Constructor

> **new TauriService**(): `TauriService`

#### Returns

`TauriService`

## Methods

### getInstance()

> `static` **getInstance**(): `TauriService`

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:129](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L129)

#### Returns

`TauriService`

---

### getAppState()

> `static` **getAppState**(): `Promise`\<[`AppState`](../interfaces/AppState.md)\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:189](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L189)

#### Returns

`Promise`\<[`AppState`](../interfaces/AppState.md)\>

---

### updateFileManagerState()

> `static` **updateFileManagerState**(`state`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:223](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L223)

#### Parameters

##### state

[`FileManagerState`](../interfaces/FileManagerState.md)

#### Returns

`Promise`\<`void`\>

---

### updatePlotState()

> `static` **updatePlotState**(`state`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:246](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L246)

#### Parameters

##### state

[`PlotState`](../interfaces/PlotState.md)

#### Returns

`Promise`\<`void`\>

---

### updateDDAState()

> `static` **updateDDAState**(`state`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:256](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L256)

#### Parameters

##### state

[`DDAState`](../interfaces/DDAState.md)

#### Returns

`Promise`\<`void`\>

---

### updateUIState()

> `static` **updateUIState**(`updates`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:266](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L266)

#### Parameters

##### updates

`Record`\<`string`, `any`\>

#### Returns

`Promise`\<`void`\>

---

### checkApiConnection()

> `static` **checkApiConnection**(`url`): `Promise`\<`boolean`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:276](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L276)

#### Parameters

##### url

`string`

#### Returns

`Promise`\<`boolean`\>

---

### getAppPreferences()

> `static` **getAppPreferences**(): `Promise`\<[`AppPreferences`](../interfaces/AppPreferences.md)\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:287](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L287)

#### Returns

`Promise`\<[`AppPreferences`](../interfaces/AppPreferences.md)\>

---

### saveAppPreferences()

> `static` **saveAppPreferences**(`preferences`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:308](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L308)

#### Parameters

##### preferences

[`AppPreferences`](../interfaces/AppPreferences.md)

#### Returns

`Promise`\<`void`\>

---

### openFileDialog()

> `static` **openFileDialog**(): `Promise`\<`string` \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:319](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L319)

#### Returns

`Promise`\<`string` \| `null`\>

---

### showNotification()

> `static` **showNotification**(`title`, `body`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:334](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L334)

#### Parameters

##### title

`string`

##### body

`string`

#### Returns

`Promise`\<`void`\>

---

### minimizeWindow()

> `static` **minimizeWindow**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:346](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L346)

#### Returns

`Promise`\<`void`\>

---

### maximizeWindow()

> `static` **maximizeWindow**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:356](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L356)

#### Returns

`Promise`\<`void`\>

---

### closeWindow()

> `static` **closeWindow**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:366](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L366)

#### Returns

`Promise`\<`void`\>

---

### setWindowTitle()

> `static` **setWindowTitle**(`title`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:376](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L376)

#### Parameters

##### title

`string`

#### Returns

`Promise`\<`void`\>

---

### startLocalApiServer()

> `static` **startLocalApiServer**(`port?`, `host?`, `dataDirectory?`): `Promise`\<`any`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:387](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L387)

#### Parameters

##### port?

`number`

##### host?

`string`

##### dataDirectory?

`string`

#### Returns

`Promise`\<`any`\>

---

### stopLocalApiServer()

> `static` **stopLocalApiServer**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:408](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L408)

#### Returns

`Promise`\<`void`\>

---

### getApiStatus()

> `static` **getApiStatus**(): `Promise`\<`any`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:419](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L419)

#### Returns

`Promise`\<`any`\>

---

### getApiConfig()

> `static` **getApiConfig**(): `Promise`\<`any`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:430](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L430)

#### Returns

`Promise`\<`any`\>

---

### loadApiConfig()

> `static` **loadApiConfig**(): `Promise`\<`any`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:441](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L441)

#### Returns

`Promise`\<`any`\>

---

### saveApiConfig()

> `static` **saveApiConfig**(`config`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:452](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L452)

#### Parameters

##### config

`any`

#### Returns

`Promise`\<`void`\>

---

### selectDataDirectory()

> `static` **selectDataDirectory**(): `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:464](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L464)

#### Returns

`Promise`\<`string`\>

---

### getDataDirectory()

> `static` **getDataDirectory**(): `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:487](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L487)

#### Returns

`Promise`\<`string`\>

---

### setDataDirectory()

> `static` **setDataDirectory**(`path`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:498](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L498)

#### Parameters

##### path

`string`

#### Returns

`Promise`\<`void`\>

---

### isTauri()

> `static` **isTauri**(): `boolean`

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:509](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L509)

#### Returns

`boolean`

---

### checkForUpdates()

> `static` **checkForUpdates**(): `Promise`\<\{ `available`: `boolean`; `current_version`: `string`; `latest_version?`: `string`; `release_notes?`: `string`; `release_date?`: `string`; `download_url?`: `string`; \}\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:547](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L547)

#### Returns

`Promise`\<\{ `available`: `boolean`; `current_version`: `string`; `latest_version?`: `string`; `release_notes?`: `string`; `release_date?`: `string`; `download_url?`: `string`; \}\>

---

### getAppVersion()

> `static` **getAppVersion**(): `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:561](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L561)

#### Returns

`Promise`\<`string`\>

---

### checkNativeUpdate()

> `static` **checkNativeUpdate**(): `Promise`\<\{ `available`: `boolean`; `current_version`: `string`; `latest_version?`: `string`; `release_notes?`: `string`; `release_date?`: `string`; \}\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:568](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L568)

#### Returns

`Promise`\<\{ `available`: `boolean`; `current_version`: `string`; `latest_version?`: `string`; `release_notes?`: `string`; `release_date?`: `string`; \}\>

---

### downloadAndInstallUpdate()

> `static` **downloadAndInstallUpdate**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:580](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L580)

#### Returns

`Promise`\<`void`\>

---

### openUrl()

> `static` **openUrl**(`url`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:587](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L587)

#### Parameters

##### url

`string`

#### Returns

`Promise`\<`void`\>

---

### openLogsFolder()

> `static` **openLogsFolder**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:600](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L600)

#### Returns

`Promise`\<`void`\>

---

### getLogsPath()

> `static` **getLogsPath**(): `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:606](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L606)

#### Returns

`Promise`\<`string`\>

---

### readLogsContent()

> `static` **readLogsContent**(): `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:612](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L612)

#### Returns

`Promise`\<`string`\>

---

### saveNSGCredentials()

> `static` **saveNSGCredentials**(`username`, `password`, `appKey`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:620](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L620)

#### Parameters

##### username

`string`

##### password

`string`

##### appKey

`string`

#### Returns

`Promise`\<`void`\>

---

### getNSGCredentials()

> `static` **getNSGCredentials**(): `Promise`\<[`NSGCredentials`](../interfaces/NSGCredentials.md) \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:630](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L630)

#### Returns

`Promise`\<[`NSGCredentials`](../interfaces/NSGCredentials.md) \| `null`\>

---

### hasNSGCredentials()

> `static` **hasNSGCredentials**(): `Promise`\<`boolean`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:636](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L636)

#### Returns

`Promise`\<`boolean`\>

---

### deleteNSGCredentials()

> `static` **deleteNSGCredentials**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:642](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L642)

#### Returns

`Promise`\<`void`\>

---

### testNSGConnection()

> `static` **testNSGConnection**(): `Promise`\<`boolean`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:648](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L648)

#### Returns

`Promise`\<`boolean`\>

---

### createNSGJob()

> `static` **createNSGJob**(`tool`, `ddaParams`, `inputFilePath`, `runtimeHours?`, `cores?`, `nodes?`): `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:654](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L654)

#### Parameters

##### tool

`string`

##### ddaParams

`Record`\<`string`, `any`\>

##### inputFilePath

`string`

##### runtimeHours?

`number`

##### cores?

`number`

##### nodes?

`number`

#### Returns

`Promise`\<`string`\>

---

### submitNSGJob()

> `static` **submitNSGJob**(`jobId`): `Promise`\<[`NSGJob`](../interfaces/NSGJob.md)\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:681](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L681)

#### Parameters

##### jobId

`string`

#### Returns

`Promise`\<[`NSGJob`](../interfaces/NSGJob.md)\>

---

### getNSGJobStatus()

> `static` **getNSGJobStatus**(`jobId`): `Promise`\<[`NSGJob`](../interfaces/NSGJob.md)\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:687](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L687)

#### Parameters

##### jobId

`string`

#### Returns

`Promise`\<[`NSGJob`](../interfaces/NSGJob.md)\>

---

### listNSGJobs()

> `static` **listNSGJobs**(): `Promise`\<[`NSGJob`](../interfaces/NSGJob.md)[]\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:693](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L693)

#### Returns

`Promise`\<[`NSGJob`](../interfaces/NSGJob.md)[]\>

---

### listActiveNSGJobs()

> `static` **listActiveNSGJobs**(): `Promise`\<[`NSGJob`](../interfaces/NSGJob.md)[]\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:699](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L699)

#### Returns

`Promise`\<[`NSGJob`](../interfaces/NSGJob.md)[]\>

---

### cancelNSGJob()

> `static` **cancelNSGJob**(`jobId`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:705](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L705)

#### Parameters

##### jobId

`string`

#### Returns

`Promise`\<`void`\>

---

### downloadNSGResults()

> `static` **downloadNSGResults**(`jobId`): `Promise`\<`string`[]\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:711](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L711)

#### Parameters

##### jobId

`string`

#### Returns

`Promise`\<`string`[]\>

---

### extractNSGTarball()

> `static` **extractNSGTarball**(`jobId`, `tarPath`): `Promise`\<`string`[]\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:717](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L717)

#### Parameters

##### jobId

`string`

##### tarPath

`string`

#### Returns

`Promise`\<`string`[]\>

---

### readTextFile()

> `static` **readTextFile**(`filePath`): `Promise`\<`string`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:726](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L726)

#### Parameters

##### filePath

`string`

#### Returns

`Promise`\<`string`\>

---

### deleteNSGJob()

> `static` **deleteNSGJob**(`jobId`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:733](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L733)

#### Parameters

##### jobId

`string`

#### Returns

`Promise`\<`void`\>

---

### pollNSGJobs()

> `static` **pollNSGJobs**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:739](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L739)

#### Returns

`Promise`\<`void`\>

---

### getNSGJobStats()

> `static` **getNSGJobStats**(): `Promise`\<[`NSGJobStats`](../interfaces/NSGJobStats.md)\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:745](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L745)

#### Returns

`Promise`\<[`NSGJobStats`](../interfaces/NSGJobStats.md)\>

---

### cleanupPendingNSGJobs()

> `static` **cleanupPendingNSGJobs**(): `Promise`\<`number`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:751](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L751)

#### Returns

`Promise`\<`number`\>

---

### createNotification()

> `static` **createNotification**(`title`, `message`, `notificationType`, `actionType?`, `actionData?`): `Promise`\<[`Notification`](../interfaces/Notification.md)\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:758](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L758)

#### Parameters

##### title

`string`

##### message

`string`

##### notificationType

[`NotificationType`](../enumerations/NotificationType.md) = `NotificationType.Info`

##### actionType?

`string`

##### actionData?

`any`

#### Returns

`Promise`\<[`Notification`](../interfaces/Notification.md)\>

---

### listNotifications()

> `static` **listNotifications**(`limit?`): `Promise`\<[`Notification`](../interfaces/Notification.md)[]\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:783](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L783)

#### Parameters

##### limit?

`number`

#### Returns

`Promise`\<[`Notification`](../interfaces/Notification.md)[]\>

---

### getUnreadCount()

> `static` **getUnreadCount**(): `Promise`\<`number`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:796](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L796)

#### Returns

`Promise`\<`number`\>

---

### markNotificationRead()

> `static` **markNotificationRead**(`id`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:809](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L809)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

---

### markAllNotificationsRead()

> `static` **markAllNotificationsRead**(): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:825](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L825)

#### Returns

`Promise`\<`void`\>

---

### deleteNotification()

> `static` **deleteNotification**(`id`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:841](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L841)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

---

### deleteOldNotifications()

> `static` **deleteOldNotifications**(`days`): `Promise`\<`number`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:854](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L854)

#### Parameters

##### days

`number`

#### Returns

`Promise`\<`number`\>

---

### exportAnnotations()

> `static` **exportAnnotations**(`filePath`, `format`): `Promise`\<`string` \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:871](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L871)

#### Parameters

##### filePath

`string`

##### format

`"json"` | `"csv"`

#### Returns

`Promise`\<`string` \| `null`\>

---

### exportAllAnnotations()

> `static` **exportAllAnnotations**(`format`): `Promise`\<`string` \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:887](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L887)

#### Parameters

##### format

`"json"` | `"csv"`

#### Returns

`Promise`\<`string` \| `null`\>

---

### previewImportAnnotations()

> `static` **previewImportAnnotations**(`targetFilePath`): `Promise`\<\{ `source_file`: `string`; `target_file`: `string`; `annotations`: `object`[]; `warnings`: `string`[]; `summary`: \{ `total`: `number`; `new`: `number`; `duplicates`: `number`; `near_duplicates`: `number`; \}; \} \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:902](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L902)

#### Parameters

##### targetFilePath

`string`

#### Returns

`Promise`\<\{ `source_file`: `string`; `target_file`: `string`; `annotations`: `object`[]; `warnings`: `string`[]; `summary`: \{ `total`: `number`; `new`: `number`; `duplicates`: `number`; `near_duplicates`: `number`; \}; \} \| `null`\>

---

### importAnnotations()

> `static` **importAnnotations**(`targetFilePath`): `Promise`\<\{ `total_in_file`: `number`; `imported`: `number`; `skipped_duplicates`: `number`; `skipped_near_duplicates`: `number`; `warnings`: `string`[]; \}\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:940](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L940)

#### Parameters

##### targetFilePath

`string`

#### Returns

`Promise`\<\{ `total_in_file`: `number`; `imported`: `number`; `skipped_duplicates`: `number`; `skipped_near_duplicates`: `number`; `warnings`: `string`[]; \}\>

---

### importSelectedAnnotations()

> `static` **importSelectedAnnotations**(`importFilePath`, `targetFilePath`, `selectedIds`): `Promise`\<`number`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:959](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L959)

#### Parameters

##### importFilePath

`string`

##### targetFilePath

`string`

##### selectedIds

`string`[]

#### Returns

`Promise`\<`number`\>

---

### saveDDAExportFile()

> `static` **saveDDAExportFile**(`content`, `format`, `defaultFilename`): `Promise`\<`string` \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:983](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L983)

#### Parameters

##### content

`string`

##### format

`"json"` | `"csv"`

##### defaultFilename

`string`

#### Returns

`Promise`\<`string` \| `null`\>

---

### savePlotExportFile()

> `static` **savePlotExportFile**(`imageData`, `format`, `defaultFilename`): `Promise`\<`string` \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:1004](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L1004)

#### Parameters

##### imageData

`Uint8Array`

##### format

`"png"` | `"svg"` | `"pdf"`

##### defaultFilename

`string`

#### Returns

`Promise`\<`string` \| `null`\>

---

### deleteAnnotation()

> `static` **deleteAnnotation**(`annotationId`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:1025](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L1025)

#### Parameters

##### annotationId

`string`

#### Returns

`Promise`\<`void`\>

---

### getAllAnnotations()

> `static` **getAllAnnotations**(): `Promise`\<`Record`\<`string`, \{ `global_annotations`: `object`[]; `channel_annotations`: `Record`\<`string`, `object`[]\>; \}\>\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:1038](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L1038)

#### Returns

`Promise`\<`Record`\<`string`, \{ `global_annotations`: `object`[]; `channel_annotations`: `Record`\<`string`, `object`[]\>; \}\>\>

---

### selectDirectory()

> `static` **selectDirectory**(): `Promise`\<`string` \| `null`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:1076](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L1076)

#### Returns

`Promise`\<`string` \| `null`\>

---

### segmentFile()

> `static` **segmentFile**(`params`): `Promise`\<\{ `outputPath`: `string`; \}\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:1096](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L1096)

#### Parameters

##### params

###### filePath

`string`

###### startTime

`number`

###### startUnit

`"seconds"` \| `"samples"`

###### endTime

`number`

###### endUnit

`"seconds"` \| `"samples"`

###### outputDirectory

`string`

###### outputFormat

`"csv"` \| `"same"` \| `"edf"` \| `"ascii"`

###### outputFilename

`string`

###### selectedChannels

`number`[] \| `null`

#### Returns

`Promise`\<\{ `outputPath`: `string`; \}\>

---

### checkAnnexPlaceholder()

> `static` **checkAnnexPlaceholder**(`filePath`): `Promise`\<`boolean`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:1133](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L1133)

#### Parameters

##### filePath

`string`

#### Returns

`Promise`\<`boolean`\>

---

### runGitAnnexGet()

> `static` **runGitAnnexGet**(`filePath`): `Promise`\<\{ `success`: `boolean`; `output`: `string`; `error?`: `string`; \}\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:1144](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L1144)

#### Parameters

##### filePath

`string`

#### Returns

`Promise`\<\{ `success`: `boolean`; `output`: `string`; `error?`: `string`; \}\>

---

### openAnalysisPreviewWindow()

> **openAnalysisPreviewWindow**(`analysis`): `Promise`\<`void`\>

Defined in: [packages/ddalab-tauri/src/services/tauriService.ts:136](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/services/tauriService.ts#L136)

#### Parameters

##### analysis

`any`

#### Returns

`Promise`\<`void`\>

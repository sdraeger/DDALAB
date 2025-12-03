[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / useAutoSave

# Function: useAutoSave()

> **useAutoSave**(`__namedParameters`): `object`

Defined in: [packages/ddalab-tauri/src/components/ui/auto-save-indicator.tsx:141](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/auto-save-indicator.tsx#L141)

## Parameters

### \_\_namedParameters

#### onSave

() => `Promise`\<`void`\>

#### debounceMs?

`number` = `1000`

#### enabled?

`boolean` = `true`

## Returns

`object`

### status

> **status**: [`SaveStatus`](../type-aliases/SaveStatus.md)

### lastSaved

> **lastSaved**: `Date` \| `undefined`

### errorMessage

> **errorMessage**: `string` \| `undefined`

### triggerSave()

> **triggerSave**: () => `void`

#### Returns

`void`

### saveNow()

> **saveNow**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

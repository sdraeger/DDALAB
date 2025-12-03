[**DDALAB TypeScript API v1.0.20**](../../../README.md)

---

[DDALAB TypeScript API](../../../README.md) / [components/ui](../README.md) / LoadingErrorState

# Function: LoadingErrorState()

> **LoadingErrorState**(`__namedParameters`): `Element`

Defined in: [packages/ddalab-tauri/src/components/ui/error-state.tsx:172](https://github.com/sdraeger/DDALAB/blob/172ef9986479fd4ce5c2847f1749bc5055811d03/packages/ddalab-tauri/src/components/ui/error-state.tsx#L172)

Loading state with error handling.
Shows loading, error, or children based on state.

## Parameters

### \_\_namedParameters

#### isLoading

`boolean`

#### error?

`string` \| `Error` \| `null`

#### onRetry?

() => `void`

#### loadingComponent?

`ReactNode`

#### children

`ReactNode`

#### className?

`string`

## Returns

`Element`

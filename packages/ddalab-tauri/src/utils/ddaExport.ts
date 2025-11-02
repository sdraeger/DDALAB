import type { DDAResult, DDAVariantResult } from '@/types/api'

export interface ExportOptions {
  variant?: string
  channels?: string[]
  includeMetadata?: boolean
}

export function exportDDAToCSV(result: DDAResult, options: ExportOptions = {}): string {
  const { variant, channels, includeMetadata = true } = options

  const lines: string[] = []

  if (includeMetadata) {
    lines.push(`Analysis ID,${result.id}`)
    lines.push(`File Path,${result.file_path}`)
    lines.push(`Created At,${result.created_at}`)
    lines.push(`Channels,"${result.channels.join(', ')}"`)
    lines.push(`Window Length,${result.parameters.window_length}`)
    lines.push(`Window Step,${result.parameters.window_step}`)
    lines.push(`Scale Min,${result.parameters.scale_min}`)
    lines.push(`Scale Max,${result.parameters.scale_max}`)
    lines.push(`Scale Num,${result.parameters.scale_num}`)
    lines.push('')
  }

  const scales = result.results.scales
  const variantsToExport = variant
    ? result.results.variants.filter(v => v.variant_id === variant)
    : result.results.variants

  for (const variantResult of variantsToExport) {
    lines.push(`Variant: ${variantResult.variant_name}`)
    lines.push('')

    const channelsToExport = channels || Object.keys(variantResult.dda_matrix)

    lines.push('Scale,' + channelsToExport.join(','))

    for (let i = 0; i < scales.length; i++) {
      const row = [scales[i].toString()]
      for (const channel of channelsToExport) {
        const value = variantResult.dda_matrix[channel]?.[i]
        row.push(value !== undefined ? value.toString() : '')
      }
      lines.push(row.join(','))
    }

    lines.push('')
    lines.push('Exponents')
    for (const channel of channelsToExport) {
      const exponent = variantResult.exponents[channel]
      lines.push(`${channel},${exponent !== undefined ? exponent : ''}`)
    }

    if (Object.keys(variantResult.quality_metrics).length > 0) {
      lines.push('')
      lines.push('Quality Metrics')
      for (const [key, value] of Object.entries(variantResult.quality_metrics)) {
        lines.push(`${key},${value}`)
      }
    }

    lines.push('')
    lines.push('')
  }

  return lines.join('\n')
}

export function exportDDAToJSON(result: DDAResult, options: ExportOptions = {}): string {
  const { variant, channels } = options

  let exportData: DDAResult | Partial<DDAResult> = result

  if (variant || channels) {
    exportData = {
      ...result,
      results: {
        scales: result.results.scales,
        variants: result.results.variants
          .filter(v => !variant || v.variant_id === variant)
          .map(v => {
            if (!channels) return v

            const filteredMatrix: Record<string, number[]> = {}
            const filteredExponents: Record<string, number> = {}

            for (const channel of channels) {
              if (v.dda_matrix[channel]) {
                filteredMatrix[channel] = v.dda_matrix[channel]
              }
              if (v.exponents[channel] !== undefined) {
                filteredExponents[channel] = v.exponents[channel]
              }
            }

            return {
              ...v,
              dda_matrix: filteredMatrix,
              exponents: filteredExponents
            }
          })
      }
    }
  }

  return JSON.stringify(exportData, null, 2)
}

export function getDefaultExportFilename(result: DDAResult, format: 'csv' | 'json', variant?: string): string {
  const timestamp = new Date(result.created_at).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const variantSuffix = variant ? `_${variant}` : ''
  const fileName = result.name || result.id.slice(0, 8)

  return `dda_${fileName}${variantSuffix}_${timestamp}.${format}`
}

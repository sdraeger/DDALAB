$version: "2.0"

namespace com.ddalab.output

/// Output file structure specification
structure OutputSpec {
    /// Info file metadata
    @required
    infoFile: InfoFileSpec

    /// Per-variant output file specifications
    @required
    variantFiles: VariantFileMap

    /// Column layout specification
    @required
    columnLayout: ColumnLayout

    /// Parsing instructions
    @required
    parsing: ParsingSpec
}

/// Info file specification - the .info companion file containing execution metadata
structure InfoFileSpec {
    /// File suffix
    @required
    suffix: String

    /// File format
    @required
    format: String

    /// Contents of the info file
    @required
    contents: StringList
}

list StringList {
    member: String
}

/// Map of variant abbreviation to output file spec
map VariantFileMap {
    key: String
    value: VariantOutputFile
}

/// Output file specification for a single variant
structure VariantOutputFile {
    /// File suffix (e.g., "_ST", "_CD_DDA_ST")
    @required
    suffix: String

    /// File format description
    @required
    format: String

    /// Human-readable description
    @required
    description: String
}

/// Column layout in output files
structure ColumnLayout {
    /// Window bounds columns (always first 2 columns)
    @required
    windowBounds: WindowBoundsSpec

    /// Data columns specification by variant
    @required
    dataColumns: DataColumnsMap
}

/// Window bounds column specification
structure WindowBoundsSpec {
    /// Column positions (always 0 and 1)
    @required
    @length(min: 2, max: 2)
    positions: IntegerList

    /// Column type
    @required
    type: String

    /// Description
    @required
    description: String
}

/// Map of variant to data column specification
map DataColumnsMap {
    key: String
    value: DataColumnSpec
}

/// Data column specification for a variant
structure DataColumnSpec {
    /// Starting column position
    @required
    startPosition: Integer

    /// Column type
    @required
    type: String

    /// Stride (number of columns per channel/pair)
    @required
    @range(min: 1, max: 10)
    stride: Integer

    /// Description of column contents
    @required
    description: String

    /// Notes about interpreting the columns
    notes: StringList
}

/// Parsing specification - how to parse DDA output files
structure ParsingSpec {
    /// Standard parsing steps
    @required
    standardSteps: StringList

    /// Legacy parsing (for backward compatibility)
    @required
    legacySteps: StringList

    /// Legacy parsing warning
    @required
    legacyWarning: String

    /// Stride values by variant
    @required
    strideByVariant: StrideMap

    /// Result dimensions by variant
    @required
    resultDimensions: DimensionsMap
}

/// Map of variant abbreviation to stride
map StrideMap {
    key: String
    value: Integer
}

/// Map of variant to result dimensions
map DimensionsMap {
    key: String
    value: ResultDimensions
}

/// Result matrix dimensions
structure ResultDimensions {
    /// Row description (e.g., "Number of channels")
    @required
    rows: String

    /// Column description (e.g., "Number of time windows")
    @required
    cols: String
}

list IntegerList {
    member: Integer
}

/// Parsed DDA result structure
structure DDAResult {
    /// Variant that produced this result
    @required
    variant: String

    /// Window start indices
    @required
    windowStarts: IntegerList

    /// Window end indices
    @required
    windowEnds: IntegerList

    /// Coefficient data - shape depends on variant
    @required
    coefficients: FloatMatrix

    /// Error values (if applicable for variant)
    errors: FloatMatrix

    /// Number of channels/pairs
    @required
    numEntities: Integer

    /// Number of time windows
    @required
    numWindows: Integer
}

/// 2D matrix of floating point values
list FloatMatrix {
    member: FloatList
}

list FloatList {
    member: Float
}

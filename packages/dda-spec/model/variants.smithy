$version: "2.0"

namespace com.ddalab.variants

use com.ddalab.traits#ChannelFormat
use com.ddalab.traits#outputColumns
use com.ddalab.traits#variant

/// Single Timeseries DDA variant
/// Analyzes individual channels independently
@variant(
    abbreviation: "ST"
    position: 0
    outputSuffix: "_ST"
    stride: 4
    dependencies: []
    requiredParams: []
    reserved: false
)
@outputColumns(
    description: "4 columns per channel: a_1, a_2, a_3 coefficients + error"
    coefficients: 3
    hasError: true
)
structure SingleTimeseries {
    /// Channel format: individual channels (e.g., 1 2 3)
    channelFormat: ChannelFormat
}

/// Cross-Timeseries DDA variant
/// Analyzes relationships between channel pairs
@variant(
    abbreviation: "CT"
    position: 1
    outputSuffix: "_CT"
    stride: 4
    dependencies: []
    requiredParams: ["-WL_CT", "-WS_CT"]
    reserved: false
)
@outputColumns(description: "4 columns per pair: a_1, a_2, a_3 coefficients + error", coefficients: 3, hasError: true)
structure CrossTimeseries {
    /// Channel format: pairs (e.g., 1 2 for first pair)
    channelFormat: ChannelFormat
}

/// Cross-Dynamical DDA variant
/// Analyzes directed causal relationships between channels
@variant(
    abbreviation: "CD"
    position: 2
    outputSuffix: "_CD_DDA_ST"
    stride: 2
    dependencies: []
    requiredParams: ["-WL_CT", "-WS_CT"]
    reserved: false
)
@outputColumns(description: "2 columns per directed pair: a_1 coefficient + error", coefficients: 1, hasError: true)
structure CrossDynamical {
    /// Channel format: directed pairs as flat list (e.g., 1 2 1 3 2 3)
    channelFormat: ChannelFormat
}

/// Reserved internal variant (position 3)
/// Internal development function - should always be 0 in production
@variant(
    abbreviation: "RESERVED"
    position: 3
    outputSuffix: "_RESERVED"
    stride: 1
    dependencies: []
    requiredParams: []
    reserved: true
)
structure Reserved {}

/// Delay Embedding (Dynamical Ergodicity) variant
/// Analyzes dynamical ergodicity through delay embedding
@variant(
    abbreviation: "DE"
    position: 4
    outputSuffix: "_DE"
    stride: 1
    dependencies: []
    requiredParams: ["-WL_CT", "-WS_CT"]
    reserved: false
)
@outputColumns(description: "1 column: single ergodicity measure per time window", coefficients: 0, hasError: false)
structure DynamicalErgodicity {
    /// Channel format: individual channels
    channelFormat: ChannelFormat
}

/// Synchronization variant
/// Analyzes phase synchronization between signals
@variant(
    abbreviation: "SY"
    position: 5
    outputSuffix: "_SY"
    stride: 1
    dependencies: []
    requiredParams: []
    reserved: false
)
@outputColumns(
    description: "1 column per channel/measure: synchronization coefficient"
    coefficients: 0
    hasError: false
)
structure Synchronization {
    /// Channel format: individual channels or pairs
    channelFormat: ChannelFormat
}

/// Union of all DDA variants for type-safe variant handling
union DDAVariant {
    st: SingleTimeseries
    ct: CrossTimeseries
    cd: CrossDynamical
    reserved: Reserved
    de: DynamicalErgodicity
    sy: Synchronization
}

/// The SELECT mask - 6-bit array controlling which variants to run
/// Format: [ST, CT, CD, RESERVED, DE, SY]
@length(min: 6, max: 6)
list SelectMask {
    @range(min: 0, max: 1)
    member: Integer
}

/// Registry of all variants with their metadata
/// This is the canonical source for variant information
structure VariantRegistry {
    /// Spec version
    @required
    version: String

    /// Total number of positions in SELECT mask
    @required
    @range(min: 6, max: 6)
    maskSize: Integer

    /// Ordered list of variant abbreviations by position
    @required
    variantOrder: VariantOrderList
}

@length(min: 6, max: 6)
list VariantOrderList {
    member: String
}

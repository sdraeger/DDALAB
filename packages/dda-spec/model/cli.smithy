$version: "2.0"

namespace com.ddalab.cli

use com.ddalab.traits#cliFlag
use com.ddalab.traits#mutuallyExclusive
use com.ddalab.traits#numericRange
use com.ddalab.traits#Platform

/// Binary metadata and invocation details
structure BinaryMetadata {
    /// Name of the binary executable
    @required
    binaryName: String

    /// Whether binary requires shell wrapper (sh) on Unix
    @required
    requiresShellWrapper: Boolean

    /// Shell invocation command
    @required
    shellCommand: String

    /// Supported platforms
    @required
    supportedPlatforms: PlatformList
}

list PlatformList {
    member: Platform
}

/// Input file type specification
enum FileType {
    /// EDF/EDF+ files - European Data Format
    EDF

    /// Plain text numeric data (no headers)
    ASCII
}

/// Complete CLI argument specification
structure CLIArguments {
    /// Input file format (-EDF or -ASCII)
    @required
    @cliFlag(flag: "-EDF|-ASCII", required: true)
    @mutuallyExclusive(group: "fileType")
    fileType: FileType

    /// Path to input data file
    @required
    @cliFlag(flag: "-DATA_FN", required: true)
    dataFile: String

    /// Base path for output files (without extension)
    @required
    @cliFlag(flag: "-OUT_FN", required: true)
    outputFile: String

    /// List of channel indices (1-based)
    @required
    @cliFlag(flag: "-CH_list", required: true)
    channelList: IntegerList

    /// 6-bit mask selecting which variants to run
    @required
    @cliFlag(flag: "-SELECT", required: true)
    @length(min: 6, max: 6)
    selectMask: IntegerList

    /// DDA model encoding parameters
    @required
    @cliFlag(flag: "-MODEL", required: true)
    model: IntegerList

    /// Delay values (tau) to analyze
    @required
    @cliFlag(flag: "-TAU", required: true)
    delayValues: IntegerList

    /// Model dimension
    @cliFlag(flag: "-dm", required: false, defaultValue: "4")
    @numericRange(min: 2, max: 10)
    modelDimension: Integer

    /// Polynomial order
    @cliFlag(flag: "-order", required: false, defaultValue: "4")
    @numericRange(min: 2, max: 6)
    polynomialOrder: Integer

    /// Number of tau values in embedding
    @cliFlag(flag: "-nr_tau", required: false, defaultValue: "2")
    numTau: Integer

    /// Window length in samples
    @required
    @cliFlag(flag: "-WL", required: true)
    @numericRange(min: 64)
    windowLength: Integer

    /// Window step size in samples
    @required
    @cliFlag(flag: "-WS", required: true)
    @numericRange(min: 1)
    windowStep: Integer

    /// CT-specific window length
    @cliFlag(flag: "-WL_CT", required: false, defaultValue: "2", requiredFor: ["CT", "CD", "DE"])
    ctWindowLength: Integer

    /// CT-specific window step
    @cliFlag(flag: "-WS_CT", required: false, defaultValue: "2", requiredFor: ["CT", "CD", "DE"])
    ctWindowStep: Integer

    /// Start and end sample indices
    @cliFlag(flag: "-StartEnd", required: false)
    @length(min: 2, max: 2)
    timeBounds: IntegerList

    /// Sampling rate range for high-frequency data (> 1000 Hz)
    /// When input file sampling rate > 1000 Hz, this MUST be set to [SR/2, SR]
    /// where SR is the actual sampling rate of the input file.
    /// This enables proper frequency analysis within the DDA binary.
    /// Example: For 2048 Hz data, pass -SR 1024 2048
    @cliFlag(flag: "-SR", required: false)
    @length(min: 2, max: 2)
    samplingRateRange: IntegerList
}

list IntegerList {
    member: Integer
}

/// Scale parameters for generating delay values
structure ScaleParameters {
    /// Minimum scale value
    @required
    @range(min: 1)
    scaleMin: Integer

    /// Maximum scale value
    @required
    scaleMax: Integer

    /// Number of scale values to generate
    @required
    @range(min: 1)
    scaleNum: Integer
}

/// Validation rules that span multiple arguments
structure ValidationRules {
    /// windowLength must be >= max(delayValues) * modelDimension
    @required
    windowLengthConstraint: String

    /// windowStep must be <= windowLength
    @required
    windowStepConstraint: String

    /// timeBounds[0] < timeBounds[1] and within file bounds
    @required
    timeBoundsConstraint: String

    /// All channel indices must be valid for input file
    @required
    channelConstraint: String

    /// samplingRateRange must be provided when input sampling rate > 1000 Hz
    /// Values must be [SR/2, SR] where SR is the input file sampling rate
    @required
    samplingRateConstraint: String
}

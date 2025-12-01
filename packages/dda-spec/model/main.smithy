$version: "2.0"

namespace com.ddalab

use com.ddalab.cli#BinaryMetadata
use com.ddalab.cli#CLIArguments
use com.ddalab.cli#ValidationRules
use com.ddalab.output#OutputSpec
use com.ddalab.variants#VariantRegistry

/// DDA Specification - the complete canonical specification for
/// Delay Differential Analysis binary and wrapper implementations.
///
/// Version: 1.0.0
/// Last Updated: 2025-01-13
///
/// This specification defines:
/// - CLI interface and arguments
/// - Variant definitions and metadata
/// - Output file formats
/// - Parsing rules
/// - Validation constraints
///
/// Implementations in dda-rs (Rust), dda-py (Python), and
/// DelayDifferentialAnalysis.jl (Julia) must conform to this spec.
structure DDASpecification {
    /// Specification version
    @required
    version: String

    /// Binary metadata and invocation details
    @required
    binary: BinaryMetadata

    /// Variant registry with all available variants
    @required
    variants: VariantRegistry

    /// CLI argument specification
    @required
    cli: CLIArguments

    /// Output format specification
    @required
    output: OutputSpec

    /// Validation rules
    @required
    validation: ValidationRules

    /// Wrapper implementation guidelines
    @required
    wrapperGuidelines: WrapperGuidelines
}

/// Guidelines for implementing DDA wrappers
structure WrapperGuidelines {
    /// General principles
    @required
    generalPrinciples: PrincipleList

    /// Execution strategy for multiple variants
    @required
    executionStrategy: ExecutionStrategy

    /// Delay list generation rules
    @required
    delayGeneration: DelayGenerationRules

    /// Error handling requirements
    @required
    errorHandling: ErrorHandlingSpec
}

list PrincipleList {
    member: String
}

/// How to execute multiple variants efficiently
structure ExecutionStrategy {
    /// When single execution is appropriate
    @required
    singleExecutionConditions: PrincipleList

    /// When multi-execution is required
    @required
    multiExecutionConditions: PrincipleList

    /// Steps for multi-execution strategy
    @required
    multiExecutionSteps: ExecutionStepList
}

list ExecutionStepList {
    member: ExecutionStep
}

structure ExecutionStep {
    @required
    description: String

    condition: String

    @required
    selectMask: String

    @required
    channels: String
}

/// Rules for generating delay values
structure DelayGenerationRules {
    /// From explicit list
    @required
    explicitList: GenerationRule

    /// From scale parameters
    @required
    fromScaleParams: GenerationRule
}

structure GenerationRule {
    @required
    when: String

    @required
    approach: String

    example: String

    formula: String
}

/// Error handling specification
structure ErrorHandlingSpec {
    /// Binary not found error
    @required
    binaryNotFound: ErrorSpec

    /// Execution failed error
    @required
    executionFailed: ErrorSpec

    /// Output file not found error
    @required
    outputNotFound: ErrorSpec

    /// Parse error specification
    @required
    parseError: ErrorSpec
}

structure ErrorSpec {
    @required
    action: String

    @required
    message: String

    fallback: String
}

/// Test case specification for cross-implementation validation
structure TestCase {
    /// Test case name
    @required
    name: String

    /// Input file path
    @required
    inputFile: String

    /// Channels to analyze
    @required
    channels: IntegerList

    /// Time range [start, end] in seconds
    timeRange: FloatList

    /// SELECT mask
    @required
    selectMask: String

    /// Window parameters
    @required
    windowLength: Integer

    @required
    windowStep: Integer

    /// Scale parameters
    @required
    scaleMin: Float

    @required
    scaleMax: Float

    @required
    scaleNum: Integer

    /// Expected output description
    @required
    expectedOutput: String
}

list IntegerList {
    member: Integer
}

list FloatList {
    member: Float
}

/// Version compatibility information
structure VersionInfo {
    /// Current spec version
    @required
    specVersion: String

    /// Compatible binary version
    @required
    binaryVersion: String

    /// Breaking changes that require major version bump
    @required
    breakingChanges: PrincipleList

    /// Compatible changes for minor version bump
    @required
    compatibleChanges: PrincipleList
}

/// Implementation compliance status
enum ComplianceStatus {
    /// Fully compliant with spec
    COMPLIANT

    /// Partially compliant, some features missing
    PARTIAL

    /// Compliance validation pending
    PENDING

    /// Not compliant with spec
    NONCOMPLIANT
}

/// Per-implementation compliance tracking
structure ImplementationCompliance {
    /// Implementation name (e.g., "dda-rs", "dda-py")
    @required
    name: String

    /// Current version
    @required
    version: String

    /// Compliance status
    @required
    status: ComplianceStatus

    /// Notes about compliance
    notes: String
}

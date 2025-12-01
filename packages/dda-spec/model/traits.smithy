$version: "2.0"

namespace com.ddalab.traits

/// Marks a structure as a DDA variant with associated metadata
@trait(selector: "structure")
structure variant {
    /// Short abbreviation (e.g., "ST", "CT")
    @required
    abbreviation: String

    /// Position in the SELECT mask (0-5)
    @required
    position: Integer

    /// Output file suffix (e.g., "_ST", "_CD_DDA_ST")
    @required
    outputSuffix: String

    /// Column stride in output data
    @required
    stride: Integer

    /// List of variant abbreviations this depends on
    dependencies: DependencyList

    /// Required CLI parameters for this variant
    requiredParams: ParamList

    /// Whether this variant is reserved/internal
    reserved: Boolean
}

list DependencyList {
    member: String
}

list ParamList {
    member: String
}

/// Marks a member as a CLI flag/argument
@trait(selector: "member")
structure cliFlag {
    /// The CLI flag (e.g., "-DATA_FN", "-WL")
    @required
    flag: String

    /// Whether this flag is required
    required: Boolean

    /// Default value if not provided
    defaultValue: String

    /// Conditionally required based on variants
    requiredFor: RequiredForList
}

list RequiredForList {
    member: String
}

/// Marks mutually exclusive options
@trait(selector: "member")
structure mutuallyExclusive {
    /// Group name for mutually exclusive options
    @required
    group: String
}

/// Channel format specification
enum ChannelFormat {
    /// Individual channels: 1 2 3
    INDIVIDUAL

    /// Channel pairs: 1 2 (first pair)
    PAIRS

    /// Directed pairs as flat list: 1 2 1 3
    DIRECTED_PAIRS
}

/// Output data column specification
@trait(selector: "structure")
structure outputColumns {
    /// Description of what this column group contains
    @required
    description: String

    /// Number of coefficient columns
    @required
    coefficients: Integer

    /// Whether an error column is included
    @required
    hasError: Boolean
}

/// Validation constraint for numeric ranges
@trait(selector: "member")
structure numericRange {
    min: Integer
    max: Integer
    /// Typical/recommended values
    typical: TypicalList
}

list TypicalList {
    member: Integer
}

/// Platform enumeration
enum Platform {
    LINUX
    MACOS
    WINDOWS
}

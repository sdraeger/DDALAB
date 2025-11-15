"""
DDA Model Encoding Utilities

This module provides utilities for visualizing and decoding DDA MODEL parameter encodings
into their corresponding delay differential equation (DDE) representations.

The MODEL parameter encodes which polynomial terms to include in the DDE model.
For a given number of delays and polynomial order, all possible monomials are enumerated
and assigned 1-based indices. The MODEL encoding then selects specific monomials by index.

Example:
    For 2 delays and polynomial order 2, the monomial space is:
    - Index 1: [0, 1] → x₁ (linear term in first delay)
    - Index 2: [0, 2] → x₂ (linear term in second delay)
    - Index 3: [1, 1] → x₁² (quadratic term)
    - Index 4: [1, 2] → x₁·x₂ (cross term)
    - Index 5: [2, 2] → x₂² (quadratic term)

    Model encoding [1, 3, 5] represents: ẋ = a₁x₁ + a₂x₁² + a₃x₂²
"""

from typing import List, Tuple
from itertools import combinations_with_replacement
from collections import Counter


def generate_monomials(num_delays: int, polynomial_order: int) -> List[Tuple[int, ...]]:
    """Generate all monomial encodings for DDA model space.

    Generates monomials in canonical order: linear terms first (degree 1),
    then higher degree terms in lexicographic order.

    Args:
        num_delays: Number of delay values (tau values)
        polynomial_order: Maximum polynomial degree

    Returns:
        List of tuples representing monomials in canonical order.
        Linear terms are encoded as (0, j) where j is the delay index.
        Higher order terms are encoded as tuples of delay indices.

    Example:
        >>> generate_monomials(2, 2)
        [(0, 1), (0, 2), (1, 1), (1, 2), (2, 2)]
    """
    monomials = []

    # Degree 1: Linear terms [0, j] for j in 1..num_delays
    for j in range(1, num_delays + 1):
        monomials.append((0, j))

    # Degrees 2 to polynomial_order: All non-decreasing sequences
    for degree in range(2, polynomial_order + 1):
        for combo in combinations_with_replacement(range(1, num_delays + 1), degree):
            monomials.append(combo)

    return monomials


def monomial_to_latex(monomial: Tuple[int, ...], tau_values: List[float] = None) -> str:
    """Convert a monomial encoding to LaTeX representation.

    Args:
        monomial: Tuple of indices representing the monomial
        tau_values: Optional list of delay values to include in notation

    Returns:
        LaTeX string representation

    Example:
        >>> monomial_to_latex((0, 1))
        'x_1'
        >>> monomial_to_latex((1, 1))
        'x_1^2'
        >>> monomial_to_latex((1, 2))
        'x_1 x_2'
    """
    if len(monomial) == 2 and monomial[0] == 0:
        # Linear term [0, j] → x_j
        delay_idx = monomial[1]
        if tau_values is not None and delay_idx <= len(tau_values):
            tau = tau_values[delay_idx - 1]
            return f"x(t - {tau})"
        return f"x_{{{delay_idx}}}"

    # Higher order terms: count occurrences of each index
    counts = Counter(monomial)

    terms = []
    for idx in sorted(counts.keys()):
        if tau_values is not None and idx <= len(tau_values):
            tau = tau_values[idx - 1]
            if counts[idx] == 1:
                terms.append(f"x(t - {tau})")
            else:
                terms.append(f"x(t - {tau})^{{{counts[idx]}}}")
        else:
            if counts[idx] == 1:
                terms.append(f"x_{{{idx}}}")
            else:
                terms.append(f"x_{{{idx}}}^{{{counts[idx]}}}")

    return " ".join(terms)


def monomial_to_text(monomial: Tuple[int, ...], tau_values: List[float] = None) -> str:
    """Convert a monomial encoding to plain text representation.

    Args:
        monomial: Tuple of indices representing the monomial
        tau_values: Optional list of delay values to include in notation

    Returns:
        Plain text string representation

    Example:
        >>> monomial_to_text((0, 1))
        'x_1'
        >>> monomial_to_text((1, 1))
        'x_1^2'
        >>> monomial_to_text((1, 2))
        'x_1 * x_2'
    """
    if len(monomial) == 2 and monomial[0] == 0:
        # Linear term [0, j] → x_j
        delay_idx = monomial[1]
        if tau_values is not None and delay_idx <= len(tau_values):
            tau = tau_values[delay_idx - 1]
            return f"x(t - {tau})"
        return f"x_{delay_idx}"

    # Higher order terms: count occurrences of each index
    counts = Counter(monomial)

    terms = []
    for idx in sorted(counts.keys()):
        if tau_values is not None and idx <= len(tau_values):
            tau = tau_values[idx - 1]
            if counts[idx] == 1:
                terms.append(f"x(t - {tau})")
            else:
                terms.append(f"x(t - {tau})^{counts[idx]}")
        else:
            if counts[idx] == 1:
                terms.append(f"x_{idx}")
            else:
                terms.append(f"x_{idx}^{counts[idx]}")

    return " * ".join(terms)


def decode_model_encoding(
    model_encoding: List[int],
    num_delays: int,
    polynomial_order: int,
    tau_values: List[float] = None,
    format: str = "latex"
) -> str:
    """Decode a MODEL parameter into its DDE representation.

    Args:
        model_encoding: List of 1-based indices selecting monomials (e.g., [1, 3, 5])
        num_delays: Number of delay values
        polynomial_order: Maximum polynomial degree
        tau_values: Optional list of actual tau values to include in notation
        format: Output format ("latex" or "text")

    Returns:
        String representation of the DDE equation

    Raises:
        ValueError: If any index in model_encoding is out of range

    Example:
        >>> decode_model_encoding([1, 3, 5], 2, 2, format="text")
        'dx/dt = a_1 x_1 + a_2 x_1^2 + a_3 x_2^2'
    """
    # Generate all monomials in canonical order
    monomials = generate_monomials(num_delays, polynomial_order)

    # Validate and build equation terms
    terms = []
    for coeff_idx, monomial_idx in enumerate(model_encoding, start=1):
        if monomial_idx < 1 or monomial_idx > len(monomials):
            raise ValueError(
                f"Invalid model index {monomial_idx}. "
                f"Must be in range [1, {len(monomials)}]"
            )

        monomial = monomials[monomial_idx - 1]  # Convert to 0-based indexing

        if format == "latex":
            coeff_str = f"a_{{{coeff_idx}}}"
            term_str = monomial_to_latex(monomial, tau_values)
            terms.append(f"{coeff_str} {term_str}")
        else:
            coeff_str = f"a_{coeff_idx}"
            term_str = monomial_to_text(monomial, tau_values)
            terms.append(f"{coeff_str} {term_str}")

    equation = " + ".join(terms)

    if format == "latex":
        return f"\\dot{{x}} = {equation}"
    else:
        return f"dx/dt = {equation}"


def visualize_model_space(
    num_delays: int,
    polynomial_order: int,
    tau_values: List[float] = None,
    highlight_encoding: List[int] = None
) -> str:
    """Visualize the complete model space with all available monomials.

    Args:
        num_delays: Number of delay values
        polynomial_order: Maximum polynomial degree
        tau_values: Optional list of actual tau values to include in output
        highlight_encoding: Optional model encoding to highlight selected terms

    Returns:
        Formatted string showing all monomials with their indices

    Example:
        >>> print(visualize_model_space(2, 2))
        Model Space: 2 delays, order 2
        Total monomials: 5

        Index | Encoding | Term
        ------|----------|-----
            1 | [0, 1]   | x_1
            2 | [0, 2]   | x_2
            3 | [1, 1]   | x_1^2
            4 | [1, 2]   | x_1 * x_2
            5 | [2, 2]   | x_2^2
    """
    monomials = generate_monomials(num_delays, polynomial_order)

    header_parts = [f"Model Space: {num_delays} delays, order {polynomial_order}"]
    if tau_values:
        tau_str = ", ".join(f"τ_{i+1}={v}" for i, v in enumerate(tau_values))
        header_parts.append(f"Delays: {tau_str}")
    header_parts.append(f"Total monomials: {len(monomials)}")

    lines = header_parts + [
        "",
        "Index | Encoding    | Term",
        "------|-------------|---------------------"
    ]

    highlight_set = set(highlight_encoding) if highlight_encoding else set()

    for idx, monomial in enumerate(monomials, start=1):
        encoding_str = str(list(monomial))
        term_str = monomial_to_text(monomial, tau_values)

        marker = " *" if idx in highlight_set else "  "
        lines.append(f"{marker}{idx:4d} | {encoding_str:11s} | {term_str}")

    if highlight_encoding:
        lines.extend([
            "",
            f"Selected terms (marked with *): {highlight_encoding}",
            decode_model_encoding(
                highlight_encoding,
                num_delays,
                polynomial_order,
                tau_values,
                format="text"
            )
        ])

    return "\n".join(lines)


def model_encoding_to_dict(
    model_encoding: List[int],
    num_delays: int,
    polynomial_order: int,
    tau_values: List[float] = None
) -> dict:
    """Convert model encoding to structured dictionary representation.

    Useful for API responses or JSON serialization.

    Args:
        model_encoding: List of 1-based indices
        num_delays: Number of delay values
        polynomial_order: Maximum polynomial degree
        tau_values: Optional list of actual tau values

    Returns:
        Dictionary with equation details

    Example:
        >>> model_encoding_to_dict([1, 3, 5], 2, 2)
        {
            'equation_latex': '\\dot{x} = a_1 x_1 + a_2 x_1^2 + a_3 x_2^2',
            'equation_text': 'dx/dt = a_1 x_1 + a_2 x_1^2 + a_3 x_2^2',
            'num_terms': 3,
            'terms': [
                {'coefficient': 'a_1', 'monomial': [0, 1], 'term_text': 'x_1'},
                {'coefficient': 'a_2', 'monomial': [1, 1], 'term_text': 'x_1^2'},
                {'coefficient': 'a_3', 'monomial': [2, 2], 'term_text': 'x_2^2'}
            ]
        }
    """
    monomials = generate_monomials(num_delays, polynomial_order)

    terms = []
    for coeff_idx, monomial_idx in enumerate(model_encoding, start=1):
        if monomial_idx < 1 or monomial_idx > len(monomials):
            raise ValueError(f"Invalid model index {monomial_idx}")

        monomial = monomials[monomial_idx - 1]

        terms.append({
            'coefficient': f'a_{coeff_idx}',
            'monomial_index': monomial_idx,
            'monomial': list(monomial),
            'term_text': monomial_to_text(monomial, tau_values),
            'term_latex': monomial_to_latex(monomial, tau_values)
        })

    return {
        'equation_latex': decode_model_encoding(
            model_encoding, num_delays, polynomial_order, tau_values, format="latex"
        ),
        'equation_text': decode_model_encoding(
            model_encoding, num_delays, polynomial_order, tau_values, format="text"
        ),
        'num_delays': num_delays,
        'polynomial_order': polynomial_order,
        'tau_values': tau_values,
        'num_terms': len(terms),
        'terms': terms
    }


# CLI interface for quick visualization
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: python -m dda_py.model_encoding <num_delays> <polynomial_order> [model_encoding...]")
        print("\nExample:")
        print("  python -m dda_py.model_encoding 2 2")
        print("  python -m dda_py.model_encoding 2 2 1 3 5")
        sys.exit(1)

    num_delays = int(sys.argv[1])
    poly_order = int(sys.argv[2])

    if len(sys.argv) > 3:
        # Decode specific model
        model_enc = [int(x) for x in sys.argv[3:]]
        print(visualize_model_space(num_delays, poly_order, highlight_encoding=model_enc))
    else:
        # Show full model space
        print(visualize_model_space(num_delays, poly_order))

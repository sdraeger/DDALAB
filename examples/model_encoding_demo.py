#!/usr/bin/env python3
"""
Model Encoding Demonstration

This script demonstrates the model encoding visualization utilities
for understanding DDA MODEL parameter encodings.
"""

import sys
import os

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'packages', 'dda-py', 'src'))

from dda_py.model_encoding import (
    visualize_model_space,
    decode_model_encoding,
    model_encoding_to_dict,
    generate_monomials,
)


def demo_basic():
    """Basic example: 2 delays, order 2"""
    print("=" * 70)
    print("EXAMPLE 1: Basic Model Space (2 delays, order 2)")
    print("=" * 70)
    print()
    print(visualize_model_space(num_delays=2, polynomial_order=2))
    print()


def demo_user_example():
    """User's example: [1, 3, 5] encoding"""
    print("=" * 70)
    print("EXAMPLE 2: User's Example - Model [1, 3, 5]")
    print("=" * 70)
    print()
    print(visualize_model_space(
        num_delays=2,
        polynomial_order=2,
        highlight_encoding=[1, 3, 5]
    ))
    print()


def demo_with_tau_values():
    """Example with actual tau values"""
    print("=" * 70)
    print("EXAMPLE 3: With Actual Tau Values")
    print("=" * 70)
    print()
    print(visualize_model_space(
        num_delays=2,
        polynomial_order=2,
        tau_values=[1.5, 2.0],
        highlight_encoding=[1, 3, 5]
    ))
    print()


def demo_higher_order():
    """Higher order example: 3 delays, order 3"""
    print("=" * 70)
    print("EXAMPLE 4: Higher Order Model (3 delays, order 3)")
    print("=" * 70)
    print()
    print(visualize_model_space(
        num_delays=3,
        polynomial_order=3,
        highlight_encoding=[1, 4, 10, 15]
    ))
    print()


def demo_latex_output():
    """Show LaTeX formatting"""
    print("=" * 70)
    print("EXAMPLE 5: LaTeX Output")
    print("=" * 70)
    print()

    equation_text = decode_model_encoding(
        model_encoding=[1, 3, 5],
        num_delays=2,
        polynomial_order=2,
        format="text"
    )

    equation_latex = decode_model_encoding(
        model_encoding=[1, 3, 5],
        num_delays=2,
        polynomial_order=2,
        format="latex"
    )

    print("Plain text format:")
    print(f"  {equation_text}")
    print()
    print("LaTeX format:")
    print(f"  {equation_latex}")
    print()


def demo_structured_output():
    """Show structured dictionary output"""
    print("=" * 70)
    print("EXAMPLE 6: Structured Dictionary Output")
    print("=" * 70)
    print()

    result = model_encoding_to_dict(
        model_encoding=[1, 3, 5],
        num_delays=2,
        polynomial_order=2,
        tau_values=[1.0, 2.0]
    )

    import json
    print(json.dumps(result, indent=2))
    print()


def demo_model_space_sizes():
    """Show how model space grows"""
    print("=" * 70)
    print("EXAMPLE 7: Model Space Growth")
    print("=" * 70)
    print()
    print("Number of monomials for different configurations:")
    print()
    print("Delays | Order | Monomials")
    print("-------|-------|----------")

    configs = [
        (2, 1), (2, 2), (2, 3), (2, 4),
        (3, 1), (3, 2), (3, 3),
        (4, 1), (4, 2),
        (5, 1), (5, 2),
    ]

    for num_delays, poly_order in configs:
        monomials = generate_monomials(num_delays, poly_order)
        print(f"   {num_delays}   |   {poly_order}   |   {len(monomials)}")

    print()


def demo_common_models():
    """Show common model encodings"""
    print("=" * 70)
    print("EXAMPLE 8: Common Model Encodings")
    print("=" * 70)
    print()

    models = [
        ("Linear (2 delays)", [1, 2], 2, 2),
        ("Linear (3 delays)", [1, 2, 3], 3, 2),
        ("Quadratic diagonal", [1, 2, 3, 5], 2, 2),
        ("Full quadratic", [1, 2, 3, 4, 5], 2, 2),
        ("Selected nonlinear", [1, 3, 5], 2, 2),
    ]

    for name, encoding, delays, order in models:
        eq = decode_model_encoding(encoding, delays, order, format="text")
        print(f"{name}:")
        print(f"  Encoding: {encoding}")
        print(f"  Equation: {eq}")
        print()


def main():
    """Run all demonstrations"""
    demos = [
        demo_basic,
        demo_user_example,
        demo_with_tau_values,
        demo_higher_order,
        demo_latex_output,
        demo_structured_output,
        demo_model_space_sizes,
        demo_common_models,
    ]

    for i, demo in enumerate(demos, 1):
        demo()
        if i < len(demos):
            print("\n")

    print("=" * 70)
    print("For more information, see MODEL_ENCODING.md")
    print("=" * 70)


if __name__ == "__main__":
    main()

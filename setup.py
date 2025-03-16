#!/usr/bin/env python3
"""Setup script for DDALAB."""

from setuptools import find_packages, setup

setup(
    name="ddalab",
    version="0.1.0",
    packages=find_packages(
        include=["ddalab", "ddalab.*", "server", "server.*", "tests", "tests.*"]
    ),
    python_requires=">=3.11",
)

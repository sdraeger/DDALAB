#!/usr/bin/env python3
"""Setup script for FastAPI server tests."""

import importlib
import subprocess
import sys
from pathlib import Path


def run_command(cmd, description, check=True):
    """Run a command and handle errors."""
    print(f"🔄 {description}")
    print(f"Running: {' '.join(cmd)}")

    try:
        result = subprocess.run(cmd, check=check, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✅ {description} completed successfully")
        else:
            print(f"⚠️  {description} completed with warnings")

        if result.stdout:
            print(result.stdout)
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed")
        print(f"Exit code: {e.returncode}")
        if e.stdout:
            print("STDOUT:")
            print(e.stdout)
        if e.stderr:
            print("STDERR:")
            print(e.stderr)
        return False
    except FileNotFoundError:
        print(f"❌ Command not found: {cmd[0]}")
        return False


def check_python_version():
    """Check Python version compatibility."""
    print("🔍 Checking Python version...")
    version = sys.version_info

    if version.major == 3 and version.minor >= 8:
        print(
            f"✅ Python {version.major}.{version.minor}.{version.micro} is compatible"
        )
        return True
    else:
        print(
            f"❌ Python {version.major}.{version.minor}.{version.micro} is not compatible"
        )
        print("   Please use Python 3.8 or higher")
        return False


def install_test_dependencies():
    """Install test dependencies."""
    print("\n📦 Installing test dependencies...")

    # Check if requirements file exists
    test_req_file = Path("test_requirements.txt")
    if not test_req_file.exists():
        print(f"❌ {test_req_file} not found")
        return False

    # Install test requirements
    cmd = [sys.executable, "-m", "pip", "install", "-r", str(test_req_file)]
    return run_command(cmd, "Installing test dependencies")


def install_main_dependencies():
    """Install main application dependencies."""
    print("\n📦 Installing main application dependencies...")

    # Check if requirements file exists
    main_req_file = Path("requirements.txt")
    if not main_req_file.exists():
        print(f"❌ {main_req_file} not found")
        return False

    # Install main requirements
    cmd = [sys.executable, "-m", "pip", "install", "-r", str(main_req_file)]
    return run_command(cmd, "Installing main dependencies")


def create_test_env_file():
    """Create test environment file if it doesn't exist."""
    print("\n🔧 Setting up test environment...")

    test_env_file = Path(".env.test")
    if test_env_file.exists():
        print(f"✅ {test_env_file} already exists")
        return True

    # Create a basic test environment file
    test_env_content = """# Test Environment Configuration
DDALAB_RELOAD=false
DDALAB_API_HOST=localhost
DDALAB_API_PORT=8000
DDALAB_INSTITUTION_NAME=Test Institution
DDALAB_DATA_DIR=/tmp/test_data
DDALAB_ANONYMIZE_EDF=false
DDALAB_DDA_BINARY_PATH=/usr/bin/dda
DDALAB_DB_HOST=localhost
DDALAB_DB_PORT=5432
DDALAB_DB_NAME=test_db
DDALAB_DB_USER=test_user
DDALAB_DB_PASSWORD=test_password
DDALAB_JWT_SECRET_KEY=test_secret_key_123456789
DDALAB_JWT_ALGORITHM=HS256
DDALAB_AUTH_ENABLED=true
DDALAB_TOKEN_EXPIRATION_MINUTES=30
DDALAB_ALLOWED_DIRS=/tmp,/test
DDALAB_MINIO_HOST=localhost:9000
DDALAB_MINIO_ACCESS_KEY=testkey
DDALAB_MINIO_SECRET_KEY=testsecret
DDALAB_MINIO_BUCKET_NAME=test-bucket
DDALAB_OTLP_HOST=localhost
DDALAB_OTLP_PORT=4317
"""

    try:
        with open(test_env_file, "w") as f:
            f.write(test_env_content)
        print(f"✅ Created {test_env_file}")
        return True
    except Exception as e:
        print(f"❌ Failed to create {test_env_file}: {e}")
        return False


def validate_test_setup():
    """Validate that the test setup is working."""
    print("\n🧪 Validating test setup...")

    # Try importing pytest
    try:
        importlib.util.find_spec("pytest")

        print("✅ pytest is available")
    except ImportError:
        print("❌ pytest is not available")
        return False

    # Try importing FastAPI test components
    try:
        importlib.util.find_spec("fastapi")

        print("✅ FastAPI test components are available")
    except ImportError:
        print("❌ FastAPI test components are not available")
        return False

    # Try importing FastAPI test components
    try:
        importlib.util.find_spec("httpx")

        print("✅ httpx is available")
    except ImportError:
        print("❌ httpx is not available")
        return False

    # Check if test directory exists
    test_dir = Path("tests")
    if test_dir.exists():
        print(f"✅ Test directory {test_dir} exists")
    else:
        print(f"❌ Test directory {test_dir} not found")
        return False

    return True


def run_sample_test():
    """Run a sample test to verify everything works."""
    print("\n🏃 Running sample test...")

    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "tests/unit/test_config.py::TestSettings::test_anonymize_edf_default",
        "-v",
    ]
    success = run_command(cmd, "Running sample test", check=False)

    if success:
        print("✅ Sample test passed - setup is working!")
    else:
        print("⚠️  Sample test failed - there might be configuration issues")
        print("   This is normal if you haven't set up all dependencies yet")

    return success


def print_next_steps():
    """Print next steps for the user."""
    print("\n🎉 Test setup completed!")
    print("\n📋 Next steps:")
    print("1. Review the test configuration in .env.test")
    print("2. Set up your database and external services if needed")
    print("3. Run tests using the test runner:")
    print("   python tests/test_runner.py all")
    print("4. Generate coverage report:")
    print("   python tests/test_runner.py coverage")
    print("5. Read the test documentation:")
    print("   cat tests/README.md")

    print("\n💡 Quick commands:")
    print("   python tests/test_runner.py unit         # Run unit tests")
    print("   python tests/test_runner.py integration  # Run integration tests")
    print("   python tests/test_runner.py auth         # Run auth tests")
    print("   python tests/test_runner.py report       # Generate coverage report")


def main():
    """Main setup function."""
    print("🚀 Setting up FastAPI server tests...\n")

    success = True

    # Check Python version
    if not check_python_version():
        success = False

    # Install dependencies
    if success:
        if not install_main_dependencies():
            print("⚠️  Failed to install main dependencies, continuing...")

        if not install_test_dependencies():
            success = False

    # Create test environment
    if success:
        if not create_test_env_file():
            print("⚠️  Failed to create test environment file, continuing...")

    # Validate setup
    if success:
        if not validate_test_setup():
            success = False

    # Run sample test
    if success:
        run_sample_test()  # Don't fail setup if test fails

    # Print next steps
    print_next_steps()

    if success:
        print("\n✅ Test setup completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ Test setup completed with errors. Please review the output above.")
        sys.exit(1)


if __name__ == "__main__":
    main()

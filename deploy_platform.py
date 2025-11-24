#!/usr/bin/env python3
"""
Platform-aware deployment script
Detects platform and copies correct .so files
"""

import platform
import sys
import shutil
from pathlib import Path

def detect_platform():
    """Detect current platform"""
    machine = platform.machine().lower()
    system = platform.system().lower()

    if system != 'linux':
        return None

    if machine in ['x86_64', 'amd64']:
        return 'x86_64'
    elif machine in ['aarch64', 'arm64']:
        return 'aarch64'
    elif machine in ['armv7l', 'armv6l']:
        return 'armv7l'

    return None

def main():
    print("="*60)
    print("Platform Detection & Deployment")
    print("="*60)

    platform_type = detect_platform()

    if not platform_type:
        print(f"❌ Unsupported platform: {platform.machine()}")
        sys.exit(1)

    print(f"✅ Detected platform: {platform_type}")
    print(f"   Python version: {sys.version_info.major}.{sys.version_info.minor}")

    # Look for platform-specific dist folder
    dist_source = Path(f"dist_{platform_type}")
    dist_target = Path("dist")

    if not dist_source.exists():
        print(f"\n❌ ERROR: {dist_source} not found!")
        print(f"\nAvailable dist folders:")
        for d in Path(".").glob("dist_*"):
            print(f"   • {d}")
        print(f"\nPlease build for {platform_type} first:")
        print(f"   python3 build_obfuscate.py")
        print(f"   mv dist dist_{platform_type}")
        sys.exit(1)

    # Copy platform-specific files to dist/
    print(f"\n📦 Copying {dist_source} → {dist_target}")

    if dist_target.exists():
        shutil.rmtree(dist_target)

    shutil.copytree(dist_source, dist_target)

    print("✅ Deployment ready!")
    print(f"\nYou can now run:")
    print(f"   python3 start.py")

if __name__ == '__main__':
    main()

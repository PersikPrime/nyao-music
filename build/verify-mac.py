"""Verify signed macOS app/helper entitlements before uploading the DMGs."""
import pathlib
import plistlib
import subprocess
import sys

REQUIRED = ("com.apple.security.cs.allow-jit",
            "com.apple.security.cs.disable-library-validation")

def verify(root):
    apps = list(pathlib.Path(root).glob("*.app"))
    if len(apps) != 1:
        raise RuntimeError(f"{root}: expected exactly one packaged .app")
    app = apps[0]
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    bundles = [app] + list((app / "Contents" / "Frameworks").rglob("*.app"))
    for bundle in bundles:
        result = subprocess.run(
            ["codesign", "-d", "--entitlements", ":-", str(bundle)],
            check=True, capture_output=True)
        # codesign writes diagnostics to stderr; plist output varies by OS version.
        data = result.stdout + result.stderr
        start = data.find(b"<?xml")
        end = data.find(b"</plist>", start)
        if start < 0 or end < 0:
            raise RuntimeError(f"{bundle}: no signed entitlement plist")
        entitlements = plistlib.loads(data[start:end + len(b"</plist>")])
        for key in REQUIRED:
            if entitlements.get(key) is not True:
                raise RuntimeError(f"{bundle}: missing signed entitlement {key}")
        print(f"Verified code signature and Widevine entitlements: {bundle}", flush=True)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: verify-mac.py PACKAGE_DIR [PACKAGE_DIR ...]")
    for directory in sys.argv[1:]:
        verify(directory)

#!/usr/bin/env bash
set -euo pipefail

CALLER_PWD="$PWD"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

IMAGE="tide-times-android:1"
CACHE_DIR="$ROOT/.cache"
GRADLE_CACHE="$CACHE_DIR/gradle"
NPM_CACHE="$CACHE_DIR/npm"
ANDROID_HOME_CACHE="$CACHE_DIR/android-home"
OUT_DIR="$ROOT/build/apk"
RELEASE_PROPS_DIR="$ROOT/build/release"
CONTAINER_KEYSTORE="/release/release.keystore"

MODE="debug"
KEYSTORE=""
PROPERTIES=""
CLEAN=false
RELEASE_APK=""

usage() {
  cat >&2 <<'EOF'
Usage: ./build-android.sh [--release --keystore <file> --properties <file>] [--clean]

Builds the tide-times Android APK inside Docker.

  (no flags)        Build the debug APK (default)
  --release         Build a signed release APK. Requires --keystore and
                    --properties.
  --keystore FILE   Android signing key (.keystore/.jks) used for release
  --properties FILE keystore.properties with storePassword, keyAlias and
                    keyPassword. Its storeFile is rewritten to the keystore's
                    path inside the container.
  --clean           Regenerate the native android/ project before building
  -h, --help        Show this help

Examples:
  ./build-android.sh
  ./build-android.sh --release \
    --keystore android/keystores/release.keystore \
    --properties android/keystore.properties
EOF
  exit 1
}

abspath() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$CALLER_PWD" "$1" ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --release) MODE="release"; shift ;;
    --keystore)
      [ $# -ge 2 ] || { echo "error: --keystore needs a value" >&2; usage; }
      KEYSTORE="$(abspath "$2")"; shift 2 ;;
    --properties)
      [ $# -ge 2 ] || { echo "error: --properties needs a value" >&2; usage; }
      PROPERTIES="$(abspath "$2")"; shift 2 ;;
    --clean) CLEAN=true; shift ;;
    -h|--help) usage ;;
    *) echo "error: unknown argument: $1" >&2; usage ;;
  esac
done

if [ "$MODE" = "release" ]; then
  if [ -z "$KEYSTORE" ] || [ -z "$PROPERTIES" ]; then
    echo "error: --release requires --keystore and --properties" >&2
    usage
  fi
  [ -f "$KEYSTORE" ] || { echo "error: keystore not found: $KEYSTORE" >&2; exit 1; }
  [ -f "$PROPERTIES" ] || { echo "error: properties file not found: $PROPERTIES" >&2; exit 1; }

  mkdir -p "$RELEASE_PROPS_DIR"
  awk -v container_path="$CONTAINER_KEYSTORE" '
    BEGIN { replaced = 0 }
    /^[[:space:]]*storeFile[[:space:]]*=/ {
      print "storeFile=" container_path
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print "storeFile=" container_path }
  ' "$PROPERTIES" > "$RELEASE_PROPS_DIR/keystore.properties"

  if ! grep -qE '^[[:space:]]*storePassword[[:space:]]*=' "$RELEASE_PROPS_DIR/keystore.properties"; then
    echo "warning: $PROPERTIES has no storePassword entry" >&2
  fi
  if ! grep -qE '^[[:space:]]*keyAlias[[:space:]]*=' "$RELEASE_PROPS_DIR/keystore.properties"; then
    echo "warning: $PROPERTIES has no keyAlias entry" >&2
  fi
  if ! grep -qE '^[[:space:]]*keyPassword[[:space:]]*=' "$RELEASE_PROPS_DIR/keystore.properties"; then
    echo "warning: $PROPERTIES has no keyPassword entry" >&2
  fi
fi

if ! command -v docker > /dev/null 2>&1; then
  echo "error: docker is required but was not found on PATH" >&2
  exit 1
fi

# Rootless Docker already maps container root to the host user, so files it
# writes into the bind mount are host-owned. Rootful Docker does not, so run as
# the calling user there to keep generated files host-owned.
DOCKER_UID_ARGS=()
if ! docker info --format '{{join .SecurityOptions ","}}' 2>/dev/null | grep -qi rootless; then
  DOCKER_UID_ARGS=(--user "$(id -u):$(id -g)")
fi

echo "==> Building docker image: $IMAGE"
docker build -f "$ROOT/Dockerfile.android" -t "$IMAGE" "$ROOT"

mkdir -p "$GRADLE_CACHE" "$NPM_CACHE" "$ANDROID_HOME_CACHE"

DOCKER_ARGS=(
  run --rm
  "${DOCKER_UID_ARGS[@]}"
  -v "$ROOT:/workspace"
  -v "$GRADLE_CACHE:/opt/gradle-cache"
  -v "$NPM_CACHE:/opt/npm-cache"
  -v "$ANDROID_HOME_CACHE:/opt/android-home"
  -w /workspace
  -e HOME=/tmp
  -e CI=1
)

PREPARE=""
GRADLE_TASKS="assembleDebug"
if [ "$MODE" = "release" ]; then
  DOCKER_ARGS+=(-v "$KEYSTORE:$CONTAINER_KEYSTORE:ro")
  PREPARE="cp /workspace/build/release/keystore.properties android/keystore.properties
node /workspace/scripts/patch-release-signing.js"
  GRADLE_TASKS="assembleRelease"
fi

CLEAN_CMD=""
if [ "$CLEAN" = true ]; then
  CLEAN_CMD="rm -rf android"
fi

echo "==> Running expo prebuild and Gradle ($MODE)"
docker "${DOCKER_ARGS[@]}" "$IMAGE" /bin/bash -lc "
set -e
[ -d node_modules ] || npm ci
$CLEAN_CMD
npx expo prebuild --platform android --no-install
$PREPARE
cd android
./gradlew $GRADLE_TASKS
"

mkdir -p "$OUT_DIR"

if [ "$MODE" = "release" ]; then
  APK="android/app/build/outputs/apk/release/app-release.apk"
  UNSIGNED_APK="android/app/build/outputs/apk/release/app-release-unsigned.apk"
  if [ -f "$APK" ]; then
    cp "$APK" "$OUT_DIR/"
    RELEASE_APK="$OUT_DIR/app-release.apk"
  elif [ -f "$UNSIGNED_APK" ]; then
    cp "$UNSIGNED_APK" "$OUT_DIR/"
    RELEASE_APK="$OUT_DIR/app-release-unsigned.apk"
    echo "warning: release APK is unsigned; check the keystore configuration" >&2
  else
    echo "error: release APK not found" >&2
    exit 1
  fi
else
  APK="android/app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$APK" ]; then
    cp "$APK" "$OUT_DIR/"
  else
    echo "error: debug APK not found at $APK" >&2
    exit 1
  fi
fi

echo ""
echo "==> APKs written to $OUT_DIR"
ls -lh "$OUT_DIR"

if [ "$MODE" = "release" ] && [ -f "$RELEASE_APK" ]; then
  echo ""
  echo "==> Signing info for $(basename "$RELEASE_APK")"
  docker run --rm -v "$OUT_DIR:/apk:ro" "$IMAGE" /bin/bash -lc '
    APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
    if [ -z "$APKSIGNER" ]; then
      echo "error: apksigner not found in the image" >&2
      exit 1
    fi
    "$APKSIGNER" verify --verbose --print-certs "/apk/$1"
  ' _ "$(basename "$RELEASE_APK")" || {
    echo "warning: could not read APK signing info" >&2
  }
fi
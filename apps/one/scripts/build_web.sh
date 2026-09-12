#!/usr/bin/env bash
# apps/one/scripts/build_web.sh
#
# TASK 16.4 — reproducible, production-safe Flutter Web build for
# DigitalOcean App Platform's Static Site component (and for local/CI use
# with the identical command). DigitalOcean App Platform has no native
# Flutter buildpack — this script NEVER assumes `flutter` is already
# installed in the build image. If a `flutter` already on PATH reports
# exactly the pinned version below, it is reused as-is (keeps local/dev
# runs fast); otherwise the exact pinned, checksum-verified Flutter SDK
# archive is downloaded into a cache directory and used instead. Never
# `flutter upgrade`, never "latest" — every build, on every machine, uses
# byte-for-byte the same toolchain.
#
# Usage (from anywhere — paths below are resolved relative to this
# script's own location, not the caller's working directory):
#   bash apps/one/scripts/build_web.sh
#
# This is exactly what lets a DigitalOcean Static Site component's own
# "Build Command" field just be `bash scripts/build_web.sh`, once that
# component's "Source Directory" is set to `apps/one` — see
# docs/DEPLOYMENT_PACKAGING.md for the full click-by-click DigitalOcean
# configuration this script is designed to be pasted into.
#
# Env vars (all optional). Every one already defaults to the REAL
# production value — this script can never silently fall back to
# localhost/dev, matching `AS_API_BASE_URL`'s own fail-fast
# HTTPS-outside-local check in
# apps/one/lib/core/config/app_config.dart:
#   AS_ENV               default: production
#   AS_API_BASE_URL      default: https://api.asone.mx
#   AS_APP_NAME           default: unset (Dart's own default "AS ONE" applies)
#   AS_ENABLE_TELEMETRY   default: unset (Dart's own default false applies)
#   FLUTTER_SDK_CACHE_DIR default: apps/one/.flutter-sdk-cache (gitignored)

set -euo pipefail

# --- pinned, checksum-verified Flutter SDK (never "latest") ----------------
# Confirmed live against Flutter's own official release manifest
# (https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json)
# at the time this was pinned: stable channel, Dart SDK 3.12.2 — matching
# this app's own pubspec.yaml constraint (`sdk: ^3.12.2`) exactly. Bump
# both FLUTTER_VERSION and FLUTTER_SHA256 together, from that same
# manifest, the next time the SDK is deliberately upgraded.
FLUTTER_VERSION="3.44.8"
FLUTTER_CHANNEL="stable"
FLUTTER_ARCHIVE="flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"
FLUTTER_URL="https://storage.googleapis.com/flutter_infra_release/releases/${FLUTTER_CHANNEL}/linux/${FLUTTER_ARCHIVE}"
FLUTTER_SHA256="672089e001571a9fbb209a495c583580c0c6c73ef98999264ba07fa93ace332d"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CACHE_DIR="${FLUTTER_SDK_CACHE_DIR:-${APP_DIR}/.flutter-sdk-cache}"
SDK_DIR="${CACHE_DIR}/flutter-${FLUTTER_VERSION}"

resolved_flutter_bin=""

# Reuse an already-installed `flutter` on PATH only if it is EXACTLY the
# pinned version — never a newer/older one silently substituted.
if command -v flutter >/dev/null 2>&1; then
  # `--machine` prints pretty-printed JSON (a space after each `:`) — the
  # earlier `grep -o '"frameworkVersion":"..."'` (no space in the pattern)
  # silently failed to match it and fell through to a fresh download every
  # time, even when the exact pinned version was already on PATH. Confirmed
  # empirically against this app's own installed Flutter 3.44.8.
  existing_version="$(flutter --version --machine 2>/dev/null \
    | grep -o '"frameworkVersion"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/' || true)"
  if [ "${existing_version}" = "${FLUTTER_VERSION}" ]; then
    resolved_flutter_bin="$(command -v flutter)"
    echo "Using already-installed Flutter ${FLUTTER_VERSION} on PATH."
  else
    echo "PATH has Flutter '${existing_version:-<unreadable>}', not the pinned ${FLUTTER_VERSION} — ignoring it."
  fi
fi

if [ -z "${resolved_flutter_bin}" ]; then
  if [ -x "${SDK_DIR}/flutter/bin/flutter" ]; then
    echo "Using cached pinned Flutter ${FLUTTER_VERSION} SDK at ${SDK_DIR}."
  else
    echo "Downloading pinned Flutter ${FLUTTER_VERSION} (${FLUTTER_CHANNEL}) from ${FLUTTER_URL} ..."
    mkdir -p "${CACHE_DIR}"
    tmp_archive="$(mktemp)"
    curl --fail --location --silent --show-error --output "${tmp_archive}" "${FLUTTER_URL}"
    computed_sha256="$(sha256sum "${tmp_archive}" | cut -d' ' -f1)"
    if [ "${computed_sha256}" != "${FLUTTER_SHA256}" ]; then
      echo "FATAL: downloaded Flutter SDK checksum mismatch — refusing to use it." >&2
      echo "  expected: ${FLUTTER_SHA256}" >&2
      echo "  actual:   ${computed_sha256}" >&2
      rm -f "${tmp_archive}"
      exit 1
    fi
    mkdir -p "${SDK_DIR}"
    tar -xJf "${tmp_archive}" -C "${SDK_DIR}"
    rm -f "${tmp_archive}"
  fi
  resolved_flutter_bin="${SDK_DIR}/flutter/bin/flutter"
fi

export PATH="$(cd "$(dirname "${resolved_flutter_bin}")" && pwd):${PATH}"

echo "--- flutter --version ---"
flutter --version
# Non-interactive build environments should never trigger an analytics
# consent prompt or phone-home network call.
flutter config --no-analytics >/dev/null

AS_ENV="${AS_ENV:-production}"
AS_API_BASE_URL="${AS_API_BASE_URL:-https://api.asone.mx}"

echo "--- flutter pub get ---"
(cd "${APP_DIR}" && flutter pub get)

echo "--- flutter build web (AS_ENV=${AS_ENV}, AS_API_BASE_URL=${AS_API_BASE_URL}) ---"
build_args=(
  build web
  --release
  --dart-define="AS_ENV=${AS_ENV}"
  --dart-define="AS_API_BASE_URL=${AS_API_BASE_URL}"
)
if [ -n "${AS_APP_NAME:-}" ]; then
  build_args+=(--dart-define="AS_APP_NAME=${AS_APP_NAME}")
fi
if [ -n "${AS_ENABLE_TELEMETRY:-}" ]; then
  build_args+=(--dart-define="AS_ENABLE_TELEMETRY=${AS_ENABLE_TELEMETRY}")
fi

(cd "${APP_DIR}" && flutter "${build_args[@]}")

echo "Build complete: ${APP_DIR}/build/web"

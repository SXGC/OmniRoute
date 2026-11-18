#!/usr/bin/env bash
# Build the fork's OmniRoute image and push it to Aliyun ACR.
#
# Builds the Dockerfile's default (last) stage, runner-cli, as omniroute:latest,
# tags it for ACR, pushes it, and checks that the remote digest matches the
# local image. Only the `latest` tag is pushed (AGENTS.md -> Fork image publishing).
#
# Usage:
#   scripts/docker/build-push-acr.sh            # build + push + verify
#   scripts/docker/build-push-acr.sh --no-push  # build only
#
# Env overrides (defaults in parentheses):
#   APT_MIRROR                 Debian mirror for apt (http://mirrors.aliyun.com)
#   OMNIROUTE_BUILD_WORKERS    Next.js page-data processes; workers = N-1 (6).
#                              Each Next process peaks at ~4.5 GB RSS, so keep
#                              N * 4.5 GB well under free memory.
#   NPM_REGISTRY               npm registry for the image build (unset = npmjs)
#   ACR_IMAGE                  remote image
#                              (registry.cn-hangzhou.aliyuncs.com/jct_image/omniroute:latest)
#   EXTRA_BUILD_ARGS           extra args appended to `docker build`
#
# Requires: docker with the buildx plugin (BuildKit), and `docker login
# registry.cn-hangzhou.aliyuncs.com` already done for the push.

set -euo pipefail

APT_MIRROR="${APT_MIRROR:-http://mirrors.aliyun.com}"
OMNIROUTE_BUILD_WORKERS="${OMNIROUTE_BUILD_WORKERS:-6}"
NPM_REGISTRY="${NPM_REGISTRY:-}"
ACR_IMAGE="${ACR_IMAGE:-registry.cn-hangzhou.aliyuncs.com/jct_image/omniroute:latest}"
LOCAL_IMAGE="omniroute:latest"

PUSH=1
for arg in "$@"; do
  case "$arg" in
    --no-push) PUSH=0 ;;
    -h | --help)
      sed -n '2,24p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

if ! docker buildx version >/dev/null 2>&1; then
  echo "docker buildx is missing; the Dockerfile needs BuildKit (RUN --mount)." >&2
  echo "Install it, e.g.: sudo apt-get install -y docker-buildx" >&2
  exit 1
fi

build_args=(
  --build-arg "APT_MIRROR=${APT_MIRROR}"
  --build-arg "OMNIROUTE_BUILD_WORKERS=${OMNIROUTE_BUILD_WORKERS}"
)
if [ -n "$NPM_REGISTRY" ]; then
  build_args+=(--build-arg "NPM_REGISTRY=${NPM_REGISTRY}")
fi

echo "==> building ${LOCAL_IMAGE} from $(git rev-parse --short HEAD)"
echo "    APT_MIRROR=${APT_MIRROR} OMNIROUTE_BUILD_WORKERS=${OMNIROUTE_BUILD_WORKERS}"
# shellcheck disable=SC2086 # EXTRA_BUILD_ARGS is intentionally word-split
DOCKER_BUILDKIT=1 docker build --progress=plain "${build_args[@]}" ${EXTRA_BUILD_ARGS:-} \
  -t "$LOCAL_IMAGE" .

if [ "$PUSH" -eq 0 ]; then
  echo "==> built ${LOCAL_IMAGE} (push skipped)"
  exit 0
fi

echo "==> pushing ${ACR_IMAGE}"
docker tag "$LOCAL_IMAGE" "$ACR_IMAGE"
docker push "$ACR_IMAGE"

repo="${ACR_IMAGE%:*}"
local_digest=$(docker image inspect "$LOCAL_IMAGE" --format '{{range .RepoDigests}}{{println .}}{{end}}' |
  grep "^${repo}@" | head -1 | cut -d@ -f2)
remote_digest=$(docker buildx imagetools inspect "$ACR_IMAGE" | awk '/^Digest:/ { print $2; exit }')

echo "    local:  ${local_digest:-<none>}"
echo "    remote: ${remote_digest}"
if [ -z "$local_digest" ] || [ "$local_digest" != "$remote_digest" ]; then
  echo "digest mismatch between local image and ${ACR_IMAGE}" >&2
  exit 1
fi
echo "==> pushed and verified ${ACR_IMAGE}@${remote_digest}"

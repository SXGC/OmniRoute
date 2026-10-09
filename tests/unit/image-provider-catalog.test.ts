import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_PROVIDERS } from "../../open-sse/config/imageProviderCatalog.ts";
import {
  IMAGE_PROVIDERS as RUNTIME_IMAGE_PROVIDERS,
  getImageProvider,
} from "../../open-sse/config/imageRegistry.ts";
import {
  removeFeatureFlagOverride,
  setFeatureFlagOverride,
} from "../../src/lib/db/featureFlags.ts";

test("runtime registry re-exports the shared static catalog without copying it", () => {
  assert.equal(RUNTIME_IMAGE_PROVIDERS, IMAGE_PROVIDERS);
  assert.equal(IMAGE_PROVIDERS.xai.format, "openai");
  assert.equal(IMAGE_PROVIDERS["xai-oauth"], undefined);
});

test("DB subscription flag overrides remain server-side without mutating the static catalog", () => {
  const key = "GROK_SUBSCRIPTION_IMAGES_ENABLED";
  const previousEnv = process.env[key];
  process.env[key] = "false";
  try {
    setFeatureFlagOverride(key, "true");
    assert.equal(getImageProvider("xao")?.authType, "oauth");
    assert.equal(getImageProvider("gc")?.format, "xai-image");
    assert.equal(IMAGE_PROVIDERS["xai-oauth"], undefined);
    assert.equal(IMAGE_PROVIDERS.xai.format, "openai");

    setFeatureFlagOverride(key, "false");
    assert.equal(getImageProvider("xao"), null);
    assert.equal(getImageProvider("gc"), null);
    assert.equal(getImageProvider("xai"), IMAGE_PROVIDERS.xai);
  } finally {
    removeFeatureFlagOverride(key);
    if (previousEnv === undefined) delete process.env[key];
    else process.env[key] = previousEnv;
  }
});

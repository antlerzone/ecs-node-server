/**
 * SaaS platform Xendit Invoice webhook: expected X-CALLBACK-TOKEN from env.
 * Matches getPlatformXenditConfig() test/live (FORCE_PAYMENT_SANDBOX + XENDIT_PLATFORM_USE_TEST).
 */
function saasPlatformUseTest() {
  const forceDemo =
    process.env.FORCE_PAYMENT_SANDBOX === '1' || process.env.FORCE_PAYMENT_SANDBOX === 'true';
  return (
    forceDemo ||
    process.env.XENDIT_PLATFORM_USE_TEST === '1' ||
    process.env.XENDIT_PLATFORM_USE_TEST === 'true'
  );
}

function normalizeText(v) {
  return String(v || '').trim();
}

function getExpectedSaaSPlatformCallbackToken() {
  const useTest = saasPlatformUseTest();
  const legacy = normalizeText(process.env.XENDIT_SAAS_PLATFORM_CALLBACK_TOKEN);
  if (useTest) {
    return normalizeText(
      process.env.XENDIT_SAAS_PLATFORM_TEST_CALLBACK_TOKEN || legacy
    );
  }
  return normalizeText(process.env.XENDIT_SAAS_PLATFORM_LIVE_CALLBACK_TOKEN || legacy);
}

module.exports = {
  saasPlatformUseTest,
  getExpectedSaaSPlatformCallbackToken
};

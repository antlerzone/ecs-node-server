/**
 * Google / Facebook OAuth strategies for portal login.
 * Coliving: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET + PORTAL_AUTH_BASE_URL → …/api/portal-auth/google/callback
 * Cleanlemons: CLEANLEMON_GOOGLE_CLIENT_ID / CLEANLEMON_GOOGLE_CLIENT_SECRET + CLEANLEMON_PORTAL_AUTH_BASE_URL
 *   (default https://portal.cleanlemons.com when Nginx proxies /api/ on portal) — callback must match Google Cloud Console.
 * Also: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET.
 */
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const {
  findOrCreateByGoogle,
  findOrCreateByGoogleEnquiry,
  findOrCreateByGoogleCleanlemon,
  findOrCreateByFacebook,
  findOrCreateByFacebookEnquiry,
  findOrCreateByFacebookCleanlemon,
} = require('./portal-auth.service');

const baseUrl = process.env.PORTAL_AUTH_BASE_URL || '';
/** Cleanlemons：默认与 portal 同域（Nginx 将 portal 的 /api/ 反代到 Node），避免 api 子域证书未配时 ERR_CERT_COMMON_NAME_INVALID */
const cleanlemonPortalAuthBase = (
  process.env.CLEANLEMON_PORTAL_AUTH_BASE_URL || 'https://portal.cleanlemons.com'
).replace(/\/$/, '');

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  /**
   * Coliving Google：與 Google Console 登記的單一 callback `/api/portal-auth/google/callback` 一致。
   * OAuth state（base64 JSON）含 `enquiry: true` 時路由導向 /enquiry；Google/Facebook 建立 portal_account 邏輯與 /login 相同（首登可建帳）。
   */
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${baseUrl}/api/portal-auth/google/callback`,
        scope: ['profile', 'email'],
        passReqToCallback: true
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          let enquiry = false;
          try {
            const raw = req.query?.state;
            if (raw) {
              const decoded = Buffer.from(String(raw), 'base64url').toString('utf8');
              const obj = JSON.parse(decoded);
              enquiry = obj?.enquiry === true;
            }
          } catch (_) {
            enquiry = false;
          }
          const result = enquiry ? await findOrCreateByGoogleEnquiry(profile) : await findOrCreateByGoogle(profile);
          if (result.ok) {
            return done(null, {
              email: result.email,
              roles: result.roles,
              cleanlemons: result.cleanlemons ?? null
            });
          }
          return done(null, false, { reason: result.reason || 'OAUTH_FAILED' });
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

if (process.env.CLEANLEMON_GOOGLE_CLIENT_ID && process.env.CLEANLEMON_GOOGLE_CLIENT_SECRET) {
  passport.use(
    'google-cleanlemon',
    new GoogleStrategy(
      {
        clientID: process.env.CLEANLEMON_GOOGLE_CLIENT_ID,
        clientSecret: process.env.CLEANLEMON_GOOGLE_CLIENT_SECRET,
        callbackURL: `${cleanlemonPortalAuthBase}/api/portal-auth/google/callback`,
        scope: ['profile', 'email']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const result = await findOrCreateByGoogleCleanlemon(profile);
          if (result.ok) {
            return done(null, {
              email: result.email,
              roles: result.roles,
              cleanlemons: result.cleanlemons ?? null
            });
          }
          return done(null, false, { reason: result.reason || 'OAUTH_FAILED' });
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${baseUrl}/api/portal-auth/facebook/callback`,
        profileFields: ['id', 'emails', 'displayName'],
        scope: ['email'],
        passReqToCallback: true
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          let enquiry = false;
          try {
            const raw = req.query?.state;
            if (raw) {
              const decoded = Buffer.from(String(raw), 'base64url').toString('utf8');
              const obj = JSON.parse(decoded);
              enquiry = obj?.enquiry === true;
            }
          } catch (_) {
            enquiry = false;
          }
          const result = enquiry
            ? await findOrCreateByFacebookEnquiry(profile)
            : await findOrCreateByFacebook(profile);
          if (result.ok) {
            return done(null, {
              email: result.email,
              roles: result.roles,
              cleanlemons: result.cleanlemons ?? null
            });
          }
          return done(null, false, { reason: result.reason || 'OAUTH_FAILED' });
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  passport.use(
    'facebook-cleanlemon',
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${cleanlemonPortalAuthBase}/api/portal-auth/facebook/callback`,
        profileFields: ['id', 'emails', 'displayName'],
        scope: ['email']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const result = await findOrCreateByFacebookCleanlemon(profile);
          if (result.ok) {
            return done(null, {
              email: result.email,
              roles: result.roles,
              cleanlemons: result.cleanlemons ?? null
            });
          }
          return done(null, false, { reason: result.reason || 'OAUTH_FAILED' });
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

module.exports = passport;

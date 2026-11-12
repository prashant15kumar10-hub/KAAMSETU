'use strict';
const i18n = require('../i18n');

module.exports = function (r) {
  r.add('GET', '/api/health', { auth: false }, ({ db }) => {
    db.prepare('SELECT 1').get();
    return { ok: true, time: new Date().toISOString() };
  });

  // Readiness for uptime monitors / load balancers: proves the database answers and reports the schema version.
  // (A read-only probe: it does not prove free disk space - monitor disk separately, see docs/OPERATIONS.md.)
  r.add('GET', '/api/ready', { auth: false }, ({ db, cfg }) => {
    const v = db.prepare('SELECT MAX(id) v FROM schema_migrations').get().v;
    return { ok: true, schema_version: v, version: cfg.version, uptime_s: Math.round(process.uptime()) };
  });

  // Server-message catalog so the frontend can show messages by stable error code.
  r.add('GET', '/api/messages', { auth: false }, ({ lang }) => ({ lang, supported: i18n.SUPPORTED, messages: i18n.catalog(lang) }));

  // Honest statement of what this backend does and does NOT do.
  r.add('GET', '/api/capabilities', { auth: false }, ({ cfg }) => ({
    implemented: [
      'accounts_with_server_side_roles', 'language_preference_and_localized_errors', 'job_drafts_publish_and_repeat_as_new_draft',
      'terms_acceptance_with_versioning_and_reacceptance', 'capacity_and_duplicate_booking_protection',
      'contractor_recorded_attendance_and_worker_self_reported_arrival', 'payment_reports_acknowledge_dispute_correct_with_history',
      'ordinary_help_requests', 'admin_user_and_help_and_dispute_overview', 'idempotent_retries', 'audit_log',
      ...(cfg.requireIdentifierVerification ? ['email_phone_identifier_verification_via_delivery_adapter'] : []),
      ...(cfg.requireAdminMfa ? ['administrator_totp_mfa'] : []),
    ],
    not_implemented_requires_decision_or_provider: {
      two_plus_one_allocation: 'needs policy approval (see docs/POLICY_SPECS.md)',
      advances_accounting: 'needs policy approval',
      travel_cancellation_compensation: 'needs policy approval; endpoints only report that no compensation is calculated',
      confidential_safety_reporting: 'needs policy approval and restricted-access design',
      replacement_worker_assistance: 'not built; no guarantee is offered',
      verified_skills: 'no verification process exists; skills are self-declared',
      gps_attendance: 'not built; arrival reports are statements, not verified',
      sms_whatsapp_push_notifications: 'no provider configured',
      real_money_movement: 'no payment provider; nothing here transfers, holds or refunds money',
    },
    settings: { require_full_terms: cfg.requireFullTerms, require_identifier_verification: cfg.requireIdentifierVerification, require_admin_mfa: cfg.requireAdminMfa, languages: i18n.SUPPORTED },
  }));
};

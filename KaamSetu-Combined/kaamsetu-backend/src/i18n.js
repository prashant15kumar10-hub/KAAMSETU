'use strict';
/* Stable error codes -> localized messages (Hindi + English).
   The frontend should switch on `error.code`, never on message text. */
const SUPPORTED = ['hi', 'en'];

const M = {
  INTERNAL: { en: 'Something went wrong on our side. Please try again.', hi: 'हमारी तरफ़ से कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।' },
  NOT_FOUND: { en: 'Not found.', hi: 'नहीं मिला।' },
  METHOD_NOT_ALLOWED: { en: 'This action is not allowed here.', hi: 'यहाँ यह क्रिया अनुमत नहीं है।' },
  BAD_JSON: { en: 'The request could not be read.', hi: 'अनुरोध पढ़ा नहीं जा सका।' },
  BODY_TOO_LARGE: { en: 'The request is too large.', hi: 'अनुरोध बहुत बड़ा है।' },
  VALIDATION: { en: 'Please check the field: {field}.', hi: 'कृपया यह जानकारी जाँचें: {field}।' },
  UNAUTHENTICATED: { en: 'Please log in to continue.', hi: 'आगे बढ़ने के लिए कृपया लॉगिन करें।' },
  SESSION_EXPIRED: { en: 'Your session has ended. Please log in again.', hi: 'आपका सत्र समाप्त हो गया है। कृपया दोबारा लॉगिन करें।' },
  FORBIDDEN: { en: 'You are not allowed to do this.', hi: 'आपको यह करने की अनुमति नहीं है।' },
  ACCOUNT_DISABLED: { en: 'This account is disabled. Please contact support.', hi: 'यह खाता बंद है। कृपया सहायता से संपर्क करें।' },
  RATE_LIMITED: { en: 'Too many attempts. Please wait and try again later.', hi: 'बहुत ज़्यादा कोशिशें हुईं। कृपया थोड़ी देर बाद फिर कोशिश करें।' },
  INVALID_CREDENTIALS: { en: 'Phone/email or password is incorrect.', hi: 'फ़ोन/ईमेल या पासवर्ड ग़लत है।' },
  IDENTIFIER_INVALID: { en: 'Enter a valid 10-digit mobile number or email.', hi: 'सही 10 अंकों का मोबाइल नंबर या ईमेल दर्ज करें।' },
  IDENTIFIER_TAKEN: { en: 'An account with this phone/email already exists.', hi: 'इस फ़ोन/ईमेल से खाता पहले से मौजूद है।' },
  PASSWORD_WEAK: { en: 'Password must be 8 to 128 characters.', hi: 'पासवर्ड 8 से 128 अक्षरों का होना चाहिए।' },
  ROLE_INVALID: { en: 'Choose worker or contractor.', hi: 'मज़दूर या ठेकेदार चुनें।' },
  LANG_UNSUPPORTED: { en: 'This language is not supported yet.', hi: 'यह भाषा अभी उपलब्ध नहीं है।' },
  JOB_NOT_FOUND: { en: 'Job not found.', hi: 'काम नहीं मिला।' },
  JOB_NOT_OPEN: { en: 'This job is not open for changes or bookings.', hi: 'यह काम अभी खुला नहीं है।' },
  JOB_NOT_DRAFT: { en: 'This job has already been posted.', hi: 'यह काम पहले ही पोस्ट हो चुका है।' },
  JOB_FULL: { en: 'All places for this job are taken.', hi: 'इस काम की सभी जगहें भर चुकी हैं।' },
  JOB_DATE_PAST: { en: 'The reporting date has already passed.', hi: 'पहुँचने की तारीख निकल चुकी है।' },
  JOB_FIELDS_MISSING: { en: 'Some required job details are missing: {fields}.', hi: 'काम की कुछ ज़रूरी जानकारी छूटी है: {fields}।' },
  REVIEW_REQUIRED: { en: 'Please review the job details and confirm before posting.', hi: 'पोस्ट करने से पहले काम की जानकारी देखकर पुष्टि करें।' },
  NEEDED_BELOW_ACTIVE: { en: 'Workers needed cannot be less than workers already booked.', hi: 'ज़रूरी मज़दूरों की संख्या पहले से बुक मज़दूरों से कम नहीं हो सकती।' },
  TERMS_NOT_ACCEPTED: { en: 'You must accept the job terms to continue.', hi: 'आगे बढ़ने के लिए आपको काम की शर्तें माननी होंगी।' },
  TERMS_VERSION_MISMATCH: { en: 'The job terms have changed. Please read them again before accepting.', hi: 'काम की शर्तें बदल गई हैं। स्वीकार करने से पहले उन्हें दोबारा पढ़ें।' },
  BOOKING_EXISTS: { en: 'You already have a booking for this job.', hi: 'इस काम के लिए आपकी बुकिंग पहले से है।' },
  BOOKING_NOT_FOUND: { en: 'Booking not found.', hi: 'बुकिंग नहीं मिली।' },
  BOOKING_NOT_ACTIVE: { en: 'This booking is not active.', hi: 'यह बुकिंग चालू नहीं है।' },
  ATTENDANCE_DATE_INVALID: { en: 'Attendance date must be between the job start date and today.', hi: 'हाज़िरी की तारीख काम शुरू होने की तारीख और आज के बीच होनी चाहिए।' },
  ATTENDANCE_EXISTS: { en: 'Arrival is already recorded for this date.', hi: 'इस तारीख की हाज़िरी पहले से दर्ज है।' },
  PAYMENT_NOT_FOUND: { en: 'Payment record not found.', hi: 'भुगतान रिकॉर्ड नहीं मिला।' },
  PAYMENT_STATE_INVALID: { en: 'This payment cannot be changed in its current state.', hi: 'इस भुगतान को अभी इस स्थिति में बदला नहीं जा सकता।' },
  AMOUNT_INVALID: { en: 'Enter a valid amount in rupees.', hi: 'रुपयों में सही राशि दर्ज करें।' },
  DISPUTE_REASON_REQUIRED: { en: 'Please explain what is incorrect.', hi: 'कृपया बताएँ कि क्या ग़लत है।' },
  SAFETY_REPORTING_NOT_ENABLED: {
    en: 'Confidential safety reporting is not available yet. In an emergency call 112. Do not put sensitive details in ordinary help messages.',
    hi: 'गोपनीय सुरक्षा शिकायत की सुविधा अभी उपलब्ध नहीं है। आपात स्थिति में 112 पर कॉल करें। सामान्य मदद संदेश में संवेदनशील जानकारी न लिखें।' },
  IDEMPOTENCY_CONFLICT: { en: 'This request key was already used for a different request.', hi: 'यह अनुरोध कुंजी पहले किसी दूसरे अनुरोध के लिए इस्तेमाल हो चुकी है।' },
  HELP_STATUS_INVALID: { en: 'Invalid status.', hi: 'ग़लत स्थिति।' },
};

function pickLang(candidate) { return SUPPORTED.includes(candidate) ? candidate : null; }

function fromAcceptLanguage(h) {
  if (!h) return null;
  for (const part of String(h).split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (SUPPORTED.includes(tag)) return tag;
  }
  return null;
}

function translate(lang, code, params = {}) {
  const entry = M[code] || M.INTERNAL;
  const tpl = entry[lang] || entry.en;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : ''));
}

function catalog(lang) {
  const out = {};
  for (const k of Object.keys(M)) out[k] = M[k][lang] || M[k].en;
  return out;
}

module.exports = { SUPPORTED, pickLang, fromAcceptLanguage, translate, catalog, M };

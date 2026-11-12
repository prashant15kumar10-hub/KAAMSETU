# Worker access and emergency protocol — current boundary and operating design

## Current application capability

The current application does **not** implement family contacts, authorized contact storage, emergency-message relay, SMS/WhatsApp delivery or delivery receipts. A saved phone number or ordinary help ticket is not an emergency service. Do not represent a message as delivered unless a real delivery provider confirms it. In a life-threatening emergency in India, call **112**; do not wait for KAAMSETU.

## Minimum protocol before a pilot relies on this workflow

1. **Consent:** obtain explicit, revocable worker consent before storing a family/trusted contact. Explain purpose, who can access the contact, retention, and limitations. Store only the minimum required fields.
2. **Shift slip:** provide a printable/shareable slip with job-site address, landmark, shift window, contractor/supervisor contact, and a timestamp. The worker chooses whether to share it. Do not continuously track location.
3. **Primary/backup:** define a primary contact and a backup contact for the shift. Document who is responsible for answering, how the worker is located at site, and how failed delivery is escalated.
4. **Message states:** if implemented, distinguish `created`, `queued`, `sent_to_provider`, `provider_delivered`, `acknowledged_by_site`, `failed`, and `expired`. A database insert is not delivery proof.
5. **Minimal records:** retain timestamps, channel, status and provider reference; avoid message contents in logs. Apply role/ownership checks on every read and write. Revoke access immediately when worker consent is withdrawn.
6. **Failure handling:** if primary does not answer, try the authorized backup; if supervisor is unavailable or site has changed, mark failure and follow the agreed escalation process. Do not claim successful delivery without confirmation.
7. **Emergency boundary:** life-threatening situations require direct emergency services, including India's 112 where appropriate. The relay is not a replacement for emergency response.
8. **Pilot rehearsal:** test missed calls, invalid address, worker moved to another site, unavailable supervisor, revoked consent and failed provider delivery before using this operationally.

## Assisted access safeguards required before implementation

- Facilitator assistance must be consent-based and auditable.
- A facilitator must not silently change wages, acknowledge payment, mark attendance as worker-confirmed, withdraw a complaint or change recovery details.
- Sensitive changes require worker confirmation or a documented review process.
- Keep essential access independent of smartphone ownership and UPI use.

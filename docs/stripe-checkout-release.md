# Stripe checkout release checklist

This integration is disabled by default. Do not enable it with a key pasted into
chat, and do not switch live payments on before the hosted sandbox checks pass.
No customer payments or production migrations are part of the local QA.

## Product rules

- App: one non-recurring payment buys one calendar month. Existing active access
  is extended; the original day-of-month is retained across shorter months.
- Coaching: one payment buys the selected 4, 8 or 12 weeks of Pro. Coaching
  onboarding/service start is arranged separately with DevFit.
- Student coaching is only offered to an account after the owner approves its
  private student-eligibility flag in Admin. Editing a dropdown cannot qualify.
- Amounts come from server configuration/price snapshots, never browser inputs.
- Only verified Stripe-paid sessions and payment intents may fulfill an order.
  Success URLs, payment email edits, uploaded receipts and client Pro flags cannot.
- Test orders never change any account entitlement. Duplicate delivery does not
  extend Pro twice. A Stripe payment intent cannot fund multiple orders.
- Refund/dispute notifications suspend Pro (not login or history) until owner
  review of all remaining manual/paid periods. Resolving the review does not
  restore Pro automatically: the owner sets the correct remaining access dates.
- Invoices are generated from paid records, scoped to the signed-in owner or
  authenticated admin. These are payment documents, not validated government
  e-Invoices. Confirm merchant identity/address and tax requirements before launch.

## Private environment configuration

Configure these server-only values in Vercel. Never commit values or paste them
into a chat, frontend script, URL, command argument, screenshot or public file.
Staging also requires its own `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`DEVFIT_JWT_SECRET` and `DEVFIT_ADMIN_PASSWORD`. Set the staging database URL
explicitly: the application's default is the customer production database.
Do not copy production credentials to Preview. Owner backups must include
`devfit_checkout_orders` and `devfit_checkout_eligibility` as well as subscriber
records; account deletion currently removes associated payment records by cascade.

| Name | Sandbox | Production |
| --- | --- | --- |
| STRIPE_SECRET_KEY | replacement restricted test key | replacement restricted live key |
| STRIPE_MODE | test | live |
| STRIPE_WEBHOOK_SECRET | sandbox endpoint signing secret | live endpoint signing secret |
| DEVFIT_STRIPE_ENABLED | true after endpoint configured | keep false until sandbox acceptance |
| DEVFIT_INVOICE_BUSINESS_NAME | real merchant identity | real merchant identity |
| DEVFIT_INVOICE_BUSINESS_ADDRESS | real business/contact address | real business/contact address |
| DEVFIT_CHECKOUT_ORIGIN | exact HTTPS staging origin, no trailing slash | https://devfitportal.vercel.app |

Use distinct sandbox and live keys/endpoints. Hosted Checkout redirects do not
need a publishable key in this implementation. Restricted keys must permit the
Checkout Session creation/retrieval, PaymentIntent retrieval and Charge retrieval operations used here;
grant only the documented permissions needed, not blanket account access.

Webhook URL: `https://devfitportal.vercel.app/api/stripe-webhook` (use the staging
origin for sandbox testing; never send test traffic to the customer database). A dedicated
rewrite to a signature-authenticated private handler in the existing admin
function preserves 12 public Vercel functions. Verify raw-body handling on the
actual deployed runtime; reserialized JSON must fail signature verification.

Listen for:

- checkout.session.completed
- checkout.session.async_payment_succeeded
- charge.refunded
- charge.dispute.created

## Required before deploying to customers

1. Rotate/revoke all exposed keys. Confirm Stripe account is ready for live
   payments and the hosting plan permits the intended commercial use.
2. Apply/review the additive billing migration on staging first. RLS must deny
   anon/authenticated table access; only service_role can fulfill payments.
3. Sandbox hosted Checkout: successful card, cancellation, decline, authentication
   challenge, delayed payment, webhook before/after redirect, close app after pay,
   lost create response, duplicate delivery and simultaneous confirmation.
4. Verify the signed-in DevFit account (not an edited Checkout email) receives the
   payment and invoice. Another account must not access an order or invoice.
5. Real refund/dispute deliveries, including replay and partial refunds, must
   trigger the owner-review flow without deleting data or banning login.
6. Test invoice download in Android Chrome and a real iPhone Home Screen app.
7. Verify coaching/student eligibility and preserve existing active Pro periods.
8. After those checks, deploy the migration, application and private live
   configuration as a coordinated release. Do not publish a half-working Pay UI.

Older cached clients receive `receipt_upload_retired` once Stripe is enabled.
Historical receipt records and owner review remain available; no receipt is
promoted into a trusted Stripe payment or used for automatic activation.

The browser UI QA uses mocked payment responses. Unit tests use synthetic keys
and provider responses. PostgreSQL tests use disposable local data. None is a
substitute for the hosted Stripe sandbox acceptance checks above.

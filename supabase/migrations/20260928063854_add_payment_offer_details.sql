-- Existing receipts remain valid. A selected offer and the listed price are
-- snapshots for owner review, never a grant of Pro access.
alter table public.devfit_payments
  add column if not exists offer_code text not null default 'app_pro',
  add column if not exists payer_name text,
  add column if not exists payer_whatsapp text,
  add column if not exists expected_amount_cents integer,
  add column if not exists detected_amount_cents integer,
  add column if not exists email_status text not null default 'pending',
  add column if not exists email_error text,
  add column if not exists notified_at timestamptz;

alter table public.devfit_payments
  add constraint devfit_payments_offer_code_check
    check (offer_code in ('app_pro','coaching_4w','coaching_8w','coaching_12w','coaching_student_4w')),
  add constraint devfit_payments_payer_name_check
    check (payer_name is null or length(payer_name) between 2 and 80),
  add constraint devfit_payments_payer_whatsapp_check
    check (payer_whatsapp is null or payer_whatsapp ~ '^\+?[0-9]{7,15}$'),
  add constraint devfit_payments_expected_amount_check
    check (expected_amount_cents is null or expected_amount_cents between 1 and 1000000),
  add constraint devfit_payments_detected_amount_check
    check (detected_amount_cents is null or detected_amount_cents between 1 and 1000000),
  add constraint devfit_payments_email_status_check
    check (email_status in ('pending','sent','failed'));

comment on column public.devfit_payments.detected_amount_cents is
  'Owner review aid from receipt OCR or manual correction. Never authorizes Pro access.';

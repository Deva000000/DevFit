begin;
do $$
declare v_email text:='notification-probe@example.invalid';v_secret text:=repeat('d',64);
  v_ticket uuid:=gen_random_uuid();v_payment uuid:=gen_random_uuid();v_id uuid;v_lease uuid;v jsonb;
begin
  assert current_database() like 'devfit_scale%';
  assert exists(select 1 from public.devfit_scale_environment);
  insert into public.devfit_job_auth(name,token_hash,enabled)
    values('notifications',encode(extensions.digest(v_secret,'sha256'),'hex'),true)
    on conflict(name) do update set token_hash=excluded.token_hash,enabled=true;
  insert into public.devfit_subscribers(email,approved,tier) values(v_email,true,'free');
  insert into public.devfit_support_requests(id,email,whatsapp,category,message)
    values(v_ticket,v_email,'60123456789','feedback','Isolated synthetic regression');
  select id into v_id from public.devfit_notification_outbox where support_id=v_ticket;
  assert v_id is not null,'Source insert and retry job are atomic';
  v:=public.claim_devfit_notifications(repeat('e',64));assert v->>'status'='unauthorized';
  v:=public.claim_devfit_notifications(v_secret);assert jsonb_array_length(v->'jobs')=0,'No race with immediate inline delivery';
  update public.devfit_notification_outbox set next_attempt_at=now()-interval '1 minute' where id=v_id;
  v:=public.claim_devfit_notifications(v_secret);assert jsonb_array_length(v->'jobs')=1;
  v_lease:=(v->'jobs'->0->>'lease_id')::uuid;
  v:=public.claim_devfit_notifications(v_secret);assert jsonb_array_length(v->'jobs')=0,'No overlapping lease';
  v:=public.finish_devfit_notification(v_id,gen_random_uuid(),true,'wrong-worker',null);
  assert v->>'status'='stale_lease';
  v:=public.finish_devfit_notification(v_id,v_lease,false,null,'email_provider_unavailable');
  assert v->>'status'='pending';
  assert (select email_status='failed' from public.devfit_support_requests where id=v_ticket);
  assert (select next_attempt_at>=now()+interval '5 minutes' from public.devfit_notification_outbox where id=v_id);
  update public.devfit_notification_outbox set next_attempt_at=now()-interval '1 minute' where id=v_id;
  v:=public.claim_devfit_notifications(v_secret);v_lease:=(v->'jobs'->0->>'lease_id')::uuid;
  -- Simulate worker termination before finishing. Another worker can reclaim
  -- only after its lease expires; the previous worker may not overwrite it.
  update public.devfit_notification_outbox set lease_until=now()-interval '1 second' where id=v_id;
  v:=public.claim_devfit_notifications(v_secret);
  assert (v->'jobs'->0->>'lease_id')::uuid<>v_lease;
  v:=public.finish_devfit_notification(v_id,v_lease,true,'stale-worker',null);assert v->>'status'='stale_lease';
  select lease_id into v_lease from public.devfit_notification_outbox where id=v_id;
  v:=public.finish_devfit_notification(v_id,v_lease,true,'accepted-message',null);assert v->>'status'='sent';
  assert (select email_status='sent' and email_message_id='accepted-message' from public.devfit_support_requests where id=v_ticket);
  v:=public.finish_devfit_notification(v_id,v_lease,false,null,'late_failure');assert v->>'status'='sent';
  assert (select email_status='sent' from public.devfit_support_requests where id=v_ticket);
  insert into public.devfit_payments(id,email,reference,storage_path,mime_type,byte_size,content_hash)
    values(v_payment,v_email,'DEVFIT_QA','synthetic.jpg','image/jpeg',10,repeat('f',64));
  assert exists(select 1 from public.devfit_notification_outbox where payment_id=v_payment);
  update public.devfit_payments set email_status='sent' where id=v_payment;
  assert (select state='sent' from public.devfit_notification_outbox where payment_id=v_payment),'Inline/manual delivery closes retry job';
  assert (select tier='free' from public.devfit_subscribers where email=v_email),'Sending receipt email never grants Pro';
  update public.devfit_notification_outbox set state='pending',created_at=now()-interval '24 hours',next_attempt_at=now()-interval '1 minute' where id=v_id;
  v:=public.claim_devfit_notifications(v_secret);
  assert jsonb_array_length(v->'jobs')=0;
  assert (select state='exhausted' from public.devfit_notification_outbox where id=v_id),'No duplicate outside provider deduplication window';
  update public.devfit_notification_outbox set state='leased',attempts=6,created_at=now(),lease_until=now()-interval '1 second' where id=v_id;
  v:=public.claim_devfit_notifications(v_secret);assert (select state='exhausted' from public.devfit_notification_outbox where id=v_id),'A crashed final attempt cannot retry forever';
  assert not has_table_privilege('anon','public.devfit_notification_outbox','SELECT');
  assert not has_table_privilege('authenticated','public.devfit_job_auth','SELECT');
  assert not has_function_privilege('anon','public.claim_devfit_notifications(text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.finish_devfit_notification(uuid,uuid,boolean,text,text)','EXECUTE');
  perform public.delete_devfit_account(v_email);
  assert not exists(select 1 from public.devfit_notification_outbox where id=v_id),'Account deletion cascades to queued work';
  raise notice 'Notification atomicity, lease recovery, backoff, expiry, ownership and privilege checks passed';
end;$$;
rollback;

begin;
do $$
declare v_email text:='login-recovery@example.invalid';v jsonb;v_device text;v_iat bigint;
begin
  assert current_database() like 'devfit_scale%';
  assert exists(select 1 from public.devfit_scale_environment);
  insert into public.devfit_subscribers(email,name,approved,tier,expiry)
    values(v_email,'Login QA',true,'pro','2099-12-31');
  -- Many old installations without live sessions must not lock out an owner.
  for i in 1..8 loop
    insert into public.devfit_logins(email,device_id) values(v_email,'old-installation-'||i);
  end loop;
  for i in 1..4 loop
    v:=public.start_devfit_account_session(v_email,'new-installation-'||i,repeat(i::text,64),repeat('a',64),'QA');
    assert v->>'status'='ok','Verified owner must not get device_limit';
    if i=1 then update public.devfit_logins set last_seen=now()-interval '1 day' where email=v_email and device_id='new-installation-1';end if;
  end loop;
  assert (select count(distinct device_id)=3 from public.devfit_sessions where email=v_email);
  assert not exists(select 1 from public.devfit_sessions where email=v_email and device_id='new-installation-1');
  assert exists(select 1 from public.devfit_logins where email=v_email and device_id='new-installation-1'),'Audit registration is retained';
  v_iat:=floor(extract(epoch from now()-interval '1 hour'))::bigint;
  v:=public.open_devfit_session(v_email,'new-installation-1',repeat('e',64),v_iat);
  assert v->>'status'='revoked','Replaced legacy session cannot resurrect';
  -- Fresh verification on a known old installation follows the same cap.
  v:=public.start_devfit_account_session(v_email,'old-installation-1',repeat('b',64),repeat('a',64),'QA');
  assert v->>'status'='ok';
  assert (select count(distinct device_id)=3 from public.devfit_sessions where email=v_email);
  -- Browser/PWA siblings sharing a copied cookie survive one fresh login.
  v:=public.start_devfit_account_session(v_email,'old-installation-1',repeat('c',64),repeat('a',64),'QA');
  assert v->>'status'='ok';
  assert exists(select 1 from public.devfit_sessions where session_hash=repeat('b',64));
  assert (select tier='pro' and expiry='2099-12-31' from public.devfit_subscribers where email=v_email);
  v:=public.start_devfit_account_session(v_email,'short',repeat('d',64),repeat('a',64),'QA');assert v->>'status'='invalid_device';
  insert into public.devfit_security_blocks(scope,key_hash,reason)
    values('account',encode(extensions.digest(v_email,'sha256'),'hex'),'QA explicit block');
  v:=public.start_devfit_account_session(v_email,'new-installation-5',repeat('d',64),repeat('a',64),'QA');
  assert v->>'status'='account_blocked','Verified identity must not bypass a block';
  delete from public.devfit_security_blocks where key_hash=encode(extensions.digest(v_email,'sha256'),'hex');
  update public.devfit_subscribers set approved=false where email=v_email;
  v:=public.start_devfit_account_session(v_email,'new-installation-5',repeat('d',64),repeat('a',64),'QA');assert v->>'status'='revoked';
  assert not has_function_privilege('anon','public.start_devfit_account_session(text,text,text,text,text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.start_devfit_account_session(text,text,text,text,text)','EXECUTE');
  raise notice 'Verified login recovery checks passed';
end;$$;
rollback;

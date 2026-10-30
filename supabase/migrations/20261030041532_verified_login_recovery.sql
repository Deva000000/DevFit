-- Verified owners must not be locked out by old Home Screen installations.
-- Additive: no subscription, diary, receipt or program rows are changed.
set lock_timeout='3s';
set statement_timeout='20s';
create function public.start_devfit_account_session(
  p_email text,p_device_id text,p_session_hash text,p_ip_hash text,p_user_agent text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_security jsonb;v_old_device text;v_replaced integer:=0;v_open integer;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','invalid_session');end if;
  -- Same lock as legacy registration. Concurrent sign-ins cannot exceed the cap.
  perform pg_advisory_xact_lock(hashtextextended('devfit-device:'||p_email,0));
  v_security:=public.check_devfit_security_access(p_email,p_device_id,p_ip_hash,p_user_agent,'/api/session',false,false,false);
  if v_security->>'status'<>'ok' then return v_security;end if;
  -- Serialise against owner revocation; do not re-approve or change paid dates.
  perform 1 from public.devfit_subscribers where email=p_email and approved is true for update;
  if not found then return jsonb_build_object('status','revoked');end if;
  insert into public.devfit_logins(email,device_id,user_agent,first_seen,last_seen,login_count)
    values(p_email,p_device_id,left(p_user_agent,300),clock_timestamp(),clock_timestamp(),1)
    on conflict(email,device_id) do update set user_agent=excluded.user_agent,
      last_seen=excluded.last_seen,login_count=devfit_logins.login_count+1;
  delete from public.devfit_sessions where email=p_email and expires_at<=now();
  insert into public.devfit_sessions(session_hash,email,device_id,created_at)
    values(p_session_hash,p_email,p_device_id,clock_timestamp());
  -- A copied installation cookie can legitimately be shared by a browser and
  -- its new PWA. A fresh Google verification must not invalidate that sibling.
  delete from public.devfit_sessions where email=p_email and device_id=p_device_id
    and session_hash in (select session_hash from public.devfit_sessions
      where email=p_email and device_id=p_device_id and session_hash<>p_session_hash
      order by created_at desc,session_hash offset 2);
  loop
    select count(distinct device_id) into v_open from public.devfit_sessions where email=p_email;
    exit when v_open<=3;
    select s.device_id into v_old_device from public.devfit_sessions s
      join public.devfit_logins l on l.email=s.email and l.device_id=s.device_id
      where s.email=p_email and s.device_id<>p_device_id
      group by s.device_id,l.last_seen order by l.last_seen,min(s.created_at),s.device_id limit 1;
    -- Preserve the registration/audit row and prevent legacy-token resurrection.
    update public.devfit_logins set session_revoked_before=clock_timestamp()
      where email=p_email and device_id=v_old_device;
    delete from public.devfit_sessions where email=p_email and device_id=v_old_device;
    v_replaced:=v_replaced+1;
  end loop;
  if v_replaced>0 then
    insert into public.devfit_security_events(email,event_type,severity,route,reason,blocked)
      values(p_email,'session_replaced','info','/api/session','Verified sign-in replaced least recently used session',false);
  end if;
  return jsonb_build_object('status','ok','replaced',v_replaced);
end;$$;
revoke all on function public.start_devfit_account_session(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.start_devfit_account_session(text,text,text,text,text) to service_role;

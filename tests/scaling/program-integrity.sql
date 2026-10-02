-- Run only in the disposable local scale database. All probe writes roll back.
begin;
do $$
declare
  v_email text := 'program-integrity-probe@example.invalid';
  v_device text := 'devfit-integrity-probe-device';
  v_old jsonb := '{"progressSchema":2,"activeProgramId":"p1","programStart":"2026-07-13","programDuration":"12","bw":[["70"]],"steps":[],"sleep":[],"weeklyCheckin":[],"programs":[{"id":"p1","start":"2026-07-13","duration":12,"bw":[["70"]],"steps":[],"sleep":[],"weeklyCheckin":[]}]}';
  v_next jsonb; v_result jsonb; v_version text; v_bad jsonb; v_checks integer:=0;v_context jsonb;
begin
  assert current_database() like 'devfit_scale%', 'Refusing non-test database';
  assert exists(select 1 from public.devfit_scale_environment),'Missing isolation marker';
  assert not exists(select 1 from public.devfit_subscribers where email=v_email),'Existing probe account';
  insert into public.devfit_subscribers(email,name,tier,approved) values(v_email,'Rollback-only integrity QA','free',true);
  insert into public.devfit_logins(email,device_id,user_agent) values(v_email,v_device,'Integrity QA');
  v_context:=jsonb_build_object('deviceId',v_device,'ipHash',repeat('b',64),'userAgent','Integrity QA');
  v_result:=public.save_devfit_data_atomic(v_email,'progress',v_old,'',v_device,repeat('b',64));
  assert v_result->>'status'='ok','Initial v2 save';v_version:=v_result->>'updated_at';v_checks:=v_checks+1;
  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(v_old,'{programStart}','"2026-09-28"'),
    jsonb_set(jsonb_set(v_old,'{programStart}','"2026-09-28"'),'{programs,0,start}','"2026-09-28"'),
    v_old||'{"progressSchema":1}',
    v_old||'{"programs":[]}',
    v_old||'{"programs":{},"progressSchema":2}',
    jsonb_set(v_old,'{programs}',(v_old->'programs')||(v_old->'programs')),
    v_old||'{"activeProgramId":"missing"}'
  )) loop
    v_result:=public.save_devfit_data_atomic(v_email,'progress',v_bad,v_version,v_device,repeat('b',64));
    assert v_result->>'status'='conflict','Unsafe date/history rewrite was accepted';
    assert (select data=v_old and updated_at::text=v_version::timestamptz::text from public.devfit_data where email=v_email and data_type='progress'),'Rejected write changed data/version';
    v_checks:=v_checks+1;
  end loop;
  v_result:=public.patch_devfit_data_atomic(v_email,'progress','[{"op":"set","path":["programStart"],"value":"2026-09-28"}]',v_version,v_device,repeat('b',64),v_context);
  assert v_result->>'reason'='program_dates_locked','Incremental patch bypassed date protection';v_checks:=v_checks+1;
  v_result:=public.save_devfit_data_atomic(v_email,'progress',jsonb_set(v_old,'{programStart}','"2026-09-28"'),v_version,v_device,repeat('b',64),v_context);
  assert v_result->>'reason'='program_dates_locked','Context-aware write bypassed date protection';v_checks:=v_checks+1;
  v_next:=jsonb_set(v_old,'{goal}','"75"');
  v_result:=public.save_devfit_data_atomic(v_email,'progress',v_next,v_version,v_device,repeat('b',64));
  assert v_result->>'status'='ok','Normal metadata edit rejected';v_version:=v_result->>'updated_at';v_checks:=v_checks+1;
  v_next:=v_next||jsonb_build_object('activeProgramId','p2','programStart','2026-09-28','programs',
    (v_next->'programs')||'[{"id":"p2","start":"2026-09-28","duration":8,"bw":[],"steps":[],"sleep":[],"weeklyCheckin":[]}]');
  v_result:=public.save_devfit_data_atomic(v_email,'progress',v_next,v_version,v_device,repeat('b',64));
  assert v_result->>'status'='ok','New identity/date rejected';v_version:=v_result->>'updated_at';v_checks:=v_checks+1;
  v_next:=v_old||jsonb_build_object('resetAt',clock_timestamp());
  v_result:=public.save_devfit_data_atomic(v_email,'progress',v_next,v_version,v_device,repeat('b',64));
  assert v_result->>'status'='ok','Intentional account reset rejected';v_checks:=v_checks+1;
  assert not has_function_privilege('anon','public.devfit_progress_anchors_valid(jsonb,jsonb)','EXECUTE'),'Anonymous helper access';
  assert not has_function_privilege('authenticated','public.save_devfit_data_atomic(text,text,jsonb,text,text,text)','EXECUTE'),'Browser RPC access';v_checks:=v_checks+2;
  raise notice 'Program integrity checks passed: %',v_checks;
end;
$$;
rollback;

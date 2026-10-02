-- Small rollback-only correctness probe. No persistent accounts or test data.
begin;
do $$
declare
  v_email text := 'devfit-sync-rollback-probe@example.invalid';
  v_device text := 'devfit-rollback-probe-device';
  v_ip text := repeat('a',64);
  v_context jsonb;
  v_data jsonb := '{"sessions":[{"id":"s1","date":"2026-10-02","workoutId":"upper","logs":[{"exId":"e1","name":"Row","sets":[{"weight":40,"reps":10}]}]}],"notes":"Keep history","flags":{}}';
  v_result jsonb;v_read jsonb;v_row jsonb;v_version text;v_changes jsonb;v_bad jsonb;v_before jsonb;v_count integer := 0;
begin
  if exists(select 1 from public.devfit_subscribers where email=v_email) then raise exception 'Probe identity already exists; refusing to touch it'; end if;
  insert into public.devfit_subscribers(email,name,tier,approved) values(v_email,'Rollback-only probe','free',true);
  insert into public.devfit_logins(email,device_id,user_agent) values(v_email,v_device,'DevFit rollback probe');
  v_context := jsonb_build_object('deviceId',v_device,'ipHash',v_ip,'userAgent','DevFit rollback probe');
  v_result := public.save_devfit_data_atomic(v_email,'workouts',v_data,'',v_device,v_ip,v_context);
  assert v_result->>'status'='ok','old whole-document contract failed';v_count:=v_count+1;
  v_version := v_result->>'updated_at';
  v_read := public.load_devfit_account_delta(v_email,'workouts',jsonb_build_object('workouts',v_version),v_context);
  assert v_read->>'status'='ok' and (v_read->'rows'->0->>'notModified')='true' and not ((v_read->'rows'->0) ? 'data'),'conditional read leaked/repeated data';v_count:=v_count+1;
  v_read := public.load_devfit_account_delta(v_email,'workouts','{}',v_context);
  assert v_read->'rows'->0->'data'=v_data,'full read mismatch';v_count:=v_count+1;
  v_changes := '[{"op":"set","path":["sessions","0","logs","0","sets","0","reps"],"value":12},{"op":"set","path":["flags","zero"],"value":0},{"op":"set","path":["flags","false"],"value":false},{"op":"set","path":["flags","null"],"value":null}]';
  v_result := public.patch_devfit_data_atomic(v_email,'workouts',v_changes,v_version,v_device,v_ip,v_context);
  assert v_result->>'status'='ok','nested patch failed';v_count:=v_count+1;
  v_version := v_result->>'updated_at';
  select data into v_before from public.devfit_data where email=v_email and data_type='workouts';
  assert (v_before#>>'{sessions,0,logs,0,sets,0,reps}')='12' and (v_before#>>'{flags,zero}')='0'
    and (v_before#>>'{flags,false}')='false' and (v_before#>'{flags,"null"}')='null'::jsonb,'false/zero/null corruption';v_count:=v_count+1;
  v_result := public.patch_devfit_data_atomic(v_email,'workouts',v_changes,v_version,v_device,v_ip,v_context);
  assert v_result->>'status'='ok' and (v_result->>'unchanged')='true' and v_result->>'updated_at'=v_version,'idempotence failed';v_count:=v_count+1;
  v_changes := '[{"op":"set","path":["sessions","0","logs","0","sets","1"],"value":{"weight":40,"reps":8}}]';
  v_result := public.patch_devfit_data_atomic(v_email,'workouts',v_changes,v_version,v_device,v_ip,v_context);
  assert v_result->>'status'='ok','append failed';v_count:=v_count+1;
  v_result := public.patch_devfit_data_atomic(v_email,'workouts',v_changes,v_version,v_device,v_ip,v_context);
  assert v_result->>'status'='conflict','lost ACK structural replay accepted';v_count:=v_count+1;
  assert jsonb_array_length(v_result#>'{row,data,sessions,0,logs,0,sets}')=2,'append duplicated';v_count:=v_count+1;
  v_version := v_result#>>'{row,updated_at}';
  v_result := public.patch_devfit_data_atomic(v_email,'workouts','[{"op":"remove","path":["sessions","0","logs","0","sets","1"]},{"op":"remove","path":["notes"]}]',v_version,v_device,v_ip,v_context);
  assert v_result->>'status'='ok','remove failed';v_count:=v_count+1;
  v_version := v_result->>'updated_at';
  select data into v_before from public.devfit_data where email=v_email and data_type='workouts';
  assert not (v_before ? 'notes') and jsonb_array_length(v_before#>'{sessions,0,logs,0,sets}')=1,'delete did not persist';v_count:=v_count+1;
  for v_bad in select value from jsonb_array_elements('[
    [{"op":"set","path":["__proto__","tier"],"value":"pro"}],
    [{"op":"set","path":["sessions","-1"],"value":{}}],
    [{"op":"set","path":["sessions","100"],"value":{}}],
    [{"op":"set","path":["sessions","foo"],"value":{}}],
    [{"op":"set","path":["missing","child"],"value":1}],
    [{"op":"set","path":[],"value":1}],
    [{"op":"set","path":[3],"value":1}],
    [{"op":"set","path":["notes"]}],
    [{"op":"merge","path":["notes"],"value":1}],
    [{"op":"set","path":{},"value":1}],
    {"invalid":true}
  ]') loop
    v_result := public.patch_devfit_data_atomic(v_email,'workouts',v_bad,v_version,v_device,v_ip,v_context);
    assert v_result->>'status'='invalid','malformed patch not rejected';v_count:=v_count+1;
    assert (select data=v_before from public.devfit_data where email=v_email and data_type='workouts'),'malformed patch mutated document';
  end loop;
  v_result := public.patch_devfit_data_atomic(v_email,'workouts','[]',v_version,v_device,v_ip,v_context||'{"deviceId":"wrong-device"}');
  assert (v_result->>'securityDenied')='true','device mismatch accepted';v_count:=v_count+1;
  v_result := public.patch_devfit_data_atomic(v_email,'prefs','[]','',v_device,v_ip,v_context);
  assert v_result->>'status'='conflict' and v_result->'row'='null'::jsonb,'missing document patch allowed';v_count:=v_count+1;
  update public.devfit_subscribers set approved=false where email=v_email;
  v_read := public.load_devfit_account_delta(v_email,'workouts',jsonb_build_object('workouts',v_version),v_context);
  assert v_read->>'status'='revoked' and not (v_read ? 'rows'),'revocation bypassed by conditional read';v_count:=v_count+1;
  v_result := public.patch_devfit_data_atomic(v_email,'workouts','[]',v_version,v_device,v_ip,v_context);
  assert v_result->>'status'='revoked','revoked patch allowed';v_count:=v_count+1;
  assert not has_function_privilege('anon','public.patch_devfit_data_atomic(text,text,jsonb,text,text,text,jsonb)','execute')
    and not has_function_privilege('authenticated','public.load_devfit_account_delta(text,text,jsonb,jsonb)','execute'),'public RPC exposed';v_count:=v_count+1;
  assert (public.devfit_sync_health()->>'ok')='true','health transport unavailable';v_count:=v_count+1;
  raise notice '% incremental SQL checks passed; all probe records roll back',v_count;
end;
$$;
rollback;

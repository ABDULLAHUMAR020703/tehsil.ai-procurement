create extension if not exists pgcrypto;

create table if not exists public.departments (
  code text primary key,
  display_name text not null
);

insert into public.departments (code, display_name) values
  ('sales', 'Sales'),
  ('hr', 'HR'),
  ('technical', 'Technical'),
  ('finance', 'Finance'),
  ('engineering', 'Engineering'),
  ('management', 'Management'),
  ('ibs', 'IBS'),
  ('power', 'Power'),
  ('civil_works', 'Civil Works'),
  ('bss_wireless', 'BSS & Wireless'),
  ('fixed_network', 'Fixed Network'),
  ('warehouse', 'Warehouse')
on conflict (code) do nothing;

alter table public.users drop constraint if exists users_department_check;

alter table public.projects drop constraint if exists projects_department_check;

alter table public.users add constraint users_department_check check (
  department in (
    'sales', 'hr', 'technical', 'finance', 'engineering', 'management',
    'ibs', 'power', 'civil_works', 'bss_wireless', 'fixed_network', 'warehouse'
  )
);

alter table public.projects add constraint projects_department_check check (
  department in (
    'sales', 'hr', 'technical', 'finance', 'engineering', 'management',
    'ibs', 'power', 'civil_works', 'bss_wireless', 'fixed_network', 'warehouse'
  )
);

do $$
declare
  rec record;
  v_id uuid;
  v_email text;
  v_keeper uuid;
  v_users_has_company_id boolean;
  v_company_id uuid;
begin
  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'users'
      and c.column_name = 'company_id'
  )
  into v_users_has_company_id;

  if v_users_has_company_id and to_regclass('public.companies') is not null then
    select c.id
    into v_company_id
    from public.companies c
    where c.name = 'Main Company'
    limit 1;
    if v_company_id is null then
      select c.id into v_company_id from public.companies c order by c.created_at nulls last limit 1;
    end if;
  end if;

  if v_users_has_company_id and v_company_id is null then
    raise exception
      'public.users has company_id but public.companies has no rows; insert or run multi-tenant migration first';
  end if;

  select coalesce(
    (select id from public.users where lower(email) = lower('hammad.bakhtiar@hadir.ai') limit 1),
    (select id from public.users order by created_at nulls last, id limit 1)
  )
  into v_keeper;

  if v_keeper is not null then
    update public.users u
    set
      role = 'pm',
      department = case
        when u.department = 'management' then 'technical'
        else u.department
      end
    where u.role = 'admin'
      and u.id <> v_keeper;

    update public.users
    set role = 'admin', department = 'management'
    where id = v_keeper;
  end if;

  update public.users
  set department = 'technical'
  where role <> 'admin'
    and department = 'management';

  update public.users
  set role = 'pm', department = 'sales'
  where lower(email) = lower('abdullah.bin.ali@hadir.ai');

  update public.users
  set role = 'employee', department = 'sales'
  where lower(email) = lower('hasnain.ibrar@hadir.ai');

  update public.users
  set role = 'pm', department = 'finance'
  where lower(email) = lower('abdul.rehman.batt@hadir.ai');

  update public.users
  set role = 'employee', department = 'hr'
  where lower(email) = lower('abdullah.bin.umar@hadir.ai');

  update public.users
  set role = 'employee', department = 'technical'
  where lower(email) = lower('samad.kiani@hadir.ai');

  update public.users
  set role = 'pm', department = 'engineering'
  where lower(email) = lower('bilawal.cheema@hadir.ai');

  update public.users
  set role = 'employee', department = 'ibs'
  where lower(email) = lower('zidane.asghar@hadir.ai');

  update public.users
  set role = 'pm', department = 'power'
  where lower(email) = lower('moiz.kazi@hadir.ai');

  update public.users
  set role = 'employee', department = 'civil_works'
  where lower(email) = lower('balaj.nadeem.kiani@hadir.ai');

  for rec in
    select * from (
      values
        ('nadia.rahman', 'Nadia Rahman', 'pm', 'sales', 'nadiaRahman123'),
        ('omar.siddiqui', 'Omar Siddiqui', 'employee', 'sales', 'omarSiddiqui123'),
        ('laiba.malik', 'Laiba Malik', 'employee', 'sales', 'laibaMalik123'),
        ('hassan.raza', 'Hassan Raza', 'employee', 'sales', 'hassanRaza123'),
        ('sara.khan', 'Sara Khan', 'employee', 'sales', 'saraKhan123'),
        ('imran.qureshi', 'Imran Qureshi', 'pm', 'hr', 'imranQureshi123'),
        ('fatima.aziz', 'Fatima Aziz', 'employee', 'hr', 'fatimaAziz123'),
        ('yasmin.tariq', 'Yasmin Tariq', 'employee', 'hr', 'yasminTariq123'),
        ('bilal.hafeez', 'Bilal Hafeez', 'employee', 'hr', 'bilalHafeez123'),
        ('aisha.mehmood', 'Aisha Mehmood', 'employee', 'hr', 'aishaMehmood123'),
        ('danish.irfan', 'Danish Irfan', 'pm', 'technical', 'danishIrfan123'),
        ('hina.shahid', 'Hina Shahid', 'employee', 'technical', 'hinaShahid123'),
        ('usman.javed', 'Usman Javed', 'employee', 'technical', 'usmanJaved123'),
        ('mehwish.saleem', 'Mehwish Saleem', 'employee', 'technical', 'mehwishSaleem123'),
        ('kamran.akhtar', 'Kamran Akhtar', 'employee', 'technical', 'kamranAkhtar123'),
        ('rubina.farooq', 'Rubina Farooq', 'pm', 'finance', 'rubinaFarooq123'),
        ('adeel.naseem', 'Adeel Naseem', 'employee', 'finance', 'adeelNaseem123'),
        ('mariam.haider', 'Mariam Haider', 'employee', 'finance', 'mariamHaider123'),
        ('shahzad.ilyas', 'Shahzad Ilyas', 'employee', 'finance', 'shahzadIlyas123'),
        ('nighat.parveen', 'Nighat Parveen', 'employee', 'finance', 'nighatParveen123'),
        ('faisal.rehman', 'Faisal Rehman', 'pm', 'engineering', 'faisalRehman123'),
        ('saima.anjum', 'Saima Anjum', 'employee', 'engineering', 'saimaAnjum123'),
        ('tariq.mahmood', 'Tariq Mahmood', 'employee', 'engineering', 'tariqMahmood123'),
        ('nabeel.ashraf', 'Nabeel Ashraf', 'employee', 'engineering', 'nabeelAshraf123'),
        ('rumaisa.khalid', 'Rumaisa Khalid', 'employee', 'engineering', 'rumaisaKhalid123'),
        ('waleed.sultan', 'Waleed Sultan', 'pm', 'ibs', 'waleedSultan123'),
        ('hania.mirza', 'Hania Mirza', 'employee', 'ibs', 'haniaMirza123'),
        ('arshad.baig', 'Arshad Baig', 'employee', 'ibs', 'arshadBaig123'),
        ('sana.rafique', 'Sana Rafique', 'employee', 'ibs', 'sanaRafique123'),
        ('zohaib.saleem', 'Zohaib Saleem', 'employee', 'ibs', 'zohaibSaleem123'),
        ('amna.shakeel', 'Amna Shakeel', 'pm', 'power', 'amnaShakeel123'),
        ('rehan.gul', 'Rehan Gul', 'employee', 'power', 'rehanGul123'),
        ('farah.danish', 'Farah Danish', 'employee', 'power', 'farahDanish123'),
        ('khurram.said', 'Khurram Said', 'employee', 'power', 'khurramSaid123'),
        ('noor.hayat', 'Noor Hayat', 'employee', 'power', 'noorHayat123'),
        ('bilquis.rafiq', 'Bilquis Rafiq', 'pm', 'civil_works', 'bilquisRafiq123'),
        ('mudassar.iqbal', 'Mudassar Iqbal', 'employee', 'civil_works', 'mudassarIqbal123'),
        ('shakeela.noor', 'Shakeela Noor', 'employee', 'civil_works', 'shakeelaNoor123'),
        ('jawad.masood', 'Jawad Masood', 'employee', 'civil_works', 'jawadMasood123'),
        ('sumaira.latif', 'Sumaira Latif', 'employee', 'civil_works', 'sumairaLatif123'),
        ('atif.rehman', 'Atif Rehman', 'pm', 'bss_wireless', 'atifRehman123'),
        ('meena.sharma', 'Meena Sharma', 'employee', 'bss_wireless', 'meenaSharma123'),
        ('vikram.patel', 'Vikram Patel', 'employee', 'bss_wireless', 'vikramPatel123'),
        ('priya.nair', 'Priya Nair', 'employee', 'bss_wireless', 'priyaNair123'),
        ('rohan.kapoor', 'Rohan Kapoor', 'employee', 'bss_wireless', 'rohanKapoor123'),
        ('gul.e.naz', 'Gul E Naz', 'pm', 'fixed_network', 'gulENaz123'),
        ('sameer.umar', 'Sameer Umar', 'employee', 'fixed_network', 'sameerUmar123'),
        ('shazia.fiaz', 'Shazia Fiaz', 'employee', 'fixed_network', 'shaziaFiaz123'),
        ('waqas.minhas', 'Waqas Minhas', 'employee', 'fixed_network', 'waqasMinhas123'),
        ('rabia.younis', 'Rabia Younis', 'employee', 'fixed_network', 'rabiaYounis123'),
        ('nasir.jamil', 'Nasir Jamil', 'pm', 'warehouse', 'nasirJamil123'),
        ('tahira.butt', 'Tahira Butt', 'employee', 'warehouse', 'tahiraButt123'),
        ('irfan.qadir', 'Irfan Qadir', 'employee', 'warehouse', 'irfanQadir123'),
        ('sadia.mumtaz', 'Sadia Mumtaz', 'employee', 'warehouse', 'sadiaMumtaz123'),
        ('murtaza.abbas', 'Murtaza Abbas', 'employee', 'warehouse', 'murtazaAbbas123')
    ) as t(username, full_name, role, department, plain_password)
  loop
    v_email := rec.username || '@hadir.ai';
    select id into v_id from auth.users where lower(email) = lower(v_email) limit 1;
    if v_id is null then
      insert into auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      )
      values (
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        v_email,
        crypt(rec.plain_password, gen_salt('bf')),
        now(),
        jsonb_build_object('provider', 'email', 'providers', array['email']::text[]),
        jsonb_build_object('full_name', rec.full_name),
        now(),
        now()
      )
      returning id into v_id;
    end if;
    if v_users_has_company_id then
      insert into public.users (id, name, email, role, department, company_id)
      values (v_id, rec.full_name, v_email, rec.role::text, rec.department::text, v_company_id)
      on conflict (email) do nothing;
    else
      insert into public.users (id, name, email, role, department)
      values (v_id, rec.full_name, v_email, rec.role::text, rec.department::text)
      on conflict (email) do nothing;
    end if;
  end loop;

  select coalesce(
    (select id from public.users where lower(email) = lower('hammad.bakhtiar@hadir.ai') limit 1),
    (select id from public.users order by created_at nulls last, id limit 1)
  )
  into v_keeper;

  if v_keeper is not null then
    update public.users u
    set
      role = 'pm',
      department = case
        when u.department = 'management' then 'technical'
        else u.department
      end
    where u.role = 'admin'
      and u.id <> v_keeper;

    update public.users
    set role = 'admin', department = 'management'
    where id = v_keeper;
  end if;

  update public.users
  set department = 'technical'
  where role <> 'admin'
    and department = 'management';
end $$;

update public.projects p
set department = coalesce(
  (select u.department from public.users u where u.id = p.created_by limit 1),
  'technical'
)
where p.department is null
   or p.department not in (
     'sales', 'hr', 'technical', 'finance', 'engineering', 'management',
     'ibs', 'power', 'civil_works', 'bss_wireless', 'fixed_network', 'warehouse'
   );

-- sostituisce known_suppliers con un sistema di categorie più ricco e correggibile a mano
create table if not exists email_contacts (
  email text primary key,
  category text not null check (category in (
    'clienti','fornitori_cinte','fornitori_fibbie','fornitori_packaging','fornitori_cartellini','fornitori_generali','importanti'
  )),
  name text,
  updated_at timestamptz not null default now()
);
alter table email_contacts enable row level security;
create policy "email_contacts_select_admin" on email_contacts for select using (is_admin());

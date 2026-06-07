-- PO upload synchronization: tracking, cancellation metadata, line SN column.

alter table public.purchase_orders add column if not exists sn text;
alter table public.purchase_orders add column if not exists is_active boolean not null default true;
alter table public.purchase_orders add column if not exists cancelled_at timestamptz;
alter table public.purchase_orders add column if not exists cancellation_reason text;
alter table public.purchase_orders add column if not exists upload_batch_id uuid;
alter table public.purchase_orders add column if not exists uploaded_at timestamptz;
alter table public.purchase_orders add column if not exists last_seen_upload_id uuid;
alter table public.purchase_orders add column if not exists last_seen_at timestamptz;

update public.purchase_orders
set is_active = (coalesce(status, 'active') <> 'cancelled')
where is_active is distinct from (coalesce(status, 'active') <> 'cancelled');

create index if not exists purchase_orders_upload_batch_id_idx
  on public.purchase_orders (upload_batch_id)
  where upload_batch_id is not null;

create index if not exists purchase_orders_last_seen_upload_id_idx
  on public.purchase_orders (last_seen_upload_id)
  where last_seen_upload_id is not null;

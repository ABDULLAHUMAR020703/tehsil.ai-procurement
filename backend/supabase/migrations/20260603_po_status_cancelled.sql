-- Add status column to purchase_orders for cancellation tracking.
-- POs absent from the latest upload sheet are automatically marked 'cancelled'.

alter table public.purchase_orders
  add column if not exists status text not null default 'active'
    check (status in ('active', 'cancelled'));

create index if not exists purchase_orders_status_idx on public.purchase_orders (status);

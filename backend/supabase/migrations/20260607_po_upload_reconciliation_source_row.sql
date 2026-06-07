alter table public.purchase_orders
  add column if not exists source_row jsonb;

comment on column public.purchase_orders.source_row is
  'Raw source row payload from PO uploads, used to preserve source placeholders such as "-" and cancellation markers.';

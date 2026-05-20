import { supabaseAdmin } from '../../config/supabase';
import type { PurchaseOrderDbRow } from './groupByPo';
import { getLastTransactionForPO, type PoLastTransactionBundle } from './lastTransaction';

// Naive batching: just run them concurrently in chunks to avoid overwhelming the DB connection pool.
// In a real production system, this should be replaced with a materialized view or complex RPC.
export async function getBatchLastTransactionForPOs(
  anchorPoLineIds: string[],
  companyId: string
): Promise<Map<string, PoLastTransactionBundle>> {
  const map = new Map<string, PoLastTransactionBundle>();
  
  // Chunking to avoid connection limits
  const chunkSize = 20;
  for (let i = 0; i < anchorPoLineIds.length; i += chunkSize) {
    const chunk = anchorPoLineIds.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          return await getLastTransactionForPO(id, companyId);
        } catch (err) {
          console.error(`Failed to fetch last tx for PO ${id}`, err);
          return { po_id: id, po_number: null, last_transaction: null };
        }
      })
    );
    for (let j = 0; j < chunk.length; j++) {
      map.set(chunk[j], results[j]);
    }
  }

  return map;
}

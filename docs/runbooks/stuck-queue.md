# Stuck queue

BullMQ on Redis. Queues: `pactlab-default`, dead-letter `pactlab-dead-letter`.

1. Check worker health and recent deploys. A worker rollout drains intake on
   the old revision before retiring it; a stuck drain looks like a stuck queue.
2. Inspect queue depth and the oldest waiting job's age. Jobs carry a full
   envelope (type, organization, deal, idempotency key); log only ids.
3. If jobs fail repeatedly they move to `pactlab-dead-letter` with the
   envelope intact. Fix the cause first, then re-enqueue — job ids derive from
   the idempotency key, so replays do not duplicate work.
4. If Redis itself is unhealthy, fail over (stage/prod run two nodes with
   automatic failover). Lost in-flight jobs are re-enqueued from the outbox or
   sync-run state; they are replay-safe.
5. Never delete dead-letter jobs without recording their ids and reason.

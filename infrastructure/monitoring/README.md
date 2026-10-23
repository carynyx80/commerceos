# Monitoring

- **Liveness**: `GET /health` on the API reports database, contracts, quote signer, AI and indexer state. Alert when `ok` is false or `indexer.updatedAt` is older than 5 minutes while blocks are being produced.
- **Worker**: failed jobs are visible in Admin → Security. Alert on any `FAILED` job of kind `payment.verify` or `registry.sync`.
- **Escrow solvency**: compare `CommerceEscrow.liabilities(token)` with the escrow's token balance; balance must always be ≥ liabilities.
- **Security events**: audit actions starting with `security.` (e.g. `security.funding_mismatch`) and `agent.payment_rejected_onchain` should page an operator.
- **Request tracing**: every API response carries `x-request-id`; logs include it.

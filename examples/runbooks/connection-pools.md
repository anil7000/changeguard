# Synthetic connection-pool review

Use this runbook only with the ChangeGuard local evaluation fixture.

For a replica change, multiply the proposed replica count by the maximum connection pool per replica. Compare that demand with the capacity budget allocated to the service, not the database's total capacity. Other clients need their own reserved capacity.

If the allocation is unknown, hold the change. If demand exceeds it, reduce replicas or pool size and submit a new investigation. Never change an approved action in place.

Before approval, inspect the rehearsal's failed-request count and the exact target revision. After execution, require independent verification probes to pass. A zero failure count in this synthetic fixture does not prove production safety.

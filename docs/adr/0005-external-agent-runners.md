# External agent runners

Version 0.1 coordinates agent work but does not execute repository code inside the OpenTeam server. External runners claim leased runs, heartbeat their progress, and report completion or failure through the API. This keeps the server narrow, reduces the security impact of a compromised runner, and allows agents to execute on developer machines or CI; provider-specific execution can later sit behind runner adapters.

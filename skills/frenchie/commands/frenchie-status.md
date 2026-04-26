Show the current Frenchie account status.

1. Read `FRENCHIE_API_KEY` from the environment
2. Read `FRENCHIE_API_URL` from the environment (default: `https://api.getfrenchie.dev`)
3. Call `GET {FRENCHIE_API_URL}/balance` with header `Authorization: Bearer {FRENCHIE_API_KEY}`
4. Call `GET {FRENCHIE_API_URL}/jobs?limit=10` with the same auth header
5. Summarize:
   - Current credit balance
   - Up to 10 most recent jobs: type, status, filename, credits used, completion state
   - Whether any recent async jobs still need follow-up via `get_job_result`

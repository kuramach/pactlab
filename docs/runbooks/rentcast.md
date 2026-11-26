# RentCast (market rents and property facts) (T-158, ADR 0045)

Pactlab's RentCast key powers two things:
- **Check rents against the market** on a multifamily pact's Home and Finances. It gives one long-term rent estimate per floor plan of the rent roll, stored as cited evidence.
- **Property facts** on teaser pages (batch 2).

## 1. Create the key
1. Sign in at https://app.rentcast.io → **API Dashboard**. Choose a plan:
   - **Developer:** free, 50 requests a month.
   - **Foundation:** 1,000 requests a month.
   - **Growth** and **Scale:** more requests a month.

   Every plan bills overage per request. Pactlab makes at most 10 calls per retrieval (one per floor plan), and a same-day re-run makes none.
2. **API Keys → Create key.** Use one key per environment, since RentCast limits each key to 20 requests a second. Copy it.

## 2. Set it
```
scripts/rentcast-key.sh live      # or dev, qa, stage
```
The script:
- asks for the key (hidden) and refuses a paste that cannot be a key;
- saves it to `pactlab/<env>/credentials/rentcast-api-key`;
- restarts the API so it reads the new key.

Locally, put `RENTCAST_API_KEY=<key>` in `apps/api/.env`. Leave it blank to use the synthetic fixture.

**Check:** open a multifamily pact with a rent roll in a USD pact, then click **Check rents against the market**. The message should name RentCast, not "RentCast (fixture, synthetic)".

## 3. Rotate it
1. Create a new key in the dashboard.
2. Run `scripts/rentcast-key.sh <env>` with the new key.
3. Wait for the API restart, then run the check above.
4. Delete the old key in the dashboard.

Estimates already retrieved stay as evidence. Their source and date don't change.

## 4. Turn it off
```
scripts/rentcast-key.sh live off   # the secret becomes `unset`
```

## What turns off without a key
| Environment | Market rents | Teaser property facts |
|---|---|---|
| production (live) | Off: the button says "Market rents are not set up in this environment." Figures stay missing. | No lookup |
| dev, qa, stage, local | The synthetic fixture | The synthetic fixture |

## Errors the screen shows
| Error | Cause | What to do |
|---|---|---|
| `MARKET_RENTS_KEY_REFUSED` | RentCast refused the key: revoked, or the plan lapsed | Rotate the key |
| `MARKET_RENTS_RATE_LIMITED` | Over 20 requests a second | Retry later |
| `MARKET_RENTS_UNAVAILABLE` | RentCast is down | See `connector-outage.md` |

Each failure is audited as `market_rents.retrieved` with the outcome FAILED. The key is never logged.

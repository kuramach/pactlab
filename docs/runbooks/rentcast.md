# RentCast (market rents and property facts) (T-158, ADR 0045)

Pactlab's RentCast key powers three things:
- **Check rents against the market** on a multifamily pact's Home and Finances. It gives one long-term rent estimate per floor plan of the rent roll, stored as cited evidence.
- **Property facts** on teaser pages (batch 2).
- **The property profile** on a multifamily pact's **Property** tab (T-188, ADR 0062): the public record for the address (type, area, lot, year built, features, tax and sale history, owner), proposed for the buyer team to review and accept. US addresses only.

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

## Property profile and photos (T-188)

**Records** use the same RentCast key (`GET /v1/properties`, `GET /v1/properties/{id}`: two calls per fill; a re-fetch is a user action). Without a key, production turns the profile's fill off and says so; elsewhere the synthetic fixture answers.

**Photos** use Google Maps Platform, a separate pay-as-you-go key:
1. In Google Cloud, enable **Street View Static API** and **Places API (New)** on a Pactlab project, and create an API key restricted to those two APIs and to Pactlab's server addresses. Do not reuse the Gemini `GOOGLE_API_KEY`.
2. Set `GOOGLE_MAPS_API_KEY` for the API task (`apps/api/.env` locally). The CDK secret for deployed environments is a follow-up task; until it lands, production shows "Photos are not set up in this environment".
3. A photo search is one Street View metadata call (free), one Places text search and one image fetch per photo shown; each user-run search is one `property_profile.photos_fetched` audit event.

**Before the first live key (one-time check):** run **Find photos** and **Fill from the public record** on one real US address and confirm the gallery shows the capture month and the attribution, and that the fields match the record. The adapters were written from the vendors' references and replayed from hand-built cassettes.

**Rules:** photos are illustrative and never evidence; Pactlab stores photo references, not image bytes; the key never reaches a browser; a non-US address gets no record lookup, only photos.

| Message on the Property tab | Cause | What to do |
|---|---|---|
| Property records are not set up in this environment | No RentCast key (production) | `scripts/rentcast-key.sh <env>` |
| Photos are not set up in this environment | No `GOOGLE_MAPS_API_KEY` | Set it (above) |
| The provider refused Pactlab's key | Key revoked, API not enabled or key restrictions | Fix in the vendor's console, then set it again |
| The provider is busy right now | Rate limit | Wait a minute |
| Public-record property data covers US addresses only | Non-US address | None: the profile stays manual |

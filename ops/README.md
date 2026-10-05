# ops/

Dead-drop command channel between Muse and Kumar's Mac Mini.

- Muse drops shell scripts in `ops/inbox/`
- The poller on the Mini (`ops/poll.sh`) runs them within ~30s and posts output to `ops/outbox/`

Start the poller (from a clone of this repo): `nohup ops/poll.sh >/tmp/pactlab-ops-poller.log 2>&1 &`
Stop it: `pkill -f 'pactlab-ops.*poll.sh'`

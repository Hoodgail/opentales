# Novel-build staging evidence

Recorded 2026-09-22. PR #8 remains draft; neither full novel has completed.

## Deployment

- Existing production stack `opentales-stack-ayoqij` and its database were inspected but not changed.
- Isolated OpenTales environment: `novel-validation` (`DVfTYeWuHbGv1UNUAZW7L`).
- Dokploy Compose ID: `-I9TvQMfULiUQm4-F_j3P`; application name: `compose-generate-optical-bus-63hdnm`.
- Source: `b6a3f0fff09aa6b0b744c0df55a7f33b5282edc1`. The build log records a Git context pinned to this full commit. [CI for this revision](https://github.com/Hoodgail/opentales/actions/runs/35679223034) passed every step, including the native PostgreSQL suite and Compose validation.
- Both worker containers use image `sha256:64b661680458bd1b4101d720bc35c9ce3960c62a8bd5365b16647785ed7c5a10` with a matching source-revision label.
- Separate PostgreSQL 18 instances, networks and persistent database/output volumes. No host ports are published and Traefik is disabled. The public production endpoint is not routed to staging.
- Operational override: the raw Compose build context points to the pinned Git revision. After migrations, workers wait for `/validation/release-worker`. This prevented inference during checkpoint restoration. The file was created only after both imports and restart checks passed; it persists in each output volume.

## Restore and restart verification

The saved PGlite checkpoints were exported as logical data-only SQL. Each import ran in a native PostgreSQL transaction with `ON_ERROR_STOP`, followed in the same transaction by row-count and row-content fingerprint assertions for all 67 public application tables. Migration-history records came from the repository migrations, not the embedded harness.

Both worker containers were restarted while still held. All 67 table fingerprints were checked again before inference was released. The build IDs, accepted planning artifacts, saved scene heads, task states and usage totals survived unchanged.

This does not prove recovery from terminating an in-flight model request. The staging `on-failure` restart policy also requires explicitly starting the same services after a Docker daemon/host restart. Do not represent this check as automatic host-reboot recovery.

## Live runs

| Provider model | Build ID | Restored state | Initial progress after release |
| --- | --- | --- | --- |
| `gemini-3.8-flash-high` | `f96d720b-b3c8-443b-a32d-cab3bb656399` | 142/1,231 tasks, 9 scenes / 3,940 words | 153/1,231 tasks; 10 scenes / 4,382 words; scene 10 canon running (03:22 UTC) |
| `gpt-5.6-luna` | `483f606f-cc6c-49bf-bd42-68c50ed989be` | 15/67 planning tasks, no prose | Chapter-brief repair resumed, attempt 2 |

Both use the supplied provider through private environment settings. Each retains the existing 150M-token authorization and stored cost cap. No task was marked complete manually, and no diagnostic, independent quality or export gate was waived.

`/validation/result/heartbeat.json` records current activity and the tested revision every 30 seconds. Read its timestamp together with container state; this document is a point-in-time record. A final success claim requires `COMPLETED`, all 110 scenes, 32 chapters, the 32K–48K word range, final gates, and a current-head/checksum-verified downloadable export for each provider.

Repeated full-context model/tool calls remain a serious efficiency issue: the Gemini checkpoint already accounted for 132,483,876 cumulative tokens before scene 9 review. A persistent host solves interrupted validation sessions; it does not by itself establish full-novel reliability, affordability or literary quality.

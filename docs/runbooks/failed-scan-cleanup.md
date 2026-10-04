# Failed scan cleanup

Source code is never persisted. The scanner orchestrator creates a temporary
workspace per scan and destroys it on success, failure, timeout and
cancellation; a failure to destroy raises `WorkspaceCleanupError`.

1. On `WorkspaceCleanupError` or an orphaned-workspace alarm, identify the
   scan run id and task.
2. Stop the scan task if still running. Scan tasks are isolated and ephemeral;
   stopping the task destroys its ephemeral storage.
3. If the workspace was on any persistent volume, delete it and confirm
   absence; record path (not contents) and time.
4. Confirm no source archive, clone or snippet beyond policy-approved snippets
   was written to evidence storage, logs or bug records.
5. Mark the scan failed; the finding pipeline keeps only normalized findings,
   paths, hashes and tool versions from completed scans.

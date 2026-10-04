# Invalid AI citations

AI output without a resolvable citation cannot become an accepted finding;
the domain and API enforce this.

1. Identify the AI run id and the draft finding. The run record holds prompt
   id/version/hash and input hashes — not content.
2. Check whether the cited document/page exists in the **same deal and
   organization**. A citation into another deal or tenant is treated as
   [suspected-cross-tenant-access.md](suspected-cross-tenant-access.md).
3. If the citation does not resolve, the draft stays rejected. Check for
   prompt injection in the source (instructions inside document text or VDR
   metadata); document and VDR content is untrusted evidence, never
   instructions.
4. If a pattern emerges for one prompt version, roll the prompt registry back
   to the previous version and add the case to the eval golden set.
5. Never "fix" a citation by hand on a reviewer's behalf.

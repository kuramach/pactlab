# Object-store exposure

Evidence and audit buckets block all public access, enforce TLS, use
bucket-owner-enforced object ownership and KMS encryption with the
environment's data key.

1. Confirm the finding: bucket policy change, ACL attempt, public-access-block
   change, or a leaked presigned URL.
2. **Presigned URL leak:** URLs are short-lived; rotate the signing role's
   session if the URL is still valid; identify the object and requester from
   access logs and audit events.
3. **Policy drift:** console edits are prohibited. Run CloudFormation drift
   detection on the stack, restore the CDK-defined configuration through the
   release workflow, and investigate who changed it via CloudTrail.
4. Determine which objects (by key, not content) were reachable and for how
   long; involve the affected partner per incident policy.
5. Add a policy check or test that would have caught the drift.

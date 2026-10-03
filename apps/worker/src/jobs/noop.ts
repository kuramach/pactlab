import { jobEnvelopeSchema, NOOP_JOB_TYPE, type JobEnvelope } from '@pactlab/contracts';
import { jobRuns, resolveJobContext, withTenant, type PrismaClient } from '@pactlab/db';

export interface JobDependencies {
  prisma: PrismaClient;
}

export interface JobOutcome {
  jobRunId: string;
  replayed: boolean;
}

/**
 * No-op job proving the pipeline end to end: validate the job contract,
 * re-establish tenant context from the envelope, record an idempotent run.
 */
export async function processNoopJob(deps: JobDependencies, input: unknown): Promise<JobOutcome> {
  const envelope: JobEnvelope = jobEnvelopeSchema.parse(input);
  if (envelope.type !== NOOP_JOB_TYPE) throw new Error(`Unexpected job type for noop handler`);

  const tenant = await resolveJobContext(deps.prisma, envelope);
  return withTenant(deps.prisma, tenant, async (tx) => {
    const run = await jobRuns.start(tx, envelope);
    if (!run.replayed) await jobRuns.complete(tx, run.id, 'SUCCEEDED');
    return { jobRunId: run.id, replayed: run.replayed };
  });
}

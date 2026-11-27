/**
 * Hibernation helpers for the env-power workflow and Kumar's scripts (ADR 0063). Synthesizes in-process; never
 * calls AWS.
 *   tsx bin/hibernation.ts plan <env> [--neighbour-hibernated] [--json]   what hibernating deletes and keeps
 *   tsx bin/hibernation.ts config <env>                                  the env's hibernate settings, as JSON
 */
// CDK's deprecation notices would bury the plan.
process.env['JSII_DEPRECATED'] ??= 'quiet';
import { ENVIRONMENT_NAMES, ENVIRONMENTS, type EnvironmentName } from '../config';
import { hibernationPlan, planText } from '../lib/hibernation-plan';

const [command, raw, ...flags] = process.argv.slice(2);
const name = (raw === 'live' ? 'prod' : raw) as EnvironmentName;
if (!(ENVIRONMENT_NAMES as readonly string[]).includes(name)) {
  process.stderr.write('usage: hibernation.ts plan|config <dev|qa|stage>\n');
  process.exit(2);
}
const config = ENVIRONMENTS[name];
if (!config.hibernate) {
  process.stderr.write(`${raw} never hibernates (ADR 0063)${name === 'prod' ? ': live is always on' : ''}\n`);
  process.exit(3);
}
if (command === 'config') {
  const neighbour = ENVIRONMENT_NAMES.find((other) => other !== name && config.shared && ENVIRONMENTS[other].shared) ?? null;
  process.stdout.write(`${JSON.stringify({ ...config.hibernate, idleMinutes: config.idlePause?.idleMinutes ?? null, neighbour, protectedState: config.protectedState })}\n`);
} else if (command === 'plan') {
  const plan = hibernationPlan(name, { neighbourHibernated: flags.includes('--neighbour-hibernated') });
  process.stdout.write(flags.includes('--json') ? `${JSON.stringify(plan, null, 2)}\n` : `${planText(plan)}\n`);
} else {
  process.stderr.write('usage: hibernation.ts plan|config <dev|qa|stage>\n');
  process.exit(2);
}

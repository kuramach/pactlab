import { App } from 'aws-cdk-lib';
import { PactlabDevStack } from '../lib/dev-stack';

// Environment-agnostic synthesis: no account lookups and no credentials needed.
// Stage and production stacks are intentionally absent until T-007.
const app = new App();
new PactlabDevStack(app, 'PactlabDev');
app.synth();
